import { serviceFetch } from '$lib/api/service';
import type { MasterData, MasterDataItem, MasterDataType } from '../domain/master-data';

/**
 * Master Data Engine — service plane client (CR-010).
 *
 * Talks to `/api/back-office/master-data/*` (admin-only server BFF). SA-only
 * writes; reads are open to any authenticated user (Phase 2 will widen the
 * surface to `/api/v1/*` for forms).
 *
 * Errors propagate as thrown `Error` from `serviceFetch`; the UI toasts the
 * message. No console.log — the service plane uses toast notifications only.
 */

const BASE = '/api/back-office/master-data';

export type MasterDataSummary = Pick<MasterData, '_id' | 'master_type' | 'items'>;

export function listMasters(): Promise<MasterDataSummary[]> {
	return serviceFetch<MasterDataSummary[]>(BASE);
}

export function getMaster(type: MasterDataType): Promise<MasterDataSummary> {
	return serviceFetch<MasterDataSummary>(`${BASE}/${encodeURIComponent(type)}`);
}

export function putMaster(
	type: MasterDataType,
	items: readonly MasterDataItem[]
): Promise<{ ok: true; rev: string }> {
	return serviceFetch(`${BASE}/${encodeURIComponent(type)}`, {
		method: 'PUT',
		body: JSON.stringify({ items })
	});
}

export function deleteItem(type: MasterDataType, code: string): Promise<{ ok: true; rev: string }> {
	return serviceFetch(`${BASE}/${encodeURIComponent(type)}/items/${encodeURIComponent(code)}`, {
		method: 'DELETE'
	});
}
