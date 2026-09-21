import { describe, it, expect } from 'vitest';
import { PUBLIC_DONATIONS_I18N } from './public-donations';
import { getTranslation } from '$lib/utils/i18n';

describe('PUBLIC_DONATIONS_I18N dictionary', () => {
	it('has complete parity between Thai and English keys', () => {
		const thKeys = Object.keys(PUBLIC_DONATIONS_I18N.th).sort();
		const enKeys = Object.keys(PUBLIC_DONATIONS_I18N.en).sort();

		expect(thKeys).toEqual(enKeys);
	});

	it('returns proper Thai translations when locale is "th"', () => {
		const t = getTranslation(PUBLIC_DONATIONS_I18N, 'th');
		expect(t.pageTitle).toContain('บริจาค');
		expect(t.step1).toBe('ความต้องการ');
		expect(t.step2).toBe('รายการบริจาค');
		expect(t.step3).toBe('นัดหมาย');
		expect(t.step4).toBe('ตั๋วบริจาค');
	});

	it('returns proper English translations when locale is "en"', () => {
		const t = getTranslation(PUBLIC_DONATIONS_I18N, 'en');
		expect(t.pageTitle).toContain('Donate & Queue');
		expect(t.step1).toBe('Needs');
		expect(t.step2).toBe('Donation Items');
		expect(t.step3).toBe('Schedule');
		expect(t.step4).toBe('Donation Ticket');
	});

	it('contains valid placeholders in templates', () => {
		const th = PUBLIC_DONATIONS_I18N.th;
		const en = PUBLIC_DONATIONS_I18N.en;

		expect(th.needsCount).toContain('{count}');
		expect(en.needsCount).toContain('{count}');

		expect(th.needShortage).toContain('{qty}');
		expect(th.needShortage).toContain('{unit}');
		expect(en.needShortage).toContain('{qty}');
		expect(en.needShortage).toContain('{unit}');
	});

	/**
	 * The board's progress figures come from the projection (`qty_target`, `on_hand`,
	 * `reserved`), and each has its own labelled line. They were once invented in the
	 * component (`target = qty × 2`, `reserved = 0`), so every card read the same 50%
	 * and "จองไว้ 0".
	 *
	 * The shortage sentence stays a shortage sentence: it must not fold a reserved or
	 * received figure back into itself, which is the shape that hid the fake numbers
	 * inside ordinary-looking copy.
	 */
	it('keeps the shortage line to the shortage', () => {
		for (const locale of [PUBLIC_DONATIONS_I18N.th, PUBLIC_DONATIONS_I18N.en]) {
			expect(locale.needShortage).not.toContain('{pending}');
			expect(locale.needShortage).not.toContain('{received}');
			expect(locale.needShortage).not.toContain('{target}');
		}
	});

	it('offers a progress variant of the shelter line, used only when a target exists', () => {
		for (const locale of [PUBLIC_DONATIONS_I18N.th, PUBLIC_DONATIONS_I18N.en]) {
			// Plain variant for a board with no published target — no percentage to show.
			expect(locale.needsCount).toContain('{count}');
			expect(locale.needsCount).not.toContain('{pct}');
			// …and the variant that does carry one.
			expect(locale.needsCountWithProgress).toContain('{count}');
			expect(locale.needsCountWithProgress).toContain('{pct}');
		}
	});
});
