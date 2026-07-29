import { type AuthorContext } from '$lib/db/model';
import { getShelterCode } from '$lib/db/shelter';
import {
	isReferral,
	type Referral,
	type ReferralFilter,
	type ReferralInput,
	type ReferralStatus
} from '../domain/referral.schema';
import type {
	ReferralBatchResult,
	ReferralRepository,
	ReferralSubmitIntent
} from './referral.repository';

/**
 * Capacity referrals need BFF/admin for:
 * - `sent` → mirror into destination shelter DB (inbox)
 * - `accepted`/`rejected` → destination-only; accept runs cross-DB transfer
 * - `closed` → sync peer copy
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
		const qs = new URLSearchParams({ shelter_code: getShelterCode() });
		if (filter) {
			if (filter.status) qs.append('status', filter.status);
			if (filter.evacuee_id) qs.append('evacuee_id', filter.evacuee_id);
			if (filter.limit) qs.append('limit', filter.limit.toString());
			if (filter.skip) qs.append('skip', filter.skip.toString());
			if (filter.sort) qs.append('sort', filter.sort);
		}
		const res = await fetch(`/api/back-office/referral?${qs}`, {
			credentials: 'include',
			headers: { Accept: 'application/json' }
		});
		if (!res.ok) {
			throw new Error(`Failed to list referrals: ${res.statusText}`);
		}
		const list = await res.json();
		return list.filter(isReferral);
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
		// All capacity transitions go through BFF (mirror / dest-gated accept / peer sync).
		return transitionCapacityViaBff(id, to, reason, getShelterCode());
	}
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
