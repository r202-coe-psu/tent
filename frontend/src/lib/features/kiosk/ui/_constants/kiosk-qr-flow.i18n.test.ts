import { describe, expect, it } from 'vitest';
import { compareLanguages } from '$lib/features/people/ui/_constants/i18n-parity';
import { KIOSK_PRINT_I18N } from './kiosk-print.i18n';
import { KIOSK_QR_FLOW_I18N } from './kiosk-qr-flow.i18n';
import { KIOSK_REPRINT_I18N } from './kiosk-reprint.i18n';

describe.each([
	['KIOSK_QR_FLOW_I18N', KIOSK_QR_FLOW_I18N],
	['KIOSK_PRINT_I18N', KIOSK_PRINT_I18N],
	['KIOSK_REPRINT_I18N', KIOSK_REPRINT_I18N]
])('%s', (_name, dictionary) => {
	it('has the same keys in both languages and no Thai in English', () => {
		const { thKeys, enKeys, thaiInEn } = compareLanguages(dictionary);

		expect(enKeys).toEqual(thKeys);
		expect(thaiInEn).toEqual([]);
	});
});
