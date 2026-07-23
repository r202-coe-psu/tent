import { describe, it, expect } from 'vitest';
import {
	referralSchema,
	referralInputSchema,
	referralFilterSchema,
	isReferral,
	isCapacityReferral,
	isResourceReferral,
	isMedicalReferral,
	type Referral,
	type ReferralStatus
} from './referral.schema';
import { canTransition, applyTransition, allowedTransitions } from './referral.transitions';
import { redactForScope, type ReferralScope, type RedactedReferral } from './referral.redaction';

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
		referral_type: 'medical-emergency',
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
	} as Referral;
}

describe('Referral Domain', () => {
	describe('Schema Validation & Discriminated Union Type Guards', () => {
		it('should validate a correct medical-emergency referral document', () => {
			const doc = mockReferral();
			expect(isReferral(doc)).toBe(true);
			expect(isMedicalReferral(doc)).toBe(true);
			expect(() => referralSchema.parse(doc)).not.toThrow();
		});

		it('should validate a capacity referral document with to_shelter_code', () => {
			const doc = mockReferral({
				referral_type: 'capacity',
				to_shelter_code: 'SH002',
				to_org: undefined,
				reason: 'Shelter SH001 reached maximum capacity'
			});
			expect(isReferral(doc)).toBe(true);
			expect(isCapacityReferral(doc)).toBe(true);
			expect(doc.referral_type).toBe('capacity');
			expect(doc.to_shelter_code).toBe('SH002');
		});

		it('should validate a resource referral document', () => {
			const doc = mockReferral({
				referral_type: 'resource',
				to_org: { name: 'Social Welfare', kind: 'social_services' },
				reason: 'Requesting 50 emergency blanket kits'
			});
			expect(isReferral(doc)).toBe(true);
			expect(isResourceReferral(doc)).toBe(true);
			expect(doc.referral_type).toBe('resource');
		});

		it('should reject creation input for capacity referral when to_shelter_code is missing', () => {
			const input = {
				referral_type: 'capacity',
				evacuee_id: 'evacuee:01F8MECHEVACUEEID1234567',
				reason: 'Capacity full',
				urgency: 'normal'
			};
			const result = referralInputSchema.safeParse(input);
			expect(result.success).toBe(false);
		});

		it('should reject creation input for medical referral when to_org name is missing', () => {
			const input = {
				referral_type: 'medical-emergency',
				evacuee_id: 'evacuee:01F8MECHEVACUEEID1234567',
				to_org: { kind: 'hospital' },
				reason: 'Emergency care needed',
				urgency: 'urgent'
			};
			const result = referralInputSchema.safeParse(input);
			expect(result.success).toBe(false);
		});

		it('should validate legacy documents via read schema fallback', () => {
			const legacyDoc = {
				_id: 'referral:01F8MECHEXAMPLEDOCID12345',
				type: 'referral',
				schema_v: 1,
				shelter_code: 'SH001',
				created_at: '2026-07-11T05:00:00.000Z',
				updated_at: '2026-07-11T05:00:00.000Z',
				created_by: 'Staff A',
				evacuee_id: 'evacuee:01F8MECHEVACUEEID1234567',
				reason: 'Legacy record without referral_type',
				urgency: 'normal',
				status: 'draft',
				timeline: {}
			};
			expect(isReferral(legacyDoc)).toBe(true);
		});

		it('should reject when id format is wrong', () => {
			const doc = mockReferral({ _id: 'invalid-id' });
			expect(isReferral(doc)).toBe(false);
		});

		it('should reject when evacuee_id does not have evacuee: prefix', () => {
			const doc = mockReferral({ evacuee_id: 'evac:123' });
			expect(isReferral(doc)).toBe(false);
		});
	});

	describe('ReferralFilter Schema Validation & Pagination Defaults', () => {
		it('should apply default limit: 50, skip: 0, and sort: created_at_desc when empty filter is passed', () => {
			const parsed = referralFilterSchema.parse({});
			expect(parsed.limit).toBe(50);
			expect(parsed.skip).toBe(0);
			expect(parsed.sort).toBe('created_at_desc');
		});

		it('should accept valid custom limit, skip, and sort values', () => {
			const parsed = referralFilterSchema.parse({
				status: 'sent',
				limit: 100,
				skip: 20,
				sort: 'created_at_asc'
			});
			expect(parsed.status).toBe('sent');
			expect(parsed.limit).toBe(100);
			expect(parsed.skip).toBe(20);
			expect(parsed.sort).toBe('created_at_asc');
		});

		it('should reject negative limit or skip values', () => {
			expect(referralFilterSchema.safeParse({ limit: -5 }).success).toBe(false);
			expect(referralFilterSchema.safeParse({ skip: -1 }).success).toBe(false);
			expect(referralFilterSchema.safeParse({ limit: 5000 }).success).toBe(false);
		});
	});

	describe('State Machine transitions (25-cell Matrix Coverage & Response Reason)', () => {
		const statuses: ReferralStatus[] = ['draft', 'sent', 'accepted', 'rejected', 'closed'];

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

		describe('applyTransition behavior with response_reason', () => {
			it('should apply draft → sent', () => {
				const doc = mockReferral({ status: 'draft' });
				const nowIso = '2026-07-11T05:10:00.000Z';
				const updated = applyTransition(doc, 'sent', 'Manager A', nowIso);

				expect(updated.status).toBe('sent');
				expect(updated.updated_at).toBe(nowIso);
				expect(updated.timeline.sent).toEqual({ at: nowIso, by: 'Manager A' });
				expect(updated.timeline.responded).toBeUndefined();
			});

			it('should apply sent → accepted with response_reason', () => {
				const doc = mockReferral({
					status: 'sent',
					timeline: {
						sent: { at: '2026-07-11T05:10:00.000Z', by: 'Manager A' }
					}
				});
				const nowIso = '2026-07-11T05:20:00.000Z';
				const reason = 'Bed space confirmed in Zone B';
				const updated = applyTransition(doc, 'accepted', 'Hospital Staff B', nowIso, reason);

				expect(updated.status).toBe('accepted');
				expect(updated.response_reason).toBe(reason);
				expect(updated.timeline.responded).toEqual({ at: nowIso, by: 'Hospital Staff B' });
			});

			it('should apply sent → rejected with response_reason', () => {
				const doc = mockReferral({
					status: 'sent',
					timeline: {
						sent: { at: '2026-07-11T05:10:00.000Z', by: 'Manager A' }
					}
				});
				const nowIso = '2026-07-11T05:20:00.000Z';
				const reason = 'ICU capacity full';
				const updated = applyTransition(doc, 'rejected', 'Hospital Staff B', nowIso, reason);

				expect(updated.status).toBe('rejected');
				expect(updated.response_reason).toBe(reason);
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
						referral_type: 'medical-emergency',
						to_org: { name: 'Emergency Clinic', kind: 'hospital', contact: '911' },
						reason: 'Sprained ankle with swelling',
						notes: 'Allergic to penicillin'
					});

					const redacted = redactForScope(doc, scope) as RedactedReferral;

					expect(redacted.to_org?.kind).toBe('hospital');
					// Redacted fields
					expect(redacted.to_org?.name).toBeUndefined();
					expect(redacted.to_org?.contact).toBeUndefined();
					expect(redacted.reason).toBeUndefined();
					expect(redacted.notes).toBeUndefined();
					expect(redacted.evacuee_id).toBeUndefined();
					expect(redacted.national_id).toBeUndefined();
				});

				it(`non-hospital referral: keeps org details/reason but strips PII for ${scope}`, () => {
					const doc = mockReferral({
						referral_type: 'resource',
						to_org: { name: 'Red Cross Shelter', kind: 'social_services', contact: '123' },
						reason: 'Need emergency family pack',
						notes: 'Has 3 children'
					});

					const redacted = redactForScope(doc, scope) as RedactedReferral;

					expect(redacted.to_org?.kind).toBe('social_services');
					// Kept fields
					expect(redacted.to_org?.name).toBe('Red Cross Shelter');
					expect(redacted.to_org?.contact).toBe('123');
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
