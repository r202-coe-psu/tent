import { describe, expect, it } from 'vitest';
import { compareLanguages } from '$lib/testing/i18n-parity';
import { STATION1_REGISTRATION_I18N } from './station1-registration.i18n';

describe('STATION1_REGISTRATION_I18N', () => {
	it('EN mirrors TH keys and holds no Thai characters', () => {
		const { thKeys, enKeys, thaiInEn } = compareLanguages(STATION1_REGISTRATION_I18N);
		expect(enKeys).toEqual(thKeys);
		expect(thaiInEn).toEqual([]);
	});
});
