import { describe, it, expect } from 'vitest';
import { resolvePostLoginDestination, LANDING_ROUTE } from './auth';

describe('resolvePostLoginDestination (CR-124)', () => {
	it('sends force-setup before MFA when password/security setup is required', () => {
		expect(
			resolvePostLoginDestination({
				must_change_password: true,
				has_security_question: false,
				pending_mfa: true
			})
		).toBe('/force-setup');

		expect(
			resolvePostLoginDestination({
				must_change_password: false,
				has_security_question: false,
				pending_mfa: true
			})
		).toBe('/force-setup');
	});

	it('sends MFA challenge when enrolled and pending after force-setup is clear', () => {
		expect(
			resolvePostLoginDestination({
				must_change_password: false,
				has_security_question: true,
				pending_mfa: true
			})
		).toBe('/mfa-challenge');
	});

	it('lands on portal when not pending MFA', () => {
		expect(
			resolvePostLoginDestination({
				must_change_password: false,
				has_security_question: true,
				pending_mfa: false
			})
		).toBe(LANDING_ROUTE);
	});
});
