import { describe, it, expect } from 'vitest';
import { carryItemIds, type BareItem } from './carry-item-ids';

const held = [{ item_id: 'item:blanket', free_text: 'ผ้าห่ม', qty: '20', unit: 'piece' }];

describe('carryItemIds', () => {
	it('restores an item_id the client dropped, matching on the name it round-tripped', () => {
		expect(carryItemIds([{ free_text: 'ผ้าห่ม', qty: '100' }], held)).toEqual([
			{ item_id: 'item:blanket', free_text: 'ผ้าห่ม', qty: '100' }
		]);
	});

	it('leaves an item_id the client did send alone', () => {
		const sent = [{ item_id: 'item:soap', free_text: 'ผ้าห่ม', qty: '1' }];
		expect(carryItemIds(sent, held)).toEqual(sent);
	});

	it('leaves a genuinely new line untracked', () => {
		// Nothing is inferred from arbitrary words — only this booking's own lines match.
		expect(
			carryItemIds<BareItem>([{ free_text: 'ยาพารา', qty: '5' }], held)[0]!.item_id
		).toBeUndefined();
	});

	it('ignores held lines with no name to match on', () => {
		expect(carryItemIds([{ free_text: '', qty: '1' }], [{ item_id: 'item:x', qty: '1' }])).toEqual([
			{ free_text: '', qty: '1' }
		]);
	});

	// CR-196 — two held lines of one name: the key, not the name, says which one this is.
	describe('a line carrying a line_key', () => {
		const twoShirts = [
			{ line_key: 'K1', item_id: 'item:shirt-new', free_text: 'เสื้อ', qty: '3' },
			{ line_key: 'K2', item_id: 'item:shirt-used', free_text: 'เสื้อ', qty: '3' }
		];

		it('takes the item_id of the held line it names', () => {
			expect(
				carryItemIds<BareItem>([{ line_key: 'K2', free_text: 'เสื้อ', qty: '3' }], twoShirts)[0]!
					.item_id
			).toBe('item:shirt-used');
		});

		it('is not matched by name when its held line had no item_id', () => {
			const held = [
				{ line_key: 'K1', free_text: 'ผ้าห่ม', qty: '1' },
				{ line_key: 'K2', item_id: 'item:blanket', free_text: 'ผ้าห่ม', qty: '1' }
			];
			expect(
				carryItemIds<BareItem>([{ line_key: 'K1', free_text: 'ผ้าห่ม', qty: '1' }], held)[0]!
					.item_id
			).toBeUndefined();
		});

		it('is left for FastAPI to refuse when the booking does not hold its key', () => {
			expect(
				carryItemIds<BareItem>([{ line_key: 'K9', free_text: 'เสื้อ', qty: '3' }], twoShirts)[0]!
					.item_id
			).toBeUndefined();
		});
	});

	it('matches on item_name too, and trims', () => {
		const from = [{ item_id: 'item:soap', item_name: 'สบู่ก้อน', qty: '1' }];
		expect(carryItemIds<BareItem>([{ free_text: '  สบู่ก้อน ', qty: '9' }], from)[0]!.item_id).toBe(
			'item:soap'
		);
	});
});
