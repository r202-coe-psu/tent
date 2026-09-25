import { describe, expect, it } from 'vitest';
import {
	IDENTITY_METHODS,
	KIOSK_CARD_PATH,
	KIOSK_PHONE_PATH,
	KIOSK_QR_PATH,
	visibleIdentityMethods
} from './identity-method';

describe('kiosk identity methods', () => {
	it('keeps the approved display order and enabled states', () => {
		expect(IDENTITY_METHODS.map((method) => method.id)).toEqual([
			'qr',
			'smart-card',
			'phone',
			'thaid'
		]);
		expect(IDENTITY_METHODS.map((method) => method.enabled)).toEqual([true, true, true, false]);
	});

	it('routes only the enabled methods', () => {
		expect(IDENTITY_METHODS[0]).toMatchObject({ href: KIOSK_QR_PATH });
		expect(IDENTITY_METHODS[1]).toMatchObject({ href: KIOSK_CARD_PATH });
		expect(IDENTITY_METHODS[2]).toMatchObject({ href: KIOSK_PHONE_PATH });
		expect(IDENTITY_METHODS[3].href).toBeUndefined();
	});

	it('filters the phone method from the home screen when disabled', () => {
		expect(
			visibleIdentityMethods({ phoneCheckInEnabled: true }).map((method) => method.id)
		).toEqual(['qr', 'smart-card', 'phone', 'thaid']);
		expect(
			visibleIdentityMethods({ phoneCheckInEnabled: false }).map((method) => method.id)
		).toEqual(['qr', 'smart-card', 'thaid']);
	});
});
