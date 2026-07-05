import { requireManager } from '$lib/guards/auth';
import type { PageLoad } from './$types';

// Evacuee PII — restrict to system_admin + shelter_manager. Explicit here rather
// than relying on the back-office layout, which now only requireAuth so page-level
// guards like requireKitchen can run (kitchen_staff, CR-024).
export const load = (async ({ fetch }) => {
	await requireManager(fetch);
}) satisfies PageLoad;
