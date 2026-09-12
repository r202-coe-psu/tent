import { DEFAULT_CONTROLLED_SKILLS, isControlledSkill } from './skills';

export function backfillVolunteerReview<T extends Record<string, unknown>>(doc: T): T {
	if (doc.identity_verification && doc.skill_verifications) return doc;

	return {
		...doc,
		identity_verification: doc.identity_verification ?? {
			status: doc.identity_verified === true ? 'verified' : 'pending',
			reviewed_at: null,
			reviewed_by: null,
			notes: null
		},
		skill_verifications: doc.skill_verifications ?? {}
	};
}

export function deriveReviewReasons(
	doc: Record<string, unknown>,
	job?: Record<string, unknown>
): string[] {
	const applicant = doc.applicant;
	const skills =
		applicant &&
		typeof applicant === 'object' &&
		Array.isArray((applicant as Record<string, unknown>).skills)
			? ((applicant as Record<string, unknown>).skills as unknown[]).filter(
					(value): value is string => typeof value === 'string'
				)
			: [];
	const reasons: string[] = [];
	if (skills.some((skill) => isControlledSkill(skill, DEFAULT_CONTROLLED_SKILLS))) {
		reasons.push('skill_certification');
	}
	if (job && (job.tier !== 'operational' || job.auto_accept !== true)) {
		reasons.push('job_fit');
	}
	if (reasons.length === 0 && doc.status === 'pending_review') reasons.push('legacy_review');
	return reasons;
}
