import { describe, it, expect } from 'vitest';
import { selectableCookingIngredients } from './cooking-ingredients';

describe('selectableCookingIngredients', () => {
	it('keeps only active food and drinking-water item masters', () => {
		const masters = [
			{ _id: 'item_master:rice', category: 'item_category:food' },
			{ _id: 'item_master:egg', category: 'อาหารและวัตถุดิบ' },
			{ _id: 'item_master:water', category: 'item_category:water' },
			{ _id: 'item_master:formula', category: 'item_category:special_care' },
			{ _id: 'item_master:soap', category: 'item_category:wash' },
			{ _id: 'item_master:paracetamol', category: 'item_category:medical' },
			{ _id: 'item_master:nocat' },
			{ _id: 'item_master:old-oil', category: 'item_category:food', deactivated: true },
			{
				_id: 'item_master:dup-rice',
				category: 'item_category:food',
				merged_into: 'item_master:rice'
			}
		];
		expect(selectableCookingIngredients(masters).map((m) => m._id)).toEqual([
			'item_master:rice',
			'item_master:egg',
			'item_master:water'
		]);
	});

	it('returns an empty list when masters are not loaded', () => {
		expect(selectableCookingIngredients(undefined)).toEqual([]);
	});
});
