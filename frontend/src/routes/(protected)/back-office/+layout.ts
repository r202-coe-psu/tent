import { requireAuth } from '$lib/guards/auth';
import type { LayoutLoad } from './$types';

// Only gate on authentication here — each back-office page picks its own role
// guard (requireManager / requireAdmin / requireKitchen / requireAuth). A
// requireManager gate at this level pre-empted every page guard, so
// kitchen_staff (CR-024) was redirected before ever reaching requireKitchen.
export const load = (async ({ fetch }) => {
	await requireAuth(fetch);
}) satisfies LayoutLoad;
