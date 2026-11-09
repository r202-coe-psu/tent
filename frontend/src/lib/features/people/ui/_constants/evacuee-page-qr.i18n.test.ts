import { describe, expect, it } from 'vitest';
import { compareLanguages } from '$lib/testing/i18n-parity';
import { EVACUEE_PAGE_I18N } from './evacuee-page.i18n';
import { EVACUEE_QR_MODAL_I18N } from './evacuee-qr-modal.i18n';

describe.each([
	['EVACUEE_PAGE_I18N', EVACUEE_PAGE_I18N],
	['EVACUEE_QR_MODAL_I18N', EVACUEE_QR_MODAL_I18N]
])('%s', (_name, dict) => {
	it('EN mirrors TH keys and holds no Thai characters', () => {
		const { thKeys, enKeys, thaiInEn } = compareLanguages(dict);
		expect(enKeys).toEqual(thKeys);
		expect(thaiInEn).toEqual([]);
	});
});
