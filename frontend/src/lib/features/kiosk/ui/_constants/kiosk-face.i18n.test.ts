import { describe, expect, it } from 'vitest';
import { compareLanguages } from '$lib/testing/i18n-parity';
import { KIOSK_FACE_I18N } from './kiosk-face.i18n';

describe('KIOSK_FACE_I18N', () => {
	it('has the same keys in both languages and no Thai in English', () => {
		const { thKeys, enKeys, thaiInEn } = compareLanguages(KIOSK_FACE_I18N);

		expect(enKeys).toEqual(thKeys);
		expect(thaiInEn).toEqual([]);
	});
});
