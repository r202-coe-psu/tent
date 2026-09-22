import { describe, expect, it } from 'vitest';
import { IDENTITY_METHODS, KIOSK_CARD_PATH, KIOSK_QR_PATH } from './identity-method';

describe('kiosk identity methods', () => {
	it('keeps the approved display order and enabled states', () => {
		expect(IDENTITY_METHODS.map((method) => method.id)).toEqual([
			'qr',
			'smart-card',
			'phone',
			'thaid'
		]);
		expect(IDENTITY_METHODS.map((method) => method.enabled)).toEqual([true, true, false, false]);
	});

	it('routes only the enabled methods', () => {
		expect(IDENTITY_METHODS[0]).toMatchObject({ href: KIOSK_QR_PATH });
		expect(IDENTITY_METHODS[1]).toMatchObject({ href: KIOSK_CARD_PATH });
		expect(IDENTITY_METHODS[2].href).toBeUndefined();
		expect(IDENTITY_METHODS[3].href).toBeUndefined();
	});
});
