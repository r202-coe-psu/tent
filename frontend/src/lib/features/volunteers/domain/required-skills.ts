/**
 * required-skills.ts — what an applicant brings against the skills a job asks for.
 *
 * Pure — no I/O, no Svelte. The approve dialog shows each skill the job lists with the
 * applicant's standing in it, so whoever approves sees a medical job's applicant who
 * never claimed the medical skill. Nothing here blocks an approval: a job may take
 * general helpers alongside the skilled people it asks for (owner decision 2026-10-19),
 * so a missing skill is a warning only.
 */
import { normalizeSkillText, resolveSkillOption, type SkillOption } from './skill-catalog';
import { skillVerificationStatus, type VerificationRecord } from './verification';

/**
 * - `has`         — claimed; the skill needs no certificate.
 * - `certified`   — claimed and its certificate check passed.
 * - `uncertified` — claimed, certificate not checked yet.
 * - `rejected`    — claimed, certificate check failed.
 * - `missing`     — the applicant did not claim it.
 */
export type RequiredSkillState = 'has' | 'certified' | 'uncertified' | 'rejected' | 'missing';

export const REQUIRED_SKILL_STATE_LABEL: Record<RequiredSkillState, string> = {
	has: 'มี',
	certified: 'มี · ตรวจใบรับรองแล้ว ผ่าน',
	uncertified: 'มี · ยังไม่ได้ตรวจใบรับรอง',
	rejected: 'มี · ตรวจใบรับรองแล้ว ไม่ผ่าน',
	missing: 'ผู้สมัครไม่ได้ระบุ'
};

export interface RequiredSkillCheck {
	code: string;
	label: string;
	/** Needs a certificate (Master Data `controlled`). */
	controlled: boolean;
	state: RequiredSkillState;
}

/**
 * One row per skill the job asks for, in the job's order. Values Master Data no longer
 * knows are left out, as on the public board — they would only show a raw id.
 */
export function checkRequiredSkills(
	required: readonly string[],
	applicantSkills: readonly string[],
	options: readonly SkillOption[],
	volunteer: { skill_verifications?: Record<string, VerificationRecord> } | null
): RequiredSkillCheck[] {
	const seen = new Set<string>();
	const checks: RequiredSkillCheck[] = [];
	for (const value of required) {
		const option = resolveSkillOption(value, options);
		if (!option || seen.has(option.code)) continue;
		seen.add(option.code);

		const claimed = applicantSkills.find(
			(skill) =>
				resolveSkillOption(skill, options)?.code === option.code ||
				normalizeSkillText(skill) === normalizeSkillText(value)
		);
		let state: RequiredSkillState;
		if (claimed === undefined) state = 'missing';
		else if (!option.controlled) state = 'has';
		else {
			// Verifications are keyed by code from CR-100 on, by the claimed label before it.
			const statuses = volunteer
				? [option.code, claimed].map((key) => skillVerificationStatus(volunteer, key))
				: [];
			state = statuses.includes('verified')
				? 'certified'
				: statuses.includes('rejected')
					? 'rejected'
					: 'uncertified';
		}
		checks.push({ code: option.code, label: option.label, controlled: option.controlled, state });
	}
	return checks;
}
