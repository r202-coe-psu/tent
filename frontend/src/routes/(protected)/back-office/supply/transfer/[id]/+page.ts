import { requireWarehouseAccess } from '$lib/guards/auth';
import type { PageLoad } from './$types';

// CR-091 FR-01 — UX gate only; the real boundary is the 403 from GET /api/back-office/transfer/[id].
export const load = (async ({ params, fetch }) => {
	await requireWarehouseAccess(fetch);
	return { id: params.id };
}) satisfies PageLoad;
