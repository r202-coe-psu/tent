import { describe, expect, it } from 'vitest';
import { THAI_MOBILE_PHONE_MESSAGE } from '$lib/db/model';
import {
	WALKIN_FORM_MESSAGES as M,
	walkinFormSchema,
	type WalkinFormValues,
	type WalkinLine
} from './walkin-form.schema';

const perishable = new Set(['item:egg']);
const schema = walkinFormSchema({ isPerishable: (id) => perishable.has(id) });

const line = (over: Partial<WalkinLine> = {}): WalkinLine => ({
	id: 'l1',
	itemId: 'item:rice',
	name: 'ข้าวสาร',
	qty: '5',
	unit: 'kg',
	expiry: '',
	storagePointId: '',
	...over
});

const form = (over: Partial<WalkinFormValues> = {}): WalkinFormValues => ({
	name: 'สมชาย',
	phone: '',
	email: '',
	items: [line()],
	...over
});

function issues(values: WalkinFormValues) {
	const out: Record<string, string[]> = {};
	for (const issue of schema.safeParse(values).error?.issues ?? []) {
		(out[issue.path.join('.')] ??= []).push(issue.message);
	}
	return out;
}

describe('walkinFormSchema', () => {
	it('accepts a donor with one counted item and no phone or email', () => {
		expect(schema.safeParse(form()).success).toBe(true);
	});

	it('requires the donor name', () => {
		expect(issues(form({ name: '   ' }))).toEqual({ name: [M.name] });
	});

	it('leaves the phone optional but holds a typed one to the mobile rule', () => {
		expect(schema.safeParse(form({ phone: '' })).success).toBe(true);
		expect(schema.safeParse(form({ phone: '0891234567' })).success).toBe(true);
		expect(schema.safeParse(form({ phone: '+66891234567' })).success).toBe(true);
		expect(issues(form({ phone: '089' }))).toEqual({ phone: [THAI_MOBILE_PHONE_MESSAGE] });
		expect(issues(form({ phone: 'abc' }))).toEqual({ phone: [THAI_MOBILE_PHONE_MESSAGE] });
	});

	it('does not rewrite the typed phone', () => {
		const parsed = schema.safeParse(form({ phone: '+66891234567' }));
		expect(parsed.data?.phone).toBe('+66891234567');
	});

	it('needs at least one picked item', () => {
		expect(issues(form({ items: [line({ itemId: '', qty: '0' })] }))).toEqual({
			'items.0.itemId': [M.noItem]
		});
	});

	it('ignores empty rows next to a filled one', () => {
		expect(
			schema.safeParse(form({ items: [line(), line({ id: 'l2', itemId: '', qty: '0' })] })).success
		).toBe(true);
	});

	it.each(['0', '', '-1', 'abc'])('flags a picked item with qty %j', (qty) => {
		expect(issues(form({ items: [line({ qty })] }))).toEqual({ 'items.0.qty': [M.qty] });
	});

	it("accepts a decimal qty (whole-number units are the component's live check)", () => {
		expect(schema.safeParse(form({ items: [line({ qty: '1.5' })] })).success).toBe(true);
	});

	it('requires an expiry only for perishable items', () => {
		const egg = line({ itemId: 'item:egg', name: 'ไข่ไก่' });
		expect(issues(form({ items: [egg] }))).toEqual({ 'items.0.expiry': [M.expiry] });
		expect(issues(form({ items: [{ ...egg, expiry: '  ' }] }))).toEqual({
			'items.0.expiry': [M.expiry]
		});
		expect(schema.safeParse(form({ items: [{ ...egg, expiry: '2026-12-31' }] })).success).toBe(
			true
		);
		expect(schema.safeParse(form()).success).toBe(true);
	});

	it('reports errors per line index', () => {
		const result = issues(
			form({
				items: [line(), line({ id: 'l2', qty: '0' }), line({ id: 'l3', itemId: 'item:egg' })]
			})
		);
		expect(result).toEqual({ 'items.1.qty': [M.qty], 'items.2.expiry': [M.expiry] });
	});

	it('reports name, phone and line problems together', () => {
		expect(issues(form({ name: '', phone: '1', items: [line({ qty: '0' })] }))).toEqual({
			name: [M.name],
			phone: [M.phone],
			'items.0.qty': [M.qty]
		});
	});
});
