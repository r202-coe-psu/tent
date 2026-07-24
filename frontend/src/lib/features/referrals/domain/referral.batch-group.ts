/**
 * Presentation grouping for referral list — collapses multi-person create batches
 * into one row when docs share the same template + creator + time bucket.
 *
 * Not persisted (no batch_id on schema yet). Heuristic only for list UI.
 */

import type { Referral, ReferralStatus } from './referral.schema';

/** Sequential batch creates land within this window (ms). */
const BATCH_TIME_BUCKET_MS = 2 * 60 * 1000;

export type ReferralListGroup = {
	key: string;
	referrals: Referral[];
	sample: Referral;
	count: number;
	/** Same status on every member, else null (mixed). */
	sharedStatus: ReferralStatus | null;
	/** Newest created_at in the group (for sort / display). */
	createdAt: string;
};

/** Fingerprint shared template fields + creator + coarse create time. */
export function referralBatchKey(r: Referral): string {
	const t = Math.floor(new Date(r.created_at).getTime() / BATCH_TIME_BUCKET_MS);
	return [
		r.shelter_code,
		r.created_by,
		r.referral_type ?? '',
		r.reason,
		r.urgency,
		r.notes ?? '',
		r.to_shelter_code ?? '',
		r.to_org?.name ?? '',
		r.to_org?.kind ?? '',
		String(t)
	].join('\u0001');
}

/**
 * Group referrals for list display. Input order ignored; groups sorted by
 * newest member first. Members within a group sorted newest first.
 */
export function groupReferralsForList(referrals: Referral[]): ReferralListGroup[] {
	const map = new Map<string, Referral[]>();

	for (const r of referrals) {
		const key = referralBatchKey(r);
		const existing = map.get(key);
		if (existing) existing.push(r);
		else map.set(key, [r]);
	}

	const groups: ReferralListGroup[] = [];
	for (const [key, items] of map) {
		items.sort((a, b) => b.created_at.localeCompare(a.created_at));
		const firstStatus = items[0]!.status;
		const sharedStatus = items.every((i) => i.status === firstStatus) ? firstStatus : null;
		groups.push({
			key,
			referrals: items,
			sample: items[0]!,
			count: items.length,
			sharedStatus,
			createdAt: items[0]!.created_at
		});
	}

	groups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	return groups;
}
