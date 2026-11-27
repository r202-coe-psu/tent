import { requireWarehouseAccess } from '$lib/guards/auth';
import type { PageLoad } from './$types';

// SA, SM, warehouse_staff and supply_coordinator of the active shelter (#845). Page-level only:
// who may edit what inside stays with CR-235 (the page and `validate_doc_update`).
export const load = (async ({ fetch }) => {
	await requireWarehouseAccess(fetch);
}) satisfies PageLoad;
