import { describe, expect, it } from 'vitest';
import { COUCH_ADMIN } from '$lib/auth/roles';
import { CURRENT_CONSENT_VERSION, requiresConsent, type UserConsentStatus } from './consent';

describe('requiresConsent policy', () => {
	it('requires consent for volunteer without consent record', () => {
		const result = requiresConsent({
			roles: ['volunteer'],
			personnel_type: 'volunteer',
			consent: null
		});
		expect(result).toBe(true);
	});

	it('requires consent for staff without consent record', () => {
		const result = requiresConsent({
			roles: ['shelter:SH001', 'SH001:registration_staff'],
			personnel_type: 'staff',
			consent: null
		});
		expect(result).toBe(true);
	});

	it('does not require consent when user has agreed to current version', () => {
		const consent: UserConsentStatus = {
			agreed: true,
			agreed_at: '2026-11-08T00:00:00.000Z',
			version: CURRENT_CONSENT_VERSION
		};
		const result = requiresConsent({
			roles: ['volunteer'],
			personnel_type: 'volunteer',
			consent
		});
		expect(result).toBe(false);
	});

	it('requires consent again when user agreed to an outdated version', () => {
		const consent: UserConsentStatus = {
			agreed: true,
			agreed_at: '2026-01-01T00:00:00.000Z',
			version: '0.9'
		};
		const result = requiresConsent({
			roles: ['volunteer'],
			personnel_type: 'volunteer',
			consent
		});
		expect(result).toBe(true);
	});

	it('requires consent when agreed is false', () => {
		const consent: UserConsentStatus = {
			agreed: false,
			version: CURRENT_CONSENT_VERSION
		};
		const result = requiresConsent({
			roles: ['staff'],
			personnel_type: 'staff',
			consent
		});
		expect(result).toBe(true);
	});

	it('requires consent for system_admin without consent record', () => {
		const result = requiresConsent({
			roles: ['system_admin'],
			consent: null
		});
		expect(result).toBe(true);
	});

	it('exempts couch_admin from consent requirement', () => {
		const result = requiresConsent({
			roles: [COUCH_ADMIN],
			personnel_type: 'staff',
			consent: null
		});
		expect(result).toBe(false);
	});
});
