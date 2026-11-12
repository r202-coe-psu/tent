/**
 * Central warehouse (M6) — wire shapes the BFF returns (draft CR M6 §2, §6).
 *
 * Pure TypeScript / Zod — No I/O, No Svelte. The BFF mirrors FastAPI's `/v1/integrations/m6/*`
 * bodies minus internal fields. Withdrawal `status` stays a plain string on the wire so a status
 * M6 adds later cannot break the whole list; {@link withdrawalStatusMeta} labels unknown ones.
 */
import { z } from 'zod';

export const warehouseSchema = z.object({
	warehouse_code: z.string().min(1),
	name: z.string(),
	district: z.string().nullish(),
	lat: z.number().nullish(),
	lng: z.number().nullish()
});
export type Warehouse = z.infer<typeof warehouseSchema>;

export const warehouseListSchema = z.object({
	data: z.array(warehouseSchema),
	total: z.number().optional()
});

export const stockItemSchema = z.object({
	item_code: z.string().min(1),
	reference_id: z.union([z.string(), z.number()]).nullish(),
	name: z.string(),
	type_code: z.string().nullish(),
	unit: z.string(),
	on_hand: z.number(),
	available: z.number()
});
export type StockItem = z.infer<typeof stockItemSchema>;

export const stockListSchema = z.object({
	warehouse_code: z.string(),
	data: z.array(stockItemSchema),
	total: z.number().optional()
});
export type StockList = z.infer<typeof stockListSchema>;

export const catalogItemSchema = z.object({
	reference_id: z.union([z.string(), z.number()]),
	name_th: z.string(),
	name_en: z.string().nullish(),
	type_code: z.string().nullish(),
	base_unit: z.string().nullish(),
	warehouses_count: z.number().default(0),
	item_code: z.string().nullish(),
	/** Only set when the search named a warehouse. */
	in_warehouse: z.boolean().nullish()
});
export type CatalogItem = z.infer<typeof catalogItemSchema>;

export const catalogListSchema = z.object({
	data: z.array(catalogItemSchema),
	cursor: z.string().nullish(),
	total: z.number().optional()
});
export type CatalogList = z.infer<typeof catalogListSchema>;

export const withdrawalLineSchema = z.object({
	item_code: z.string(),
	name: z.string(),
	unit: z.string(),
	type_code: z.string().nullish(),
	qty: z.number(),
	qty_fulfilled: z.number().nullish()
});
export type WithdrawalLine = z.infer<typeof withdrawalLineSchema>;

export const withdrawalViewSchema = z.object({
	external_ref: z.string(),
	request_code: z.string(),
	shelter_code: z.string(),
	status: z.string(),
	source_warehouse_code: z.string(),
	source_warehouse_name: z.string().nullish(),
	lines: z.array(withdrawalLineSchema),
	reason: z.string().nullish(),
	requested_by: z.object({ name: z.string(), username: z.string().nullish() }).nullish(),
	contact_role: z.string().nullish(),
	contact_phone: z.string().nullish(),
	submitted_at: z.string().nullish(),
	approved_at: z.string().nullish(),
	completed_at: z.string().nullish(),
	cancelled_at: z.string().nullish(),
	cancel_reason: z.string().nullish(),
	donation_id: z.string().nullish(),
	confirmed_at: z.string().nullish(),
	confirm_error: z.string().nullish(),
	fetched_at: z.string().nullish(),
	created_at: z.string().nullish(),
	/** True when this answer was refreshed from M6 just now; false = Mongo snapshot. */
	live: z.boolean().optional()
});
export type WithdrawalView = z.infer<typeof withdrawalViewSchema>;

export const withdrawalListSchema = z.object({
	data: z.array(withdrawalViewSchema),
	total: z.number().optional()
});

/** Statuses M6 reports (RES-006). */
export const M6_STATUSES = [
	'pending',
	'approved',
	'partially_approved',
	'in_transit',
	'issued',
	'received',
	'rejected',
	'cancelled'
] as const;
export type M6WithdrawalStatus = (typeof M6_STATUSES)[number];

export type M6StatusTone = 'sky' | 'emerald' | 'red' | 'amber' | 'muted';

export const M6_STATUS_META: Record<M6WithdrawalStatus, { label: string; tone: M6StatusTone }> = {
	pending: { label: 'รอ M6 พิจารณา', tone: 'amber' },
	approved: { label: 'อนุมัติแล้ว', tone: 'sky' },
	partially_approved: { label: 'อนุมัติบางส่วน', tone: 'sky' },
	in_transit: { label: 'กำลังจัดส่ง', tone: 'sky' },
	// `issued` = M6 closed the request without shipping (CR §1): staff must call M6.
	issued: { label: 'M6 ปิดใบโดยไม่มีการจัดส่ง', tone: 'red' },
	received: { label: 'รับของแล้ว', tone: 'emerald' },
	rejected: { label: 'ไม่อนุมัติ', tone: 'red' },
	cancelled: { label: 'ยกเลิกแล้ว', tone: 'muted' }
};

export function isKnownWithdrawalStatus(status: string): status is M6WithdrawalStatus {
	return (M6_STATUSES as readonly string[]).includes(status);
}

/** Label and tone for a status; an unknown one shows its raw text in a muted tone. */
export function withdrawalStatusMeta(status: string): { label: string; tone: M6StatusTone } {
	return isKnownWithdrawalStatus(status)
		? M6_STATUS_META[status]
		: { label: status || 'ไม่ทราบสถานะ', tone: 'muted' };
}

/** Only a `pending` request can be cancelled (RES-008). */
export function isCancellable(status: string): boolean {
	return status === 'pending';
}

/** `issued` is a closed request nothing shipped for — show "ประสาน M6" (CR §1). */
export function needsM6Coordination(status: string): boolean {
	return status === 'issued';
}

/**
 * Statuses where M6 has not dispatched anything, so `qty_fulfilled` means nothing yet.
 * M6 staging answers `qty_fulfilled: 0` (not null) while a request is still pending.
 */
const NOT_DISPATCHED = new Set(['pending', 'rejected', 'cancelled']);

/** The fulfilled quantity to show for a line: `null` (shown as "–") until M6 dispatches. */
export function shownFulfilled(
	status: string,
	qtyFulfilled: number | null | undefined
): number | null {
	if (NOT_DISPATCHED.has(status)) return null;
	return qtyFulfilled ?? null;
}

/** Total requested vs fulfilled across lines (fulfilled is `null` until M6 answers). */
export function withdrawalTotals(w: Pick<WithdrawalView, 'lines'> & { status?: string }): {
	requested: number;
	fulfilled: number | null;
} {
	const requested = w.lines.reduce((sum, l) => sum + l.qty, 0);
	const shown = w.lines.map((l) =>
		w.status === undefined ? (l.qty_fulfilled ?? null) : shownFulfilled(w.status, l.qty_fulfilled)
	);
	const fulfilled = shown.some((q) => q != null)
		? shown.reduce<number>((sum, q) => sum + (q ?? 0), 0)
		: null;
	return { requested, fulfilled };
}
