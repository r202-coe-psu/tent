/**
 * Recipient allergies ↔ ready-meal allergens at the distribution desk (#607, CR-191
 * FR-MRM-07/08).
 *
 * Both sides are lists of master `allergy` codes (CR-187) — callers resolve labels to codes
 * and drop free text first, because free text is never matched automatically. A conflict is
 * advisory: the handover still goes ahead with an override and a reason.
 */

/** Allergy codes held by both the recipient and the menu, in menu order, without repeats. */
export function findAllergenConflicts(
	recipientAllergyCodes: readonly string[],
	menuAllergenCodes: readonly string[]
): string[] {
	const held = new Set(recipientAllergyCodes);
	return [...new Set(menuAllergenCodes.filter((code) => held.has(code)))];
}
