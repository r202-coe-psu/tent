import { type AuthorContext } from '$lib/db/model';
import { getShelterCode } from '$lib/db/shelter';
import {
	isReferral,
	type Referral,
	type ReferralFilter,
	type ReferralInput,
	type ReferralPage,
	type ReferralStatus
} from '../domain/referral.schema';
import type {
	ReferralBatchResult,
	ReferralBulkTransitionResult,
	ReferralRepository,
	ReferralSubmitIntent
} from './referral.repository';

/**
 * Every referral transition (capacity and non-capacity) goes through the BFF, which applies the
 * state machine and scope checks. Capacity-specific rules on that path:
 * - `accepted`/`rejected` → destination-only; accept runs the cross-DB evacuee transfer first
 * - `sent`, `closed` → single write to the referral doc in `central_ops`; no copy is made
 */
async function transitionCapacityViaBff(
	id: string,
	to: ReferralStatus,
	reason: string | undefined,
	shelterCode: string
): Promise<Referral> {
	const qs = new URLSearchParams({ shelter_code: shelterCode });
	const res = await fetch(`/api/back-office/referral/${encodeURIComponent(id)}/transition?${qs}`, {
		method: 'PATCH',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
		body: JSON.stringify({ to, reason })
	});

	const payload = await res.json().catch(() => null);
	if (!res.ok) {
		const message =
			payload && typeof payload === 'object' && 'error' in payload
				? String((payload as { error: unknown }).error)
				: `Capacity referral transition failed (${res.status})`;
		throw new Error(message);
	}

	if (!isReferral(payload)) {
		throw new Error('Capacity referral transition returned an invalid referral document');
	}
	return payload;
}

export class ReferralRemoteRepository implements ReferralRepository {
	async list(filter?: ReferralFilter): Promise<Referral[]> {
		return (await this.listPage(filter)).items;
	}

	async listPage(filter?: ReferralFilter): Promise<ReferralPage> {
		const qs = new URLSearchParams({ shelter_code: getShelterCode() });
		if (filter) {
			if (filter.status) qs.append('status', filter.status);
			if (filter.evacuee_id) qs.append('evacuee_id', filter.evacuee_id);
			if (filter.limit) qs.append('limit', filter.limit.toString());
			if (filter.sort) qs.append('sort', filter.sort);
			if (filter.direction) qs.append('direction', filter.direction);
			if (filter.bookmark) qs.append('bookmark', filter.bookmark);
		}
		const res = await fetch(`/api/back-office/referral?${qs}`, {
			credentials: 'include',
			headers: { Accept: 'application/json' }
		});
		if (!res.ok) {
			throw new Error(`Failed to list referrals: ${res.statusText}`);
		}
		const payload = (await res.json()) as {
			items?: unknown[];
			bookmark?: string | null;
			has_more?: boolean;
		};
		const rawItems = Array.isArray(payload?.items) ? payload.items : [];
		const items: Referral[] = rawItems.filter(isReferral);
		const dropped = rawItems.length - items.length;
		if (dropped > 0) {
			// Malformed docs are skipped so one bad row does not hide the rest; log so it is traceable.
			console.warn(`[referrals] skipped ${dropped} malformed referral doc(s) in list response`);
		}
		return { items, bookmark: payload?.bookmark ?? null, hasMore: payload?.has_more === true };
	}

	async get(id: string): Promise<Referral | null> {
		const qs = new URLSearchParams({ shelter_code: getShelterCode() });
		const res = await fetch(`/api/back-office/referral/${encodeURIComponent(id)}?${qs}`, {
			credentials: 'include',
			headers: { Accept: 'application/json' }
		});
		if (res.status === 404) return null;
		if (!res.ok) {
			throw new Error(`Failed to get referral: ${res.statusText}`);
		}
		const doc = await res.json();
		return isReferral(doc) ? doc : null;
	}

	async getBatch(id: string): Promise<Referral[]> {
		const qs = new URLSearchParams({ shelter_code: getShelterCode() });
		const res = await fetch(`/api/back-office/referral/${encodeURIComponent(id)}/batch?${qs}`, {
			credentials: 'include',
			headers: { Accept: 'application/json' }
		});
		if (res.status === 404) return [];
		if (!res.ok) {
			throw new Error(`Failed to get referral batch: ${res.statusText}`);
		}
		const payload = (await res.json()) as { items?: unknown[] };
		return (Array.isArray(payload?.items) ? payload.items : []).filter(isReferral);
	}

	async create(input: ReferralInput): Promise<Referral> {
		const qs = new URLSearchParams({ shelter_code: getShelterCode() });
		const res = await fetch(`/api/back-office/referral?${qs}`, {
			method: 'POST',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify(input)
		});
		const payload = await res.json().catch(() => null);
		if (!res.ok) {
			const message =
				payload && typeof payload === 'object' && 'error' in payload
					? String((payload as { error: unknown }).error)
					: `Failed to create referral (${res.status})`;
			throw new Error(message);
		}
		if (!isReferral(payload)) {
			throw new Error('Create referral returned an invalid referral document');
		}
		return payload;
	}

	async transition(
		id: string,
		to: ReferralStatus,
		actor: string,
		reason?: string
	): Promise<Referral> {
		// Every transition goes through the BFF (scope checks, state machine, dest-gated accept).
		return transitionCapacityViaBff(id, to, reason, getShelterCode());
	}

	async bulkTransition(
		ids: string[],
		to: ReferralStatus,
		reason?: string
	): Promise<ReferralBulkTransitionResult> {
		const qs = new URLSearchParams({ shelter_code: getShelterCode() });
		const res = await fetch(`/api/back-office/referral/bulk-transition?${qs}`, {
			method: 'POST',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify({ ids, to, reason })
		});

		const payload: unknown = await res.json().catch(() => null);
		if (!res.ok) {
			const message =
				payload && typeof payload === 'object' && 'error' in payload
					? String((payload as { error: unknown }).error)
					: `Bulk referral transition failed (${res.status})`;
			throw new Error(message);
		}
		const result = parseBulkTransitionResult(payload);
		if (!result) {
			throw new Error('Bulk referral transition returned an invalid result');
		}
		return result;
	}
}

function parseBulkTransitionResult(value: unknown): ReferralBulkTransitionResult | null {
	if (!value || typeof value !== 'object') return null;
	const { succeeded, failed } = value as Record<string, unknown>;
	if (!Array.isArray(succeeded) || !Array.isArray(failed)) return null;
	// These writes already happened, so a malformed doc must not fail the whole call: keep the
	// valid ones and warn, like the list does.
	const docs = succeeded.filter(isReferral);
	const dropped = succeeded.length - docs.length;
	if (dropped > 0) {
		console.warn(
			`[referrals] skipped ${dropped} malformed referral doc(s) in bulk transition response`
		);
	}
	const failures = failed.filter(
		(f): f is { id: string; error: string } =>
			!!f &&
			typeof f === 'object' &&
			typeof (f as { id?: unknown }).id === 'string' &&
			typeof (f as { error?: unknown }).error === 'string'
	);
	if (failures.length !== failed.length) return null;
	return { succeeded: docs, failed: failures };
}

/**
 * Transition many referrals in one request (CR-167). Partial success: inspect `failed`.
 * Thin client only; UI wiring and a query hook come with the list work.
 */
export function bulkTransitionReferrals(
	ids: string[],
	to: ReferralStatus,
	reason?: string
): Promise<ReferralBulkTransitionResult> {
	return referralRepository().bulkTransition(ids, to, reason);
}

let singleton: ReferralRepository | null = null;

export function referralRepository(): ReferralRepository {
	if (!singleton) {
		singleton = new ReferralRemoteRepository();
	}
	return singleton;
}

/**
 * Create one referral per evacuee (shared template fields), optionally transition each to `sent`.
 * Continues on per-person failure so the UI can show partial success.
 */
export async function createReferralBatch(
	template: ReferralInput,
	evacueeIds: string[],
	options: {
		intent: ReferralSubmitIntent;
		ctx: AuthorContext;
		repo?: ReferralRepository;
	}
): Promise<ReferralBatchResult> {
	const repo = options.repo ?? referralRepository();
	const created: Referral[] = [];
	const failed: ReferralBatchResult['failed'] = [];

	for (const evacuee_id of evacueeIds) {
		try {
			const input = { ...template, evacuee_id } as ReferralInput;
			let doc = await repo.create(input, options.ctx);
			if (options.intent === 'send') {
				doc = await repo.transition(doc._id, 'sent', options.ctx.createdBy);
			}
			created.push(doc);
		} catch (err) {
			failed.push({
				evacuee_id,
				error: err instanceof Error ? err.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ'
			});
		}
	}

	return { created, failed };
}
