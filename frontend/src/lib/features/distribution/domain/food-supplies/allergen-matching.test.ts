import { describe, expect, it } from 'vitest';
import { findAllergenConflicts, withFreeTextAllergyReason } from './allergen-matching';

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

describe('withFreeTextAllergyReason (CR-191 FR-MRM-11)', () => {
	it('prefixes the reason with the unlisted allergies', () => {
		expect(withFreeTextAllergyReason(['ถั่วเหลือง', 'ลาเท็กซ์'], 'ผู้รับยืนยันแล้ว')).toBe(
			'แพ้ (ไม่อยู่ในรายการ): ถั่วเหลือง, ลาเท็กซ์ — ผู้รับยืนยันแล้ว'
		);
	});

	it('leaves the reason unchanged without free text', () => {
		expect(withFreeTextAllergyReason([], 'ผู้รับยืนยันแล้ว')).toBe('ผู้รับยืนยันแล้ว');
	});
});
