import { describe, expect, it } from 'vitest';
import {
	IDENTITY_METHODS,
	KIOSK_CARD_PATH,
	KIOSK_PHONE_PATH,
	KIOSK_QR_PATH,
	KIOSK_THAID_PATH,
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
		expect(IDENTITY_METHODS.map((method) => method.enabled)).toEqual([true, true, true, true]);
	});

	it('routes only the enabled methods', () => {
		expect(IDENTITY_METHODS[0]).toMatchObject({ href: KIOSK_QR_PATH });
		expect(IDENTITY_METHODS[1]).toMatchObject({ href: KIOSK_CARD_PATH });
		expect(IDENTITY_METHODS[2]).toMatchObject({ href: KIOSK_PHONE_PATH });
		expect(KIOSK_THAID_PATH).toBe('/kiosk/thaid');
		expect(IDENTITY_METHODS[3]).toMatchObject({
			href: '/kiosk/thaid',
			description: 'สแกน QR ด้วยมือถือแล้วยืนยันในแอป ThaiD',
			buttonLabel: 'ใช้ ThaiD'
		});
	});

	it('filters the phone and ThaiD methods from the home screen when disabled', () => {
		const ids = (phoneCheckInEnabled: boolean, thaidCheckInEnabled: boolean) =>
			visibleIdentityMethods({ phoneCheckInEnabled, thaidCheckInEnabled }).map(
				(method) => method.id
			);

		expect(ids(true, true)).toEqual(['qr', 'smart-card', 'phone', 'thaid']);
		expect(ids(false, true)).toEqual(['qr', 'smart-card', 'thaid']);
		expect(ids(true, false)).toEqual(['qr', 'smart-card', 'phone']);
		expect(ids(false, false)).toEqual(['qr', 'smart-card']);
	});
});
