import { describe, expect, it } from 'vitest';
import { compareLanguages } from '$lib/features/people/ui/_constants/i18n-parity';
import { KIOSK_WALK_IN_I18N } from './kiosk-walk-in.i18n';

describe('KIOSK_WALK_IN_I18N', () => {
	it('has the same keys in both languages and no Thai in English', () => {
		const { thKeys, enKeys, thaiInEn } = compareLanguages(KIOSK_WALK_IN_I18N);

		expect(enKeys).toEqual(thKeys);
		expect(thaiInEn).toEqual([]);
	});
});
