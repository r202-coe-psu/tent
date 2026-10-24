import { describe, expect, it } from 'vitest';
import { findAllergenConflicts } from './allergen-matching';

describe('findAllergenConflicts (#607 FR-MRM-07)', () => {
	it('returns the codes on both sides, in menu order', () => {
		// นางบีแพ้ไข่ — ข้าวผัดกุ้ง (อาหารทะเล, ไข่)
		expect(findAllergenConflicts(['egg'], ['seafood', 'egg'])).toEqual(['egg']);
		expect(findAllergenConflicts(['egg', 'seafood'], ['seafood', 'egg'])).toEqual([
			'seafood',
			'egg'
		]);
	});

	it('is empty when nothing is shared', () => {
		// ข้าวมันไก่ (ไม่มีสารก่อแพ้)
		expect(findAllergenConflicts(['egg'], [])).toEqual([]);
		expect(findAllergenConflicts(['egg'], ['wheat'])).toEqual([]);
		expect(findAllergenConflicts([], ['egg'])).toEqual([]);
	});

	it('does not repeat a code listed twice on the menu', () => {
		expect(findAllergenConflicts(['milk'], ['milk', 'milk'])).toEqual(['milk']);
	});
});
