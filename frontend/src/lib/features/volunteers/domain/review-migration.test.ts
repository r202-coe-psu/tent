import { describe, expect, it } from 'vitest';
import { backfillVolunteerReview, deriveReviewReasons } from './review-migration';

describe('volunteer review migration helpers', () => {
	it('backfills identity and skill records without changing the legacy flag', () => {
		const migrated = backfillVolunteerReview({
			identity_verified: true,
			type: 'volunteer'
		}) as Record<string, unknown>;
		expect(migrated.identity_verified).toBe(true);
		expect(migrated.identity_verification).toMatchObject({ status: 'verified' });
		expect(migrated.skill_verifications).toEqual({});
	});

	it('derives both skill and job-fit reasons for a controlled non-auto job', () => {
		expect(
			deriveReviewReasons(
				{ status: 'pending_review', applicant: { skills: ['พยาบาล'] } },
				{ tier: 'staff-capable', auto_accept: false }
			)
		).toEqual(['skill_certification', 'job_fit']);
	});

	it('marks an unrecognizable old pending row as legacy review', () => {
		expect(deriveReviewReasons({ status: 'pending_review' })).toEqual(['legacy_review']);
	});
});
