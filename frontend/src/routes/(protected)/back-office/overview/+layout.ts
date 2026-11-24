import { requireManager } from '$lib/guards/auth';
import type { LayoutLoad } from './$types';

// Centre dashboards: system_admin + shelter_manager of the selected shelter — same predicate
// as the "ภาพรวมระบบ" nav button (canAccessManagerPages).
export const load = (async ({ fetch }) => {
	await requireManager(fetch);
}) satisfies LayoutLoad;
