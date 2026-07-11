import { describe, it, expect } from 'vitest';
import { referralSchema, isReferral, type Referral, type ReferralStatus } from './referral.schema';
import { canTransition, applyTransition, allowedTransitions } from './referral.transitions';
import { redactForScope, type ReferralScope } from './referral.redaction';

// Helper to create a valid base Referral document for tests
function mockReferral(overrides?: Partial<Referral>): Referral {
	return {
		_id: 'referral:01F8MECHEXAMPLEDOCID12345',
		type: 'referral',
		schema_v: 1,
		shelter_code: 'SH001',
		created_at: '2026-07-11T05:00:00.000Z',
		updated_at: '2026-07-11T05:00:00.000Z',
		created_by: 'Staff A',
		evacuee_id: 'evacuee:01F8MECHEVACUEEID1234567',
		to_org: {
			name: 'General Hospital',
			kind: 'hospital',
			contact: '0812345678'
		},
		reason: 'Requires urgent medical care',
		urgency: 'urgent',
		status: 'draft',
		timeline: {},
		...overrides
	};
}

describe('Referral Domain', () => {
	describe('Schema Validation & Type Guard', () => {
		it('should validate a correct referral document', () => {
			const doc = mockReferral();
			expect(isReferral(doc)).toBe(true);
			expect(() => referralSchema.parse(doc)).not.toThrow();
		});

		it('should reject when id format is wrong', () => {
			const doc = mockReferral({ _id: 'invalid-id' });
			expect(isReferral(doc)).toBe(false);
		});

		it('should reject when evacuee_id does not have evacuee: prefix', () => {
			const doc = mockReferral({ evacuee_id: 'evac:123' });
			expect(isReferral(doc)).toBe(false);
		});

		it('should reject when to_org name is empty', () => {
			const doc = mockReferral({
				to_org: {
					name: '',
					kind: 'hospital'
				}
			});
			expect(isReferral(doc)).toBe(false);
		});
	});

	describe('State Machine transitions (25-cell Matrix Coverage)', () => {
		const statuses: ReferralStatus[] = ['draft', 'sent', 'accepted', 'rejected', 'closed'];

		// Test canTransition for all 25 combinations
		describe('canTransition combinations', () => {
			const expectedTransitions: Record<ReferralStatus, ReferralStatus[]> = {
				draft: ['sent'],
				sent: ['accepted', 'rejected'],
				accepted: ['closed'],
				rejected: ['closed'],
				closed: []
			};

			statuses.forEach((from) => {
				statuses.forEach((to) => {
					const shouldAllow = expectedTransitions[from].includes(to);
					it(`${from} → ${to} should be ${shouldAllow}`, () => {
						expect(canTransition(from, to)).toBe(shouldAllow);
					});
				});
			});
		});

		// Test applyTransition for valid paths
		describe('applyTransition behavior', () => {
			it('should apply draft → sent', () => {
				const doc = mockReferral({ status: 'draft' });
				const nowIso = '2026-07-11T05:10:00.000Z';
				const updated = applyTransition(doc, 'sent', 'Manager A', nowIso);

				expect(updated.status).toBe('sent');
				expect(updated.updated_at).toBe(nowIso);
				expect(updated.timeline.sent).toEqual({ at: nowIso, by: 'Manager A' });
				expect(updated.timeline.responded).toBeUndefined();
			});

			it('should apply sent → accepted', () => {
				const doc = mockReferral({
					status: 'sent',
					timeline: {
						sent: { at: '2026-07-11T05:10:00.000Z', by: 'Manager A' }
					}
				});
				const nowIso = '2026-07-11T05:20:00.000Z';
				const updated = applyTransition(doc, 'accepted', 'Hospital Staff B', nowIso);

				expect(updated.status).toBe('accepted');
				expect(updated.timeline.responded).toEqual({ at: nowIso, by: 'Hospital Staff B' });
			});

			it('should apply sent → rejected', () => {
				const doc = mockReferral({
					status: 'sent',
					timeline: {
						sent: { at: '2026-07-11T05:10:00.000Z', by: 'Manager A' }
					}
				});
				const nowIso = '2026-07-11T05:20:00.000Z';
				const updated = applyTransition(doc, 'rejected', 'Hospital Staff B', nowIso);

				expect(updated.status).toBe('rejected');
				expect(updated.timeline.responded).toEqual({ at: nowIso, by: 'Hospital Staff B' });
			});

			it('should apply accepted → closed', () => {
				const doc = mockReferral({
					status: 'accepted',
					timeline: {
						sent: { at: '2026-07-11T05:10:00.000Z', by: 'Manager A' },
						responded: { at: '2026-07-11T05:20:00.000Z', by: 'Hospital Staff B' }
					}
				});
				const nowIso = '2026-07-11T05:30:00.000Z';
				const updated = applyTransition(doc, 'closed', 'Manager A', nowIso);

				expect(updated.status).toBe('closed');
				expect(updated.timeline.closed).toEqual({ at: nowIso, by: 'Manager A' });
			});

			it('should throw on invalid transition', () => {
				const doc = mockReferral({ status: 'draft' });
				expect(() =>
					applyTransition(doc, 'accepted', 'Manager A', '2026-07-11T05:10:00.000Z')
				).toThrow();
			});
		});

		describe('allowedTransitions list helper', () => {
			it('should return correct options list', () => {
				expect(allowedTransitions('draft')).toEqual(['sent']);
				expect(allowedTransitions('sent')).toEqual(['accepted', 'rejected']);
				expect(allowedTransitions('closed')).toEqual([]);
			});
		});
	});

	describe('Redaction & Data Privacy (FR-48/NFR-5)', () => {
		it('should return exact doc unchanged for internal scope', () => {
			const doc = mockReferral({
				to_org: { name: 'Super Hospital', kind: 'hospital', contact: '099999' },
				notes: 'Medical condition info'
			});
			const result = redactForScope(doc, 'internal');
			expect(result).toEqual(doc);
		});

		describe('external scopes (public, fam, eoc)', () => {
			const externalScopes: ReferralScope[] = ['public', 'fam', 'eoc'];

			externalScopes.forEach((scope) => {
				it(`hospital referral: redacts target details and medical info for ${scope}`, () => {
					const doc = mockReferral({
						to_org: { name: 'Emergency Clinic', kind: 'hospital', contact: '911' },
						reason: 'Sprained ankle with swelling',
						notes: 'Allergic to penicillin'
					});

					const redacted = redactForScope(doc, scope) as any;

					expect(redacted.to_org.kind).toBe('hospital');
					// Redacted fields
					expect(redacted.to_org.name).toBeUndefined();
					expect(redacted.to_org.contact).toBeUndefined();
					expect(redacted.reason).toBeUndefined();
					expect(redacted.notes).toBeUndefined();
					expect(redacted.evacuee_id).toBeUndefined();
					expect(redacted.national_id).toBeUndefined();
				});

				it(`non-hospital referral: keeps org details/reason but strips PII for ${scope}`, () => {
					const doc = mockReferral({
						to_org: { name: 'Red Cross Shelter', kind: 'social_services', contact: '123' },
						reason: 'Need emergency family pack',
						notes: 'Has 3 children'
					});

					const redacted = redactForScope(doc, scope) as any;

					expect(redacted.to_org.kind).toBe('social_services');
					// Kept fields
					expect(redacted.to_org.name).toBe('Red Cross Shelter');
					expect(redacted.to_org.contact).toBe('123');
					expect(redacted.reason).toBe('Need emergency family pack');
					expect(redacted.notes).toBe('Has 3 children');
					// Redacted PII
					expect(redacted.evacuee_id).toBeUndefined();
					expect(redacted.national_id).toBeUndefined();
				});
			});
		});
	});
});
