import { getShelterCode } from '$lib/db/shelter';
import { TransferForbiddenError } from '../domain/operations';
import type { IncomingStockResult } from '../domain/incoming-stock';

/**
 * Client read of `GET /api/back-office/stock/incoming` (#1153). `shelterCode: null` asks for
 * every shelter (system_admin only — the BFF refuses it for anyone else). Defaults to the
 * active shelter.
 */
export async function fetchIncomingStock(
	shelterCode: string | null = getShelterCode()
): Promise<IncomingStockResult> {
	const qs = new URLSearchParams();
	if (shelterCode) qs.set('shelter_code', shelterCode);
	const res = await fetch(`/api/back-office/stock/incoming?${qs}`, {
		credentials: 'include',
		headers: { Accept: 'application/json' }
	});
	if (res.status === 403) throw new TransferForbiddenError();
	if (!res.ok) {
		throw new Error(`Failed to load incoming stock: ${res.statusText}`);
	}
	const body = (await res.json().catch(() => null)) as Partial<IncomingStockResult> | null;
	return {
		rows: Array.isArray(body?.rows) ? body.rows : [],
		unmatched: Array.isArray(body?.unmatched) ? body.unmatched : []
	};
}
