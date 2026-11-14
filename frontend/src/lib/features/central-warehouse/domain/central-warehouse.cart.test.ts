import { describe, expect, it } from 'vitest';
import {
	EMPTY_CART,
	MAX_LINE_QTY,
	addToCart,
	cartBlockers,
	exceedsAvailable,
	needsClear,
	normalizeQty,
	removeLine,
	setLineQty
} from './central-warehouse.cart';

const wh1 = { warehouse_code: 'WH1', name: 'คลังเมือง' };
const wh2 = { warehouse_code: 'WH2', name: 'คลังอำเภอ' };
const water = {
	item_code: 'W-1',
	name: 'น้ำดื่ม',
	unit: 'แพ็ค',
	type_code: 'water',
	available: 50
};
const rice = { item_code: 'R-1', name: 'ข้าวสาร', unit: 'ถุง', type_code: null, available: 5 };

describe('normalizeQty', () => {
	it('keeps whole numbers ≥ 1 and corrects the rest', () => {
		expect(normalizeQty(3)).toBe(3);
		expect(normalizeQty(2.9)).toBe(2);
		expect(normalizeQty(0)).toBe(1);
		expect(normalizeQty(-4)).toBe(1);
		expect(normalizeQty(Number.NaN)).toBe(1);
		expect(normalizeQty(Number.POSITIVE_INFINITY)).toBe(1);
		expect(normalizeQty(MAX_LINE_QTY * 10)).toBe(MAX_LINE_QTY);
	});
});

describe('cart rules', () => {
	it('starts empty and takes the warehouse of the first line', () => {
		const cart = addToCart(EMPTY_CART, wh1, water, 4);
		expect(cart).toMatchObject({ warehouse_code: 'WH1', warehouse_name: 'คลังเมือง' });
		expect(cart.lines).toEqual([
			{ item_code: 'W-1', name: 'น้ำดื่ม', unit: 'แพ็ค', type_code: 'water', qty: 4, available: 50 }
		]);
	});

	it('adds to the quantity when the same item is added again, unit stays locked', () => {
		const cart = addToCart(addToCart(EMPTY_CART, wh1, water), wh1, { ...water, unit: 'ลัง' }, 2);
		expect(cart.lines).toHaveLength(1);
		expect(cart.lines[0]).toMatchObject({ qty: 3, unit: 'แพ็ค' });
	});

	it('allows only one source warehouse per cart', () => {
		const cart = addToCart(EMPTY_CART, wh1, water);
		expect(needsClear(cart, 'WH1')).toBe(false);
		expect(needsClear(cart, 'WH2')).toBe(true);
		expect(needsClear(EMPTY_CART, 'WH2')).toBe(false);
		expect(() => addToCart(cart, wh2, rice)).toThrow();
	});

	it('normalises quantities and forgets the warehouse when emptied', () => {
		let cart = addToCart(addToCart(EMPTY_CART, wh1, water), wh1, rice);
		cart = setLineQty(cart, 'W-1', 7.8);
		expect(cart.lines.find((l) => l.item_code === 'W-1')?.qty).toBe(7);
		cart = setLineQty(cart, 'R-1', 0);
		expect(cart.lines.find((l) => l.item_code === 'R-1')?.qty).toBe(1);
		cart = removeLine(removeLine(cart, 'W-1'), 'R-1');
		expect(cart).toEqual(EMPTY_CART);
		expect(needsClear(cart, 'WH2')).toBe(false);
	});

	it('warns, but does not block, when qty exceeds available', () => {
		expect(exceedsAvailable({ qty: 6, available: 5 })).toBe(true);
		expect(exceedsAvailable({ qty: 5, available: 5 })).toBe(false);
	});
});

describe('cartBlockers', () => {
	const form = { reason: 'ของหมด', contact_role: 'หัวหน้า', contact_phone: '081-234-5678' };
	const cart = addToCart(EMPTY_CART, wh1, rice, 50);

	it('is empty when ready — an over-request is not a blocker', () => {
		expect(cartBlockers(cart, form)).toEqual([]);
	});

	it('lists what is missing', () => {
		expect(cartBlockers(EMPTY_CART, form)).toEqual(['ตะกร้ายังว่างอยู่']);
		const issues = cartBlockers(cart, { reason: ' ', contact_role: '', contact_phone: 'abc' });
		expect(issues).toHaveLength(3);
	});
});
