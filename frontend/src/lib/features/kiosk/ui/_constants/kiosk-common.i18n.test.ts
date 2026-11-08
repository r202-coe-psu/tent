import { describe, expect, it } from 'vitest';
import { compareLanguages } from '$lib/testing/i18n-parity';
import { KIOSK_COMMON_I18N } from './kiosk-common.i18n';
import { KIOSK_METHOD_I18N } from './kiosk-method.i18n';

describe.each([
	['KIOSK_COMMON_I18N', KIOSK_COMMON_I18N],
	['KIOSK_METHOD_I18N', KIOSK_METHOD_I18N]
])('%s', (_name, dictionary) => {
	it('has the same keys in both languages and no Thai in English', () => {
		const { thKeys, enKeys, thaiInEn } = compareLanguages(dictionary);

		expect(enKeys).toEqual(thKeys);
		expect(thaiInEn).toEqual([]);
	});
});
