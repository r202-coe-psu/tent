import { requireCentralWarehouseAccess } from '$lib/guards/auth';
import type { LayoutLoad } from './$types';

// OneData M6 (draft CR M6 D2, D18): SA, shelter_manager and warehouse_staff — not supply_coordinator.
export const load = (async ({ fetch }) => {
	await requireCentralWarehouseAccess(fetch);
}) satisfies LayoutLoad;
