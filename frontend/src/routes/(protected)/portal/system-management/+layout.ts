import { requireAdmin } from '$lib/guards/auth';
import type { LayoutLoad } from './$types';

// System Management is SA-only across the whole area (cross-shelter registry,
// global master data, announcements, host houses). Guard at the layout so every
// child route is protected without repeating requireAdmin per page (CR-049 FR-049-8).
export const load = (async ({ fetch }) => {
	await requireAdmin(fetch);
}) satisfies LayoutLoad;
