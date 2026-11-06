import { describe, expect, it } from 'vitest';
import { compareLanguages } from './i18n-parity';
import { STAFF_FORM_FIELDS_I18N } from './staff-form-fields.i18n';

describe('STAFF_FORM_FIELDS_I18N', () => {
	it('EN mirrors TH keys and holds no Thai characters', () => {
		const { thKeys, enKeys, thaiInEn } = compareLanguages(STAFF_FORM_FIELDS_I18N);
		expect(enKeys).toEqual(thKeys);
		expect(thaiInEn).toEqual([]);
	});
});
