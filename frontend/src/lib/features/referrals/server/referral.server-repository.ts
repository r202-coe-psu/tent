import { adminRaw } from '$lib/server/couch-admin';
import { makeDoc, touch, type AuthorContext } from '$lib/db/model';
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
				`⚠️ [CouchDbReferralServerRepository]: COUCHDB_ADMIN_URL is not set. ` +
					`Server-side database operations on "${this.dbName}" will fail.`
			);
		}
	}

	// ── Private fetch wrappers ───────────────────────────────────

	private async couchGet<T>(path: string): Promise<{ status: number; data: T }> {
		const res = await adminRaw(`/${this.dbName}${path}`, 'GET');
		return { status: res.status, data: res.data as T };
	}

	private async couchPost<T>(path: string, body: unknown): Promise<{ status: number; data: T }> {
		const res = await adminRaw(`/${this.dbName}${path}`, 'POST', body);
		return { status: res.status, data: res.data as T };
	}

	private async couchPut<T>(path: string, body: unknown): Promise<{ status: number; data: T }> {
		const res = await adminRaw(`/${this.dbName}${path}`, 'PUT', body);
		return { status: res.status, data: res.data as T };
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

		const { status, data } = await this.couchPost<MangoFindResponse>('/_find', body);

		if (status !== HTTP_OK) {
			throw new CouchDbReferralError(`CouchDB _find query failed`, status, data);
		}

		if (data.warning) {
			console.warn(`[CouchDB Mango Warning]: ${data.warning}`);
		}

		return (data.docs || []).filter((d): d is Referral => isReferral(d));
	}

	async get(id: string): Promise<Referral | null> {
		const { status, data } = await this.couchGet<unknown>(`/${encodeURIComponent(id)}`);

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
		const updated = applyTransition(latest, to, actor, nowIso, reason);
		const touched = touch(updated);

		const { status, data } = await this.couchPut<PutResultResponse>(
			`/${encodeURIComponent(touched._id)}`,
			touched
		);

		if (status !== HTTP_CREATED && status !== HTTP_OK) {
			throw new CouchDbReferralError(`Failed to update referral transition`, status, data);
		}

		return { ...touched, _rev: data.rev };
	}
}
