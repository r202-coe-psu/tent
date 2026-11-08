import { describe, expect, it } from 'vitest';
import { compareLanguages } from '$lib/testing/i18n-parity';
import { accessPortalI18n } from './access-portal.i18n';

describe('accessPortalI18n', () => {
	it('EN mirrors TH keys and holds no Thai characters', () => {
		const { thKeys, enKeys, thaiInEn } = compareLanguages(accessPortalI18n);
		expect(enKeys).toEqual(thKeys);
		expect(thaiInEn).toEqual([]);
	});
});
