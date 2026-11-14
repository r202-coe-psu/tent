import { describe, expect, it } from 'vitest';
import { compareLanguages } from '$lib/testing/i18n-parity';
import { KIOSK_SELF_CHECKOUT_I18N } from './kiosk-self-checkout.i18n';

describe('KIOSK_SELF_CHECKOUT_I18N', () => {
	it('has the same keys in both languages and no Thai in English', () => {
		const { thKeys, enKeys, thaiInEn } = compareLanguages(KIOSK_SELF_CHECKOUT_I18N);

		expect(thKeys.length).toBeGreaterThan(0);
		expect(enKeys).toEqual(thKeys);
		expect(thaiInEn).toEqual([]);
	});
});
