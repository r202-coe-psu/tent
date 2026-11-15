import { requireReferralAccess } from '$lib/guards/auth';
import type { LayoutLoad } from './$types';

// OneData M5 (draft CR M5 D17): same audience as referrals — SA, SM and medical staff.
export const load = (async ({ fetch }) => {
	await requireReferralAccess(fetch);
}) satisfies LayoutLoad;
