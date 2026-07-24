import { describe, it, expect } from 'vitest';
import type { Referral } from './referral.schema';
import {
	assertActorMayTransition,
	canActorRespond,
	isIncomingCapacityReferral,
	isOutgoingCapacityReferral,
	ReferralAuthorizationError
} from './referral.authorization';

function capacitySent(overrides?: Partial<Referral>): Referral {
	return {
		_id: 'referral:01CAPACITY',
		type: 'referral',
		schema_v: 1,
		shelter_code: 'SH001',
		created_at: '2026-07-11T05:00:00.000Z',
		updated_at: '2026-07-11T05:00:00.000Z',
		created_by: 'Staff A',
		evacuee_id: 'evacuee:01F8MECHEVACUEEID1234567',
		referral_type: 'capacity',
		to_shelter_code: 'SH002',
		reason: 'Full',
		urgency: 'normal',
		status: 'sent',
		timeline: { sent: { at: '2026-07-11T05:00:00.000Z', by: 'Staff A' } },
		...overrides
	} as Referral;
}

describe('referral.authorization', () => {
	it('classifies outgoing vs incoming capacity', () => {
		const doc = capacitySent();
		expect(isOutgoingCapacityReferral(doc, 'SH001')).toBe(true);
		expect(isIncomingCapacityReferral(doc, 'SH001')).toBe(false);
		expect(isOutgoingCapacityReferral(doc, 'SH002')).toBe(false);
		expect(isIncomingCapacityReferral(doc, 'SH002')).toBe(true);
	});

	it('allows only destination to accept/reject capacity', () => {
		const doc = capacitySent();
		expect(() => assertActorMayTransition(doc, 'accepted', 'SH002')).not.toThrow();
		expect(() => assertActorMayTransition(doc, 'rejected', 'SH002')).not.toThrow();
		expect(() => assertActorMayTransition(doc, 'accepted', 'SH001')).toThrow(
			ReferralAuthorizationError
		);
		expect(canActorRespond(doc, 'SH002')).toBe(true);
		expect(canActorRespond(doc, 'SH001')).toBe(false);
	});

	it('allows only source to send capacity draft', () => {
		const draft = capacitySent({ status: 'draft', timeline: {} });
		expect(() => assertActorMayTransition(draft, 'sent', 'SH001')).not.toThrow();
		expect(() => assertActorMayTransition(draft, 'sent', 'SH002')).toThrow(
			ReferralAuthorizationError
		);
	});
});
