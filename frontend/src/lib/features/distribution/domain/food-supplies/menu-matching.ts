/**
 * Recipient ↔ ready-meal menu matching at the distribution desk
 * (`draft-onsite-distribution.md` §C, decided 2026-10-10):
 * - FR-MRM-00 A / FR-MRM-04 A — in V1; a mismatch needs an override with a reason.
 * - FR-MRM-01 VEGAN B — VEGAN is not derived for recipients and a VEGAN tag on a menu is
 *   ignored, so anyone may take a VEGAN menu without an override.
 * - FR-MRM-01 age — CR-130 age buckets via `ageBucketForBirthYear` (the demographics
 *   dashboard's): `<1` INFANT, `1-5` + `6-11` CHILD, `60+` ELDERLY.
 */
import {
	ageBucketForBirthYear,
	type AgeBucket
} from '$lib/features/dashboard/domain/demographics.schema';

/** Tags a recipient can carry and a menu can target. */
export type MenuTargetTag = 'HALAL' | 'INFANT' | 'CHILD' | 'ELDERLY';

/** CR-130 age buckets → the age tag they carry; other buckets carry none. */
const AGE_BUCKET_TAG: Partial<Record<AgeBucket, MenuTargetTag>> = {
	'<1': 'INFANT',
	'1-5': 'CHILD',
	'6-11': 'CHILD',
	'60+': 'ELDERLY'
};

/** The evacuee fields the rule reads (schema.md §1.1). */
export interface MenuRecipientProfile {
	religion?: string | null;
	vulnerable_groups?: readonly string[] | null;
	special_needs?: readonly string[] | null;
	/** Thai Buddhist birth year — the CR-130 source of truth for the age bucket. */
	birth_year?: number | null;
	/** Age in years, used only when `birth_year` is missing. */
	age?: number | null;
}

/** The `item_master` fields the rule reads (schema.md, AC-TKT-05.1). */
export interface MenuTagSource {
	dietary?: readonly string[] | null;
	age_group?: string | null;
}

/** `special_needs` is free text since CR-046 — match the CR-022 keywords exactly, trimmed. */
function hasSpecialNeed(profile: MenuRecipientProfile, keyword: string): boolean {
	return (profile.special_needs ?? []).some((need) => need.trim().toLowerCase() === keyword);
}

function hasVulnerableGroup(profile: MenuRecipientProfile, code: string): boolean {
	return (profile.vulnerable_groups ?? []).includes(code);
}

/** CR-130 bucket from `birth_year`, else from `age` (converted to a Buddhist birth year). */
function recipientAgeBucket(profile: MenuRecipientProfile, currentYear: number): AgeBucket {
	if (typeof profile.birth_year === 'number') {
		return ageBucketForBirthYear(profile.birth_year, currentYear);
	}
	if (typeof profile.age === 'number') {
		return ageBucketForBirthYear(currentYear + 543 - profile.age, currentYear);
	}
	return 'unknown';
}

/** FR-MRM-01 — tags derived for an `evacuee` recipient (a person may carry several). */
export function deriveRecipientMenuTags(
	profile: MenuRecipientProfile,
	currentYear: number = new Date().getFullYear()
): MenuTargetTag[] {
	const ageTag = AGE_BUCKET_TAG[recipientAgeBucket(profile, currentYear)];
	const tags: MenuTargetTag[] = [];
	if (profile.religion === 'muslim') tags.push('HALAL');
	if (
		ageTag === 'INFANT' ||
		hasVulnerableGroup(profile, 'infant') ||
		hasSpecialNeed(profile, 'infant')
	) {
		tags.push('INFANT');
	}
	if (ageTag === 'CHILD' || hasVulnerableGroup(profile, 'young_child')) tags.push('CHILD');
	if (
		ageTag === 'ELDERLY' ||
		hasVulnerableGroup(profile, 'elderly_dependent') ||
		hasSpecialNeed(profile, 'elderly')
	) {
		tags.push('ELDERLY');
	}
	return tags;
}

/** Tags a menu targets. Empty = general menu (`dietary = []`, `age_group ∈ {ALL, unset}`). */
export function menuTargetTags(item: MenuTagSource): MenuTargetTag[] {
	const tags: MenuTargetTag[] = [];
	if ((item.dietary ?? []).includes('HALAL')) tags.push('HALAL');
	if (item.age_group === 'INFANT' || item.age_group === 'CHILD' || item.age_group === 'ELDERLY') {
		tags.push(item.age_group);
	}
	return tags;
}

export interface MenuMatchResult {
	matches: boolean;
	/** What the menu targets — empty for a general menu. */
	menuTags: MenuTargetTag[];
}

/**
 * FR-MRM-02/03 — a general menu matches everyone; a tagged menu needs at least one shared tag.
 * Pass `null` recipient tags for `volunteer` / `outside` recipients (they carry no tags).
 */
export function matchRecipientToMenu(
	recipientTags: readonly MenuTargetTag[] | null,
	item: MenuTagSource
): MenuMatchResult {
	const menuTags = menuTargetTags(item);
	if (menuTags.length === 0) return { matches: true, menuTags };
	const held = new Set(recipientTags ?? []);
	return { matches: menuTags.some((tag) => held.has(tag)), menuTags };
}
