import { adminRaw } from '$lib/server/couch-admin';
import { makeDoc, touch, type AuthorContext } from '$lib/db/model';
import { shelterDbName } from '$lib/server/shelter-access-design';
import { isEvacuee, type Evacuee, type Movement } from '$lib/features/people/domain/people';
import {
	isReferral,
	type Referral,
	type ReferralFilter,
	referralFilterSchema,
	type ReferralInput,
	type ReferralStatus,
	buildReferralBody,
	referralSchema
} from '../domain/referral.schema';
import { applyTransition } from '../domain/referral.transitions';
import {
	assertActorMayTransition,
	ReferralAuthorizationError
} from '../domain/referral.authorization';
import {
	buildCapacityTransferDocs,
	buildDestinationIntakeDocs,
	CapacityTransferError
} from '../domain/referral.capacity-transfer';
import type { ReferralRepository } from '../data/referral.repository';

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_NOT_FOUND = 404;
const HTTP_FORBIDDEN = 403;

export class CouchDbReferralError extends Error {
	constructor(
		message: string,
		public readonly status: number,
		public readonly details?: unknown
	) {
		super(message);
		this.name = 'CouchDbReferralError';
	}
}

interface MangoFindResponse {
	docs: Record<string, unknown>[];
	warning?: string;
}

interface PutResultResponse {
	ok: boolean;
	id: string;
	rev: string;
}

export class CouchDbReferralServerRepository implements ReferralRepository {
	constructor(private readonly dbName: string) {}

	private async couchGet<T>(dbName: string, path: string): Promise<{ status: number; data: T }> {
		const res = await adminRaw(`/${dbName}${path}`, 'GET');
		return { status: res.status, data: res.data as T };
	}

	private async couchPost<T>(
		dbName: string,
		path: string,
		body: unknown
	): Promise<{ status: number; data: T }> {
		const res = await adminRaw(`/${dbName}${path}`, 'POST', body);
		return { status: res.status, data: res.data as T };
	}

	private async couchPut<T>(
		dbName: string,
		path: string,
		body: unknown
	): Promise<{ status: number; data: T }> {
		const res = await adminRaw(`/${dbName}${path}`, 'PUT', body);
		return { status: res.status, data: res.data as T };
	}

	private async putDoc(dbName: string, doc: { _id: string; _rev?: string }): Promise<string> {
		const { status, data } = await this.couchPut<PutResultResponse>(
			dbName,
			`/${encodeURIComponent(doc._id)}`,
			doc
		);
		if (status !== HTTP_CREATED && status !== HTTP_OK) {
			throw new CouchDbReferralError(`Failed to write ${doc._id} in ${dbName}`, status, data);
		}
		return data.rev;
	}

	/** PUT that reuses an existing `_rev` when the deterministic id already exists. */
	private async putDocIdempotent(
		dbName: string,
		doc: { _id: string; _rev?: string }
	): Promise<string> {
		if (!doc._rev) {
			const { status, data } = await this.couchGet<{ _rev?: string }>(
				dbName,
				`/${encodeURIComponent(doc._id)}`
			);
			if (status === HTTP_OK && data._rev) {
				return this.putDoc(dbName, { ...doc, _rev: data._rev });
			}
		}
		return this.putDoc(dbName, doc);
	}

	/**
	 * Cross-DB capacity transfer (admin path — required because destination DB
	 * is outside the caller's shelter session scope).
	 *
	 * Order: destination first, then source — prefer brief double-count over a lost person.
	 * Idempotent when source is already `transferred` and dest already has an active copy.
	 */
	async completeCapacityTransfer(
		referral: Referral,
		actor: string,
		nowIso: string,
		reason?: string
	): Promise<void> {
		if (referral.referral_type !== 'capacity' || !referral.to_shelter_code) {
			throw new CapacityTransferError('Referral is not a capacity transfer with to_shelter_code');
		}

		const fromCode = referral.shelter_code;
		const toCode = referral.to_shelter_code;
		const fromDb = shelterDbName(fromCode);
		const toDb = shelterDbName(toCode);

		const { status: srcStatus, data: srcRaw } = await this.couchGet<unknown>(
			fromDb,
			`/${encodeURIComponent(referral.evacuee_id)}`
		);
		if (srcStatus === HTTP_NOT_FOUND || !isEvacuee(srcRaw)) {
			throw new CapacityTransferError(
				`Evacuee ${referral.evacuee_id} not found in ${fromDb} — cannot complete shelter transfer`
			);
		}
		const sourceEvacuee = srcRaw;

		const { status: destStatus, data: destRaw } = await this.couchGet<unknown>(
			toDb,
			`/${encodeURIComponent(referral.evacuee_id)}`
		);
		const destExists = destStatus === HTTP_OK && isEvacuee(destRaw);
		const destActive = destExists && (destRaw as Evacuee).current_stay.status === 'active';
		const sourceAlreadyTransferred = sourceEvacuee.current_stay.status === 'transferred';

		if (sourceAlreadyTransferred && destActive) {
			return;
		}

		if (sourceAlreadyTransferred && !destActive) {
			const docs = this.prepareDestinationIntakeDocs(
				sourceEvacuee,
				fromCode,
				toCode,
				actor,
				nowIso,
				referral._id,
				reason
			);
			await this.writeDestTransfer(toDb, docs.destEvacuee, docs.destMovement, destRaw);
			return;
		}

		const docs = this.prepareFullCapacityTransferDocs(
			sourceEvacuee,
			fromCode,
			toCode,
			actor,
			nowIso,
			referral._id,
			reason
		);

		// Dest already active but source not closed — finish source only (avoid duplicate transfer_in).
		if (destActive) {
			await this.putDocIdempotent(fromDb, docs.sourceMovement);
			await this.putDoc(fromDb, {
				...docs.sourceEvacuee,
				_rev: sourceEvacuee._rev
			});
			return;
		}

		await this.writeDestTransfer(toDb, docs.destEvacuee, docs.destMovement, destRaw);
		await this.putDocIdempotent(fromDb, docs.sourceMovement);
		await this.putDoc(fromDb, {
			...docs.sourceEvacuee,
			_rev: sourceEvacuee._rev
		});
	}

	/** Helper: Constructs destination intake document payloads for idempotent retry */
	private prepareDestinationIntakeDocs(
		sourceEvacuee: Evacuee,
		fromCode: string,
		toCode: string,
		actor: string,
		nowIso: string,
		referralId: string,
		reason?: string
	) {
		return buildDestinationIntakeDocs({
			evacuee: sourceEvacuee,
			fromShelterCode: fromCode,
			toShelterCode: toCode,
			actor,
			nowIso,
			referralId,
			reason
		});
	}

	/** Helper: Constructs full capacity transfer document payloads (source + destination) */
	private prepareFullCapacityTransferDocs(
		sourceEvacuee: Evacuee,
		fromCode: string,
		toCode: string,
		actor: string,
		nowIso: string,
		referralId: string,
		reason?: string
	) {
		return buildCapacityTransferDocs({
			evacuee: sourceEvacuee,
			fromShelterCode: fromCode,
			toShelterCode: toCode,
			actor,
			nowIso,
			referralId,
			reason
		});
	}

	private async writeDestTransfer(
		toDb: string,
		destEvacuee: Evacuee,
		destMovement: Movement,
		existingDest: unknown
	): Promise<void> {
		const withRev: Evacuee =
			isEvacuee(existingDest) && existingDest._rev
				? { ...destEvacuee, _rev: existingDest._rev }
				: destEvacuee;
		await this.putDoc(toDb, withRev);
		await this.putDocIdempotent(toDb, destMovement);
	}

	/** Mirror referral into destination shelter DB (same _id; keeps source shelter_code). */
	async mirrorCapacityReferralToDestination(referral: Referral): Promise<void> {
		if (referral.referral_type !== 'capacity' || !referral.to_shelter_code) {
			return;
		}
		const toDb = shelterDbName(referral.to_shelter_code);
		const { status, data } = await this.couchGet<unknown>(
			toDb,
			`/${encodeURIComponent(referral._id)}`
		);

		const { _rev: _, ...withoutRev } = referral;
		void _;
		const mirror: Referral =
			status === HTTP_OK && isReferral(data) && data._rev
				? { ...withoutRev, _rev: data._rev }
				: withoutRev;

		await this.putDoc(toDb, mirror);
	}

	/** Keep the peer copy in sync after accept/reject/close (source ↔ destination). */
	async syncCapacityReferralPeer(referral: Referral, actorShelter: string): Promise<void> {
		if (referral.referral_type !== 'capacity' || !referral.to_shelter_code) {
			return;
		}

		const sourceDb = shelterDbName(referral.shelter_code);
		const destDb = shelterDbName(referral.to_shelter_code);
		const peerDb =
			shelterDbName(actorShelter) === sourceDb
				? destDb
				: shelterDbName(actorShelter) === destDb
					? sourceDb
					: null;

		if (!peerDb) {
			return;
		}

		const { status, data } = await this.couchGet<unknown>(
			peerDb,
			`/${encodeURIComponent(referral._id)}`
		);

		const { _rev: _, ...withoutRev } = referral;
		void _;

		if (status === HTTP_NOT_FOUND) {
			// Peer missing (e.g. closed before mirror) — create from current state.
			await this.putDoc(peerDb, withoutRev);
			return;
		}

		if (status === HTTP_OK && isReferral(data) && data._rev) {
			await this.putDoc(peerDb, { ...withoutRev, _rev: data._rev });
		}
	}

	async list(filter?: ReferralFilter): Promise<Referral[]> {
		const parsed = referralFilterSchema.parse(filter ?? {});
		const selector: Record<string, unknown> = {
			type: 'referral'
		};

		if (parsed.status) {
			selector.status = parsed.status;
		}
		if (parsed.evacuee_id) {
			selector.evacuee_id = parsed.evacuee_id;
		}

		const sort =
			parsed.sort === 'created_at_asc'
				? [{ type: 'asc' }, { created_at: 'asc' }]
				: [{ type: 'desc' }, { created_at: 'desc' }];

		const body: Record<string, unknown> = {
			selector,
			limit: parsed.limit,
			skip: parsed.skip,
			sort
		};

		const { status, data } = await this.couchPost<MangoFindResponse>(this.dbName, '/_find', body);

		if (status !== HTTP_OK) {
			throw new CouchDbReferralError(`CouchDB _find query failed`, status, data);
		}

		return (data.docs || []).filter((d): d is Referral => isReferral(d));
	}

	async hasActiveReferral(evacueeId: string): Promise<boolean> {
		const { status, data } = await this.couchPost<MangoFindResponse>(this.dbName, '/_find', {
			selector: {
				type: 'referral',
				evacuee_id: evacueeId,
				status: { $nin: ['closed', 'rejected'] }
			},
			limit: 1,
			fields: ['_id']
		});
		if (status !== HTTP_OK) return false;
		return (data.docs || []).length > 0;
	}

	async get(id: string): Promise<Referral | null> {
		const { status, data } = await this.couchGet<unknown>(
			this.dbName,
			`/${encodeURIComponent(id)}`
		);

		if (status === HTTP_NOT_FOUND) {
			return null;
		}
		if (status !== HTTP_OK) {
			throw new CouchDbReferralError(`Failed to fetch referral`, status, data);
		}

		return isReferral(data) ? data : null;
	}

	async create(input: ReferralInput, ctx: AuthorContext): Promise<Referral> {
		const body = buildReferralBody(input);
		const rawDoc = makeDoc('referral', 1, body, ctx);

		const doc = referralSchema.parse(rawDoc);

		const { status, data } = await this.couchPut<PutResultResponse>(
			this.dbName,
			`/${encodeURIComponent(doc._id)}`,
			doc
		);

		if (status !== HTTP_CREATED && status !== HTTP_OK) {
			throw new CouchDbReferralError(`Failed to write referral doc`, status, data);
		}

		return { ...doc, _rev: data.rev };
	}

	/**
	 * @param actorShelter — caller's shelter scope (destination must accept capacity).
	 */
	async transition(
		id: string,
		to: ReferralStatus,
		actor: string,
		reason?: string,
		actorShelter?: string
	): Promise<Referral> {
		const latest = await this.get(id);
		if (!latest) {
			throw new CouchDbReferralError(`Referral not found`, HTTP_NOT_FOUND);
		}

		const scope = actorShelter ?? latest.shelter_code;
		try {
			assertActorMayTransition(latest, to, scope);
		} catch (e: unknown) {
			if (e instanceof ReferralAuthorizationError) {
				throw new CouchDbReferralError(e.message, HTTP_FORBIDDEN);
			}
			throw e;
		}

		const nowIso = new Date().toISOString();

		// Capacity accept: cross-DB transfer BEFORE marking referral accepted (fail-fast).
		// Only reachable when actorShelter === to_shelter_code (asserted above).
		if (to === 'accepted' && latest.referral_type === 'capacity' && latest.to_shelter_code) {
			try {
				await this.completeCapacityTransfer(latest, actor, nowIso, reason);
			} catch (e: unknown) {
				if (e instanceof CapacityTransferError) {
					throw new CouchDbReferralError(e.message, 422);
				}
				throw e;
			}
		}

		const updated = applyTransition(latest, to, actor, nowIso, reason);
		const touched = touch(updated);

		const { status, data } = await this.couchPut<PutResultResponse>(
			this.dbName,
			`/${encodeURIComponent(touched._id)}`,
			touched
		);

		if (status !== HTTP_CREATED && status !== HTTP_OK) {
			throw new CouchDbReferralError(`Failed to update referral transition`, status, data);
		}

		const saved: Referral = { ...touched, _rev: data.rev };

		if (saved.referral_type === 'capacity' && saved.to_shelter_code) {
			if (to === 'sent') {
				await this.mirrorCapacityReferralToDestination(saved);
			} else if (to === 'accepted' || to === 'rejected' || to === 'closed') {
				await this.syncCapacityReferralPeer(saved, scope);
			}
		}

		return saved;
	}
}
