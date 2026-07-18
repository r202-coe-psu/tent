import { adminRaw } from '$lib/server/couch-admin';
import { makeDoc, touch, type AuthorContext } from '$lib/db/model';
import {
	isReferral,
	type Referral,
	type ReferralInput,
	type ReferralStatus
} from '../domain/referral.schema';
import { applyTransition } from '../domain/referral.transitions';
import type { ReferralRepository } from '../data/referral.repository';

// HTTP Constants
const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_NOT_FOUND = 404;

export class ReferralServerError extends Error {
	constructor(
		message: string,
		public readonly status: number,
		public readonly details?: unknown
	) {
		super(message);
		this.name = 'ReferralServerError';
	}
}

interface MangoFindResponse {
	docs: unknown[];
	warning?: string;
}

interface PutResultResponse {
	ok: boolean;
	id: string;
	rev: string;
}

export class ReferralServerRepository implements ReferralRepository {
	constructor(private readonly dbName: string) {
		if (typeof process !== 'undefined' && !process.env.COUCHDB_ADMIN_URL) {
			console.warn(
				`⚠️ [ReferralServerRepository]: COUCHDB_ADMIN_URL is not set. ` +
					`Server-side database operations on "${this.dbName}" will fail.`
			);
		}
	}

	// ── Private fetch wrappers ───────────────────────────────────

	private async adminGet<T>(path: string): Promise<{ status: number; data: T }> {
		const res = await adminRaw(`/${this.dbName}${path}`, 'GET');
		return { status: res.status, data: res.data as T };
	}

	private async adminPost<T>(path: string, body: unknown): Promise<{ status: number; data: T }> {
		const res = await adminRaw(`/${this.dbName}${path}`, 'POST', body);
		return { status: res.status, data: res.data as T };
	}

	private async adminPut<T>(path: string, body: unknown): Promise<{ status: number; data: T }> {
		const res = await adminRaw(`/${this.dbName}${path}`, 'PUT', body);
		return { status: res.status, data: res.data as T };
	}

	// ── Interface Methods ────────────────────────────────────────

	async list(filter?: { status?: ReferralStatus; evacuee_id?: string }): Promise<Referral[]> {
		const selector: Record<string, unknown> = {
			type: 'referral'
		};

		if (filter?.status) {
			selector.status = filter.status;
		}
		if (filter?.evacuee_id) {
			selector.evacuee_id = filter.evacuee_id;
		}

		const { status, data } = await this.adminPost<MangoFindResponse>('/_find', {
			selector
		});

		if (status !== HTTP_OK) {
			throw new ReferralServerError(`CouchDB _find query failed`, status, data);
		}

		if (data.warning) {
			console.warn(`[CouchDB Mango Warning]: ${data.warning}`);
		}

		return (data.docs || []).filter((d): d is Referral => isReferral(d));
	}

	async get(id: string): Promise<Referral | null> {
		const { status, data } = await this.adminGet<unknown>(`/${encodeURIComponent(id)}`);

		if (status === HTTP_NOT_FOUND) {
			return null;
		}
		if (status !== HTTP_OK) {
			throw new ReferralServerError(`Failed to fetch referral`, status, data);
		}

		return isReferral(data) ? data : null;
	}

	async create(input: ReferralInput, ctx: AuthorContext): Promise<Referral> {
		const body = {
			evacuee_id: input.evacuee_id,
			to_org: input.to_org,
			reason: input.reason,
			urgency: input.urgency,
			status: 'draft' as const,
			timeline: {},
			notes: input.notes
		};

		const doc = makeDoc('referral', 1, body, ctx) as unknown as Referral;

		const { status, data } = await this.adminPut<PutResultResponse>(
			`/${encodeURIComponent(doc._id)}`,
			doc
		);

		if (status !== HTTP_CREATED && status !== HTTP_OK) {
			throw new ReferralServerError(`Failed to write referral doc`, status, data);
		}

		return { ...doc, _rev: data.rev };
	}

	async transition(id: string, to: ReferralStatus, actor: string): Promise<Referral> {
		const latest = await this.get(id);
		if (!latest) {
			throw new ReferralServerError(`Referral not found`, HTTP_NOT_FOUND);
		}

		const updated = applyTransition(latest, to, actor, new Date().toISOString());
		const touched = touch(updated);

		const { status, data } = await this.adminPut<PutResultResponse>(
			`/${encodeURIComponent(touched._id)}`,
			touched
		);

		if (status !== HTTP_CREATED && status !== HTTP_OK) {
			throw new ReferralServerError(`Failed to update referral transition`, status, data);
		}

		return { ...touched, _rev: data.rev };
	}
}
