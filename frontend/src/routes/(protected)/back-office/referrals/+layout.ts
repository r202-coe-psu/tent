import { requireReferralAccess } from '$lib/guards/auth';
import type { LayoutLoad } from './$types';

// One guard for the list, create, detail and batch routes. Medical staff get in too, for
// medical-emergency referrals only (M5 draft CR D8, D16).
export const load = (async ({ fetch }) => {
	await requireReferralAccess(fetch);
}) satisfies LayoutLoad;
