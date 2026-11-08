import { describe, expect, it } from 'vitest';
import { compareLanguages } from '$lib/testing/i18n-parity';
import { PUBLIC_BOOKING_TICKET_I18N } from './public-booking-ticket';

describe('PUBLIC_BOOKING_TICKET_I18N', () => {
	it('EN mirrors TH keys and holds no Thai characters', () => {
		const { thKeys, enKeys, thaiInEn } = compareLanguages(PUBLIC_BOOKING_TICKET_I18N);
		expect(enKeys).toEqual(thKeys);
		expect(thaiInEn).toEqual([]);
	});
});
