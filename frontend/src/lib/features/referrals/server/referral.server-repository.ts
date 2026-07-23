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
	buildCapacityTransferDocs,
	buildDestinationIntakeDocs,
	CapacityTransferError
} from '../domain/referral.capacity-transfer';
import type { ReferralRepository } from '../data/referral.repository';

// HTTP Constants
const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_NOT_FOUND = 404;

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
	constructor(private readonly dbName: string) {
		if (typeof process !== 'undefined' && !process.env.COUCHDB_ADMIN_URL) {
			console.warn(
				`[CouchDbReferralServerRepository]: COUCHDB_ADMIN_URL is not set. ` +
					`Server-side database operations on "${this.dbName}" will fail.`
			);
		}
	}

	// ── Private fetch wrappers ───────────────────────────────────

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

		// Fully done previously — nothing to write.
		if (sourceAlreadyTransferred && destActive) {
			return;
		}

		if (sourceAlreadyTransferred && !destActive) {
			// Source already closed occupancy; finish / repair destination only.
			const docs = buildDestinationIntakeDocs({
				evacuee: sourceEvacuee,
				fromShelterCode: fromCode,
				toShelterCode: toCode,
				actor,
				nowIso,
				reason
			});
			await this.writeDestTransfer(toDb, docs.destEvacuee, docs.destMovement, destRaw);
			return;
		}

		const docs = buildCapacityTransferDocs({
			evacuee: sourceEvacuee,
			fromShelterCode: fromCode,
			toShelterCode: toCode,
			actor,
			nowIso,
			reason
		});

		await this.writeDestTransfer(toDb, docs.destEvacuee, docs.destMovement, destRaw);
		await this.putDoc(fromDb, docs.sourceMovement);
		await this.putDoc(fromDb, {
			...docs.sourceEvacuee,
			_rev: sourceEvacuee._rev
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
		await this.putDoc(toDb, destMovement);
	}

	// ── Interface Methods ────────────────────────────────────────

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

		if (data.warning) {
			console.warn(`[CouchDB Mango Warning]: ${data.warning}`);
		}

		return (data.docs || []).filter((d): d is Referral => isReferral(d));
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

	async transition(
		id: string,
		to: ReferralStatus,
		actor: string,
		reason?: string
	): Promise<Referral> {
		const latest = await this.get(id);
		if (!latest) {
			throw new CouchDbReferralError(`Referral not found`, HTTP_NOT_FOUND);
		}

		const nowIso = new Date().toISOString();

		// Capacity accept: cross-DB transfer BEFORE marking referral accepted (fail-fast).
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

		return { ...touched, _rev: data.rev };
	}
}
