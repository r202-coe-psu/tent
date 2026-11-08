import { describe, expect, it } from 'vitest';
import { compareLanguages } from '$lib/testing/i18n-parity';
import { EVACUEE_PROFILE_MODALS_I18N } from './evacuee-profile-modals.i18n';

describe('EVACUEE_PROFILE_MODALS_I18N', () => {
	it('EN mirrors TH keys and holds no Thai characters', () => {
		const { thKeys, enKeys, thaiInEn } = compareLanguages(EVACUEE_PROFILE_MODALS_I18N);
		expect(enKeys).toEqual(thKeys);
		expect(thaiInEn).toEqual([]);
	});
});
