/**
 * skill-catalog.ts — the one place that turns Master Data `volunteer_skills`
 * into selectable options and resolves a stored skill value back to its
 * option (CR-100).
 *
 * Pure TypeScript — no I/O, no Svelte. Every screen that shows or matches a
 * skill goes through here so none of them re-implements the compat rule below.
 *
 * **Stored value = master `code`** (CR-100), the same shape `vulnerable_group`
 * has always used: the document keeps the stable code and the label is
 * resolved at render time, so renaming a skill in Master Data no longer
 * orphans the jobs that asked for it.
 *
 * **Compat rule:** documents written before CR-100 hold the *label* instead.
 * `resolveSkillOption()` therefore looks up by code first and falls back to a
 * normalised label match, and `controlledSkillValues()` / `skillMatches()`
 * compare against both forms — so a legacy job keeps displaying, matching and
 * gating correctly, and moves to a code the next time it is saved.
 */

import { SKILL_MASTER } from './skill-master';

/** One selectable skill as the UI needs it. */
export interface SkillOption {
	/** Master Data `code` — the value stored on documents from CR-100 onward. */
	code: string;
	label: string;
	description: string;
	/** Emoji shown on the selectable card. */
	icon: string;
	/** Requires certificate review — forces `pending_review` (CR-094 FR-VOL-10.3). */
	controlled: boolean;
}

/**
 * The shape `master-data`'s items arrive in. Declared structurally (not
 * imported from the master-data feature) to keep this module dependency-free:
 * `domain/` must not reach across features.
 */
export interface MasterSkillItem {
	code: string;
	label: string;
	status?: string;
	category?: string;
	description?: string;
}

/**
 * Trim + lowercase + NFC. The NFC pass matters for Thai pasted from sources
 * that produce decomposed combining marks — without it "ปฐมพยาบาล" typed one
 * way never matches the same word stored the other way.
 */
export function normalizeSkillText(value: string): string {
	return value.trim().toLowerCase().normalize('NFC');
}

function isControlledCategory(category: string | undefined): boolean {
	return category === 'controlled' || category === 'CONTROLLED';
}

/** Active master items → options, in the order Master Data lists them. */
export function skillOptionsFromMaster(items: readonly MasterSkillItem[]): SkillOption[] {
	return items
		.filter((item) => item.status !== 'inactive')
		.map((item) => ({
			code: item.code,
			label: item.label,
			description: item.description ?? '',
			icon: isControlledCategory(item.category) ? '🩺' : '✨',
			controlled: isControlledCategory(item.category)
		}));
}

/**
 * Options used until Master Data answers (or when a registry doc is still
 * empty), derived from the pre-CR-100 hardcoded list. Its `key` was the stored
 * value back then, so it doubles as both code and label here — which is
 * exactly what the compat rule expects to find.
 */
export const FALLBACK_SKILL_OPTIONS: readonly SkillOption[] = SKILL_MASTER.map((skill) => ({
	code: skill.key,
	label: skill.label,
	description: skill.description,
	icon: skill.icon,
	controlled: skill.controlled
}));

/** The option a stored value refers to: by `code`, else by legacy label. */
export function resolveSkillOption(
	value: string,
	options: readonly SkillOption[]
): SkillOption | undefined {
	const byCode = options.find((option) => option.code === value);
	if (byCode) return byCode;
	const needle = normalizeSkillText(value);
	return options.find(
		(option) =>
			normalizeSkillText(option.code) === needle || normalizeSkillText(option.label) === needle
	);
}

/** Human label for a stored value — the raw value when Master Data has dropped it. */
export function resolveSkillLabel(value: string, options: readonly SkillOption[]): string {
	return resolveSkillOption(value, options)?.label ?? value;
}

/** Canonical `code` for a stored value — the raw value when it resolves to nothing. */
export function toSkillCode(value: string, options: readonly SkillOption[]): string {
	return resolveSkillOption(value, options)?.code ?? value;
}

/** Map stored values to codes, dropping duplicates but keeping order. */
export function toSkillCodes(values: readonly string[], options: readonly SkillOption[]): string[] {
	const out: string[] = [];
	for (const value of values) {
		const code = toSkillCode(value, options);
		if (!out.includes(code)) out.push(code);
	}
	return out;
}

/**
 * Every value that means "one of the controlled skills" — each controlled
 * option's code AND its label, because legacy `volunteer.skills` documents
 * still store labels and pre-CR-100 jobs/applications do too. Feed this
 * to `skills.ts#initialStatusForSkills` so the gate follows Master Data instead
 * of the hardcoded floor.
 */
export function controlledSkillValues(options: readonly SkillOption[]): string[] {
	const out: string[] = [];
	for (const option of options.filter((o) => o.controlled)) {
		for (const value of [option.code, option.label]) {
			if (!out.includes(value)) out.push(value);
		}
	}
	return out;
}

/**
 * Do two stored values mean the same skill? Resolving both to a Master Data
 * code first lets current code values and legacy label values meet.
 */
export function skillMatches(a: string, b: string, options: readonly SkillOption[]): boolean {
	const left = resolveSkillOption(a, options);
	const right = resolveSkillOption(b, options);
	if (left && right) return left.code === right.code;
	return normalizeSkillText(a) === normalizeSkillText(b);
}

/** Does `have` cover at least one of `required`? Empty `required` reads as "yes". */
export function hasAnyRequiredSkill(
	have: readonly string[],
	required: readonly string[],
	options: readonly SkillOption[]
): boolean {
	if (required.length === 0) return true;
	return required.some((needed) => have.some((held) => skillMatches(held, needed, options)));
}
