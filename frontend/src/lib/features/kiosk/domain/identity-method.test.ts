import { describe, expect, it } from 'vitest';
import {
	IDENTITY_METHODS,
	KIOSK_CARD_PATH,
	KIOSK_QR_PATH,
	KIOSK_REPRINT_ENTRY,
	KIOSK_PRINT_QR_PATH,
	KIOSK_REPRINT_PATH,
	KIOSK_THAID_PATH,
	KIOSK_VOLUNTEER_CARD_PATH,
	visibleIdentityMethods
} from './identity-method';

describe('kiosk identity methods', () => {
	it('keeps the approved display order and enabled states (no phone card)', () => {
		expect(IDENTITY_METHODS.map((method) => method.id)).toEqual(['qr', 'smart-card', 'thaid']);
		expect(IDENTITY_METHODS.map((method) => method.enabled)).toEqual([true, true, true]);
	});

	it('routes only the enabled methods', () => {
		expect(IDENTITY_METHODS[0]).toMatchObject({ href: KIOSK_QR_PATH });
		expect(IDENTITY_METHODS[1]).toMatchObject({ href: KIOSK_CARD_PATH });
		expect(KIOSK_THAID_PATH).toBe('/kiosk/thaid');
		expect(IDENTITY_METHODS[2]).toMatchObject({
			href: '/kiosk/thaid',
			description: 'สแกน QR ด้วยมือถือแล้วยืนยันในแอป ThaiD',
			buttonLabel: 'ใช้ ThaiD'
		});
	});

	it('describes the QR print entry (it opens the chooser) that sits under the method grid', () => {
		expect(KIOSK_REPRINT_PATH).toBe('/kiosk/reprint');
		expect(KIOSK_VOLUNTEER_CARD_PATH).toBe('/kiosk/volunteer');
		expect(KIOSK_PRINT_QR_PATH).toBe('/kiosk/print-qr');
		expect(KIOSK_REPRINT_ENTRY).toEqual({
			title: 'พิมพ์ QR',
			description: 'กรอกเบอร์โทรที่ลงทะเบียนไว้ เพื่อพิมพ์ QR Code',
			href: '/kiosk/print-qr'
		});
	});

	it('filters the ThaiD method from the home screen when disabled', () => {
		const ids = (thaidCheckInEnabled: boolean) =>
			visibleIdentityMethods({ qrCheckInEnabled: true, thaidCheckInEnabled }).map(
				(method) => method.id
			);

		expect(ids(true)).toEqual(['qr', 'smart-card', 'thaid']);
		expect(ids(false)).toEqual(['qr', 'smart-card']);
	});

	it('filters the QR method when this machine turns QR check-in off', () => {
		const ids = (thaidCheckInEnabled: boolean) =>
			visibleIdentityMethods({ qrCheckInEnabled: false, thaidCheckInEnabled }).map(
				(method) => method.id
			);

		expect(ids(true)).toEqual(['smart-card', 'thaid']);
		expect(ids(false)).toEqual(['smart-card']);
	});
});
