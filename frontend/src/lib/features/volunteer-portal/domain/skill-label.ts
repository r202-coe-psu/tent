/**
 * skill-label.ts — turn a stored skill value into something a member of the
 * public can read (CR-100).
 *
 * Pure TypeScript — no I/O, no Svelte, and deliberately no import from the
 * staff `volunteers` feature: this runs in the anonymous SPA, which must not
 * pull the CouchDB layer that barrel carries.
 *
 * `job.skills_required[]` holds Master Data **codes** from CR-100 on, and
 * plain labels on documents written before it. The public board therefore
 * resolves by code first and falls back to a normalised label match, exactly
 * like `volunteers/domain/skill-catalog.ts` does back-office side. A value the
 * skill list no longer carries is omitted so internal IDs never leak into the
 * public UI.
 */

import type { VolunteerSkillOption } from './volunteer';

function normalize(value: string): string {
	return value.trim().toLowerCase().normalize('NFC');
}

/** Master Data codes are implementation details and must never be a label. */
export function isTechnicalSkillValue(value: string): boolean {
	return /^item_[a-z0-9]+$/i.test(value.trim());
}

/** The master option a stored value refers to, by code then by legacy label. */
export function findSkillOption(
	value: string,
	options: readonly VolunteerSkillOption[]
): VolunteerSkillOption | undefined {
	const byCode = options.find((option) => option.code === value);
	if (byCode) return byCode;
	const needle = normalize(value);
	return options.find(
		(option) => normalize(option.code) === needle || normalize(option.label) === needle
	);
}

/** Human label for a stored value — the raw value when the list has dropped it. */
export function skillLabel(value: string, options: readonly VolunteerSkillOption[]): string {
	const option = findSkillOption(value, options);
	const label = option?.label?.trim() ?? value.trim();
	return isTechnicalSkillValue(label) ? '' : label;
}

/** `{ value, label }` per stored skill, in the order the job lists them. */
export function skillLabels(
	values: readonly string[],
	options: readonly VolunteerSkillOption[]
): { value: string; label: string }[] {
	return values.flatMap((value) => {
		if (!findSkillOption(value, options)) return [];
		const label = skillLabel(value, options);
		return label ? [{ value, label }] : [];
	});
}
