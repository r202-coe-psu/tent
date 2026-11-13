/**
 * Withdrawal cart rules (draft CR M6 §2): one cart per source warehouse, integer quantities
 * ≥ 1, the unit is locked to the warehouse's own unit, and asking for more than `available` only
 * warns (M6 decides). Pure TypeScript — No I/O, No Svelte.
 */
import type { StockItem, Warehouse } from './central-warehouse.schema';

export type CartLine = {
	item_code: string;
	name: string;
	/** Locked to the warehouse's unit; never edited in the cart. */
	unit: string;
	type_code: string | null;
	qty: number;
	/** `available` when the line was added — used only for the over-request warning. */
	available: number;
};

export type Cart = {
	warehouse_code: string | null;
	warehouse_name: string | null;
	lines: readonly CartLine[];
};

export const EMPTY_CART: Cart = { warehouse_code: null, warehouse_name: null, lines: [] };

export const MAX_LINE_QTY = 1_000_000;

/** Whole number ≥ 1 (`NaN`/fractions/negatives collapse to the nearest valid value). */
export function normalizeQty(value: number): number {
	if (!Number.isFinite(value)) return 1;
	return Math.min(MAX_LINE_QTY, Math.max(1, Math.floor(value)));
}

/** True when adding from `warehouseCode` would mix warehouses and the cart must be cleared first. */
export function needsClear(cart: Cart, warehouseCode: string): boolean {
	return cart.lines.length > 0 && cart.warehouse_code !== warehouseCode;
}

/**
 * Add `item` from `warehouse`. A repeat of the same item adds to its quantity.
 * @throws {Error} when the cart holds another warehouse's lines — callers ask to clear first.
 */
export function addToCart(
	cart: Cart,
	warehouse: Pick<Warehouse, 'warehouse_code' | 'name'>,
	item: Pick<StockItem, 'item_code' | 'name' | 'unit' | 'type_code' | 'available'>,
	qty = 1
): Cart {
	if (needsClear(cart, warehouse.warehouse_code)) {
		throw new Error('ตะกร้าเบิกได้ครั้งละ 1 คลังต้นทาง');
	}
	const add = normalizeQty(qty);
	const existing = cart.lines.find((l) => l.item_code === item.item_code);
	const lines = existing
		? cart.lines.map((l) =>
				l.item_code === item.item_code ? { ...l, qty: normalizeQty(l.qty + add) } : l
			)
		: [
				...cart.lines,
				{
					item_code: item.item_code,
					name: item.name,
					unit: item.unit,
					type_code: item.type_code ?? null,
					qty: add,
					available: item.available
				}
			];
	return { warehouse_code: warehouse.warehouse_code, warehouse_name: warehouse.name, lines };
}

export function setLineQty(cart: Cart, itemCode: string, qty: number): Cart {
	return {
		...cart,
		lines: cart.lines.map((l) => (l.item_code === itemCode ? { ...l, qty: normalizeQty(qty) } : l))
	};
}

/** Remove a line; an emptied cart forgets its warehouse so any warehouse can start a new one. */
export function removeLine(cart: Cart, itemCode: string): Cart {
	const lines = cart.lines.filter((l) => l.item_code !== itemCode);
	return lines.length === 0 ? EMPTY_CART : { ...cart, lines };
}

/** Warning, not an error: M6 weighs the request itself. */
export function exceedsAvailable(line: Pick<CartLine, 'qty' | 'available'>): boolean {
	return line.qty > line.available;
}

export const CONTACT_PHONE_PATTERN = /^[0-9+\-\s()]{8,20}$/;

export type CartForm = { reason: string; contact_role: string; contact_phone: string };

/** Messages that block sending the cart (empty = ready). */
export function cartBlockers(cart: Cart, form: CartForm): string[] {
	const out: string[] = [];
	if (cart.lines.length === 0 || !cart.warehouse_code) out.push('ตะกร้ายังว่างอยู่');
	if (cart.lines.some((l) => !Number.isInteger(l.qty) || l.qty < 1)) {
		out.push('จำนวนต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป');
	}
	if (!form.reason.trim()) out.push('กรุณาระบุเหตุผลการเบิก');
	if (!form.contact_role.trim()) out.push('กรุณาระบุตำแหน่งผู้ติดต่อ');
	if (!CONTACT_PHONE_PATTERN.test(form.contact_phone.trim())) {
		out.push('กรุณาระบุเบอร์โทรผู้ติดต่อให้ถูกต้อง');
	}
	return out;
}
