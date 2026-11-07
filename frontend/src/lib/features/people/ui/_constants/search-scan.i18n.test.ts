import { describe, expect, it } from 'vitest';
import { compareLanguages } from './i18n-parity';
import { SEARCH_SCAN_I18N } from './search-scan.i18n';

describe('SEARCH_SCAN_I18N', () => {
	it('EN mirrors TH keys and holds no Thai characters', () => {
		const { thKeys, enKeys, thaiInEn } = compareLanguages(SEARCH_SCAN_I18N);
		expect(enKeys).toEqual(thKeys);
		expect(thaiInEn).toEqual([]);
	});
});
