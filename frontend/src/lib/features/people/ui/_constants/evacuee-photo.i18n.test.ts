import { describe, expect, it } from 'vitest';
import { compareLanguages } from './i18n-parity';
import { EVACUEE_PHOTO_I18N } from './evacuee-photo.i18n';

describe('EVACUEE_PHOTO_I18N', () => {
	it('EN mirrors TH keys and holds no Thai characters', () => {
		const { thKeys, enKeys, thaiInEn } = compareLanguages(EVACUEE_PHOTO_I18N);
		expect(enKeys).toEqual(thKeys);
		expect(thaiInEn).toEqual([]);
	});
});
