/**
 * skills.ts — controlled-skill gating (CR-092 FR-VOL-02.4 / CR-094 FR-VOL-10.3).
 *
 * A "controlled" skill (medical/nursing/first-aid — professions the shelter
 * manager must verify credentials for) must never let an applicant/volunteer
 * resolve straight to `confirmed` — it must land on `pending_review` and stay
 * there until a manager reviews it.
 *
 * The authoritative controlled-skill list is master data
 * (`volunteer_skills`, CR-094 FR-VOL-08.5 / CR-100): callers pass it in as
 * `controlledSkills`, built by `skill-catalog.ts#controlledSkillValues` from
 * the effective master doc for the shelter. `DEFAULT_CONTROLLED_SKILLS` is
 * only the fallback floor for a caller that has no master list at hand.
 */

import type { Job } from './job.schema';
import type { JobApplicationStatus } from './job-application.schema';
import { normalizeSkillText } from './skill-catalog';

/**
 * Compatibility floor for legacy free-text applications. The selectable skill
 * list and the normal controlled-skill list come from Master Data; these values
 * only protect old records written before `volunteer_skills` existed.
 */
export const DEFAULT_CONTROLLED_SKILLS: readonly string[] = [
	'medical',
	'nursing',
	'first aid',
	'พยาบาล',
	'การแพทย์',
	'แพทย์',
	'ปฐมพยาบาล',
	'การแพทย์ / ปฐมพยาบาล'
];

// `normalizeSkillText` trims/lowercases and NFC-composes so Thai text pasted
// from sources that produce NFD-decomposed combining marks still matches
// (CR-094 FR-VOL-10.3 / schema.md §2.17 example uses ["ปฐมพยาบาล"]). Shared
// with `skill-catalog.ts` so the gate and the catalog normalise identically.
const normalize = normalizeSkillText;

/** Is `skill` in the controlled set (case/whitespace-insensitive)? */
export function isControlledSkill(
	skill: string,
	controlledSkills: readonly string[] = DEFAULT_CONTROLLED_SKILLS
): boolean {
	const needle = normalize(skill);
	return controlledSkills.some((c) => normalize(c) === needle);
}

/**
 * Initial `job_application.status` for an applicant's skills against a job.
 *
 * `confirmed` requires ALL of: no controlled skill among `skills`,
 * `job.tier === 'operational'`, and `job.auto_accept === true` (strict — a
 * truthy non-boolean such as `'yes'` read back from an unvalidated document
 * must not auto-confirm). Anything else is `pending_review`, which is the
 * documented default (schema.md §2.18 / CR-092 FR-VOL-02.4).
 *
 * The `tier` check is defence in depth: F-AUTO already forbids `auto_accept`
 * on a `staff-capable` job at the schema level, but a `staff-capable`
 * confirmation is what later drives a CouchDB RoleKey grant under CR-094
 * FR-VOL-05R.2, so it is re-checked here rather than trusted.
 *
 * Never returns anything but these two values (CR-094 FR-VOL-10.3:
 * "ห้ามข้ามไป active").
 */
export function initialStatusForSkills(
	skills: readonly string[],
	job: Pick<Job, 'auto_accept' | 'tier'>,
	controlledSkills: readonly string[] = DEFAULT_CONTROLLED_SKILLS
): Extract<JobApplicationStatus, 'pending_review' | 'confirmed'> {
	if (skills.some((s) => isControlledSkill(s, controlledSkills))) return 'pending_review';
	if (job.tier !== 'operational') return 'pending_review';
	return job.auto_accept === true ? 'confirmed' : 'pending_review';
}
