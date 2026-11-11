import { describe, expect, it } from 'vitest';
import {
	hasPendingControlledSkill,
	identityVerificationStatus,
	isDirectlyVerified,
	skillVerificationStatus
} from './verification';

describe('volunteer verification helpers', () => {
	it('keeps identity_verified as the legacy fallback', () => {
		expect(identityVerificationStatus({ identity_verified: true })).toBe('verified');
		expect(identityVerificationStatus({ identity_verified: false })).toBe('pending');
	});

	it('prefers the explicit identity review record', () => {
		expect(
			identityVerificationStatus({
				identity_verified: true,
				identity_verification: { status: 'rejected', notes: 'เอกสารไม่ครบ' }
			})
		).toBe('rejected');
	});

	it('flags controlled skills until each one is verified', () => {
		const owner = {
			skill_verifications: {
				medical: { status: 'verified' as const }
			}
		};
		expect(skillVerificationStatus(owner, 'medical')).toBe('verified');
		expect(hasPendingControlledSkill(owner, ['medical'], ['medical'])).toBe(false);
		expect(hasPendingControlledSkill(owner, ['nursing'], ['nursing'])).toBe(true);
	});

	it('does not keep rejected controlled skills in the pending queue', () => {
		const owner = {
			skill_verifications: {
				medical: { status: 'rejected' as const }
			}
		};
		expect(hasPendingControlledSkill(owner, ['medical'], ['medical'])).toBe(false);
	});
});

describe('isDirectlyVerified (CR-228 FR-15)', () => {
	it('counts only a verified result checked at its own shelter', () => {
		expect(isDirectlyVerified({ status: 'verified' })).toBe(true);
		expect(
			isDirectlyVerified({
				status: 'verified',
				accepted_from: { shelter_code: 'SH001', verified_at: null }
			})
		).toBe(false);
		expect(isDirectlyVerified({ status: 'pending' })).toBe(false);
		expect(isDirectlyVerified({ status: 'rejected' })).toBe(false);
		expect(isDirectlyVerified(null)).toBe(false);
		expect(isDirectlyVerified(undefined)).toBe(false);
	});
});
