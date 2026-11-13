/**
 * The withdrawal cart (draft CR M6 §2): one source warehouse, held in component state and
 * mirrored to `sessionStorage` so a reload keeps it. No CouchDB doc — a cart is not a record
 * until it is sent to M6.
 */
import {
	EMPTY_CART,
	addToCart,
	cartBlockers,
	needsClear,
	removeLine,
	setLineQty,
	type Cart,
	type CartForm
} from '../domain/central-warehouse.cart';
import type { StockItem, Warehouse } from '../domain/central-warehouse.schema';

const STORAGE_PREFIX = 'm6-cart:';

function load(key: string): Cart {
	try {
		const raw = sessionStorage.getItem(key);
		if (!raw) return EMPTY_CART;
		const parsed = JSON.parse(raw) as Cart;
		if (!parsed.warehouse_code || !Array.isArray(parsed.lines) || parsed.lines.length === 0) {
			return EMPTY_CART;
		}
		return parsed;
	} catch {
		return EMPTY_CART;
	}
}

export class WithdrawalCartState {
	cart = $state.raw<Cart>(EMPTY_CART);
	reason = $state('');
	contactRole = $state('');
	contactPhone = $state('');

	readonly #key: string;

	constructor(shelterCode: string) {
		this.#key = `${STORAGE_PREFIX}${shelterCode}`;
		this.cart = load(this.#key);
	}

	get count(): number {
		return this.cart.lines.length;
	}

	get form(): CartForm {
		return {
			reason: this.reason,
			contact_role: this.contactRole,
			contact_phone: this.contactPhone
		};
	}

	get blockers(): string[] {
		return cartBlockers(this.cart, this.form);
	}

	/** True when adding from `warehouseCode` would mix warehouses — ask the user to clear first. */
	needsClear(warehouseCode: string): boolean {
		return needsClear(this.cart, warehouseCode);
	}

	add(
		warehouse: Pick<Warehouse, 'warehouse_code' | 'name'>,
		item: Pick<StockItem, 'item_code' | 'name' | 'unit' | 'type_code' | 'available'>
	): void {
		this.#set(addToCart(this.cart, warehouse, item));
	}

	/** Clear, then add — the "switch warehouse" path. */
	replaceWith(
		warehouse: Pick<Warehouse, 'warehouse_code' | 'name'>,
		item: Pick<StockItem, 'item_code' | 'name' | 'unit' | 'type_code' | 'available'>
	): void {
		this.#set(addToCart(EMPTY_CART, warehouse, item));
	}

	setQty(itemCode: string, qty: number): void {
		this.#set(setLineQty(this.cart, itemCode, qty));
	}

	remove(itemCode: string): void {
		this.#set(removeLine(this.cart, itemCode));
	}

	clear(): void {
		this.#set(EMPTY_CART);
	}

	/** After a successful send: empty the cart and the reason (contact stays for the next one). */
	reset(): void {
		this.clear();
		this.reason = '';
	}

	#set(next: Cart): void {
		this.cart = next;
		try {
			if (next.lines.length === 0) sessionStorage.removeItem(this.#key);
			else sessionStorage.setItem(this.#key, JSON.stringify(next));
		} catch {
			// Storage unavailable (private mode): the cart still works for this page view.
		}
	}
}
