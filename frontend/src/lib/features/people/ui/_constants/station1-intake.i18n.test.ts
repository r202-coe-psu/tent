import { describe, expect, it } from 'vitest';
import { compareLanguages } from './i18n-parity';
import { STATION1_INTAKE_I18N } from './station1-intake.i18n';

describe('STATION1_INTAKE_I18N', () => {
	it('EN mirrors TH keys and holds no Thai characters', () => {
		const { thKeys, enKeys, thaiInEn } = compareLanguages(STATION1_INTAKE_I18N);
		expect(enKeys).toEqual(thKeys);
		expect(thaiInEn).toEqual([]);
	});
});
