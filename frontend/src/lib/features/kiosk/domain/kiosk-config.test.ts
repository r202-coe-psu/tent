import { describe, expect, it } from 'vitest';
import { isKioskPhoneCheckInEnabled } from './kiosk-config';

describe('isKioskPhoneCheckInEnabled', () => {
	it('is enabled only when the shelter flag is exactly true', () => {
		expect(
			isKioskPhoneCheckInEnabled({ feature_flags: { kiosk_phone_check_in_enabled: true } })
		).toBe(true);
		expect(
			isKioskPhoneCheckInEnabled({ feature_flags: { kiosk_phone_check_in_enabled: false } })
		).toBe(false);
		expect(isKioskPhoneCheckInEnabled({ feature_flags: {} })).toBe(false);
		expect(isKioskPhoneCheckInEnabled(null)).toBe(false);
	});
});
