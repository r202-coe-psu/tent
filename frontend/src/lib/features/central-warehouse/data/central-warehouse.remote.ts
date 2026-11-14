/**
 * Browser → BFF calls for the central warehouse (M6) (draft CR M6 §2, §6).
 * The browser never talks to FastAPI or M6; the shelter comes from the selected shelter and the
 * BFF re-checks it against the session.
 */
import { getShelterCode } from '$lib/db/shelter';
import {
	catalogListSchema,
	stockListSchema,
	warehouseListSchema,
	withdrawalListSchema,
	withdrawalViewSchema,
	type CatalogList,
	type StockList,
	type Warehouse,
	type WithdrawalView
} from '../domain/central-warehouse.schema';
import type { WithdrawalCreateInput } from '../domain/central-warehouse.payload';
import type { z } from 'zod';

/** A BFF failure with its machine code (`M6_NOT_CANCELLABLE`, `SHELTER_LOCATION_MISSING`, …). */
export class CentralWarehouseError extends Error {
	constructor(
		readonly status: number,
		readonly code: string | undefined,
		message: string,
		readonly extra: Record<string, unknown> = {}
	) {
		super(message);
		this.name = 'CentralWarehouseError';
	}
}

const BASE = '/api/back-office/central-warehouse';

async function bff<S extends z.ZodType>(
	schema: S,
	path: string,
	init: RequestInit = {}
): Promise<z.infer<S>> {
	const qs = new URLSearchParams({ shelter_code: getShelterCode() });
	const sep = path.includes('?') ? '&' : '?';
	const res = await fetch(`${BASE}${path}${sep}${qs}`, {
		credentials: 'include',
		...init,
		headers: {
			Accept: 'application/json',
			...(init.body ? { 'Content-Type': 'application/json' } : {}),
			...init.headers
		}
	});
	const payload: unknown = await res.json().catch(() => null);
	if (!res.ok) {
		const { error, code, ...extra } = (payload ?? {}) as {
			error?: unknown;
			code?: unknown;
			[k: string]: unknown;
		};
		throw new CentralWarehouseError(
			res.status,
			typeof code === 'string' ? code : undefined,
			typeof error === 'string' ? error : `คำขอไม่สำเร็จ (${res.status})`,
			extra
		);
	}
	const parsed = schema.safeParse(payload);
	if (!parsed.success) {
		throw new CentralWarehouseError(502, 'BAD_RESPONSE', 'ระบบกลางตอบกลับในรูปแบบที่ไม่รู้จัก');
	}
	return parsed.data;
}

const enc = encodeURIComponent;

function withParams(path: string, params: Record<string, string | undefined>): string {
	const qs = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
	return qs.size ? `${path}?${qs}` : path;
}

export async function fetchWarehouses(): Promise<Warehouse[]> {
	return (await bff(warehouseListSchema, '/warehouses')).data;
}

export function fetchWarehouseStock(
	code: string,
	filter: { search?: string; type_code?: string } = {}
): Promise<StockList> {
	return bff(
		stockListSchema,
		withParams(`/warehouses/${enc(code)}/stock`, {
			search: filter.search?.trim(),
			type_code: filter.type_code
		})
	);
}

export function searchCatalog(params: {
	q?: string;
	type_code?: string;
	warehouse_code?: string;
	cursor?: string;
}): Promise<CatalogList> {
	return bff(
		catalogListSchema,
		withParams('/catalog', {
			q: params.q?.trim(),
			type_code: params.type_code,
			warehouse_code: params.warehouse_code,
			cursor: params.cursor
		})
	);
}

export async function fetchWithdrawals(): Promise<WithdrawalView[]> {
	return (await bff(withdrawalListSchema, '/withdrawals')).data;
}

export function fetchWithdrawal(requestCode: string): Promise<WithdrawalView> {
	return bff(withdrawalViewSchema, `/withdrawals/${enc(requestCode)}`);
}

export function createWithdrawalRemote(input: WithdrawalCreateInput): Promise<WithdrawalView> {
	return bff(withdrawalViewSchema, '/withdrawals', {
		method: 'POST',
		body: JSON.stringify(input)
	});
}

export function cancelWithdrawalRemote(
	requestCode: string,
	reason: string
): Promise<WithdrawalView> {
	return bff(withdrawalViewSchema, `/withdrawals/${enc(requestCode)}/cancel`, {
		method: 'POST',
		body: JSON.stringify({ reason })
	});
}
