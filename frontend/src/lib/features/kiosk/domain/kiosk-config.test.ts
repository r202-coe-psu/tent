import { describe, expect, it } from 'vitest';
import {
	isKioskPhoneCheckInEnabled,
	isKioskThaidCheckInEnabled,
	isKioskWalkInRegistrationEnabled
} from './kiosk-config';

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

describe('isKioskWalkInRegistrationEnabled', () => {
	it('is enabled only when the shelter flag is exactly true', () => {
		expect(
			isKioskWalkInRegistrationEnabled({
				feature_flags: { kiosk_walk_in_registration_enabled: true }
			})
		).toBe(true);
		expect(
			isKioskWalkInRegistrationEnabled({
				feature_flags: { kiosk_walk_in_registration_enabled: false }
			})
		).toBe(false);
		expect(isKioskWalkInRegistrationEnabled({ feature_flags: {} })).toBe(false);
		expect(isKioskWalkInRegistrationEnabled(null)).toBe(false);
	});
});

describe('isKioskThaidCheckInEnabled', () => {
	it('is enabled only when the shelter flag is exactly true (fail closed)', () => {
		expect(
			isKioskThaidCheckInEnabled({ feature_flags: { kiosk_thaid_check_in_enabled: true } })
		).toBe(true);
		expect(
			isKioskThaidCheckInEnabled({ feature_flags: { kiosk_thaid_check_in_enabled: false } })
		).toBe(false);
		expect(
			isKioskThaidCheckInEnabled({ feature_flags: { kiosk_thaid_check_in_enabled: 'true' } })
		).toBe(false);
		expect(isKioskThaidCheckInEnabled({ feature_flags: {} })).toBe(false);
		expect(isKioskThaidCheckInEnabled(null)).toBe(false);
	});
});
