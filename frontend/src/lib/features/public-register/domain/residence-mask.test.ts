import { describe, expect, it } from 'vitest';
import { maskLastName, maskedMemberName } from './residence-mask';

describe('maskLastName', () => {
	it('keeps a trailing Thai vowel with its consonant instead of splitting it off', () => {
		// "ใจดี" is 3 graphemes (ใ · จ · ดี) — same as the backend: "ใ****", not "ใจ****ี".
		expect(maskLastName('ใจดี')).toBe('ใ****');
	});

	it('shows the first two and last two graphemes for long surnames', () => {
		// ศ · รี · สุ · ข · ใ · จ → 6 graphemes
		expect(maskLastName('ศรีสุขใจ')).toBe('ศรี****ใจ');
		expect(maskLastName('Johnson')).toBe('Jo****on');
	});

	it('never leaves a tone mark or upper vowel alone at either end', () => {
		// พ · ร้ · อ · ม · ใ · จ · ดี → keeps "ร้" and "ดี" whole
		expect(maskLastName('พร้อมใจดี')).toBe('พร้****จดี');
	});

	it('masks short surnames down to the first grapheme', () => {
		expect(maskLastName('Lee')).toBe('L****');
		expect(maskLastName('ดี')).toBe('ดี****');
	});

	it('returns an empty string for a blank surname', () => {
		expect(maskLastName(undefined)).toBe('');
		expect(maskLastName(null)).toBe('');
		expect(maskLastName('   ')).toBe('');
	});
});

describe('maskedMemberName', () => {
	it('joins the first name with the masked surname', () => {
		expect(maskedMemberName('สมชาย', 'ใจดี')).toBe('สมชาย ใ****');
	});

	it('shows the first name alone when there is no surname', () => {
		expect(maskedMemberName('สมชาย', null)).toBe('สมชาย');
	});
});
