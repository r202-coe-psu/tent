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
		expect(th.needsCount).toContain('{pct}');
		expect(en.needsCount).toContain('{count}');
		expect(en.needsCount).toContain('{pct}');

		expect(th.needShortage).toContain('{qty}');
		expect(th.needShortage).toContain('{unit}');
		expect(th.needShortage).toContain('{pending}');
		expect(en.needShortage).toContain('{qty}');
		expect(en.needShortage).toContain('{unit}');
		expect(en.needShortage).toContain('{pending}');
	});
});
