/**
 * Recipient ↔ ready-meal menu matching at the distribution desk
 * (`docs/changes/draft-onsite-distribution.md §C`, status: proposed).
 *
 * Built ahead of the owner's decision on the draft's option A. Open points kept narrow on purpose:
 * - VEGAN is not derived for recipients and VEGAN on a menu is ignored (FR-MRM-01 VEGAN row is
 *   still NEEDS DECISION), so a VEGAN-only menu counts as general.
 * - Age cut-offs live in `MENU_AGE_BANDS` (FR-MRM-01 threshold is still NEEDS DECISION).
 */

/** Tags a recipient can carry and a menu can target. */
export type MenuTargetTag = 'HALAL' | 'INFANT' | 'CHILD' | 'ELDERLY';

/** Age bands in years. Proposed values — not yet confirmed by the project owner. */
export const MENU_AGE_BANDS = { infantUnder: 2, childUnder: 13, elderlyFrom: 60 } as const;

/** The evacuee fields the rule reads (schema.md §1.1). `age` = `evacueeAgeYears(doc)`. */
export interface MenuRecipientProfile {
	religion?: string | null;
	vulnerable_groups?: readonly string[] | null;
	special_needs?: readonly string[] | null;
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

/** FR-MRM-01 — tags derived for an `evacuee` recipient (a person may carry several). */
export function deriveRecipientMenuTags(profile: MenuRecipientProfile): MenuTargetTag[] {
	const age = typeof profile.age === 'number' ? profile.age : null;
	const tags: MenuTargetTag[] = [];
	if (profile.religion === 'muslim') tags.push('HALAL');
	if (
		hasVulnerableGroup(profile, 'infant') ||
		hasSpecialNeed(profile, 'infant') ||
		(age !== null && age < MENU_AGE_BANDS.infantUnder)
	) {
		tags.push('INFANT');
	}
	if (
		hasVulnerableGroup(profile, 'young_child') ||
		(age !== null && age >= MENU_AGE_BANDS.infantUnder && age < MENU_AGE_BANDS.childUnder)
	) {
		tags.push('CHILD');
	}
	if (
		hasVulnerableGroup(profile, 'elderly_dependent') ||
		hasSpecialNeed(profile, 'elderly') ||
		(age !== null && age >= MENU_AGE_BANDS.elderlyFrom)
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
