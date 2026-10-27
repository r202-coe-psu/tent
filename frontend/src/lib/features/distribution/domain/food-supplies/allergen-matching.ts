/**
 * Recipient allergies ↔ ready-meal allergens at the distribution desk (#607, CR-191
 * FR-MRM-07/08).
 *
 * Both sides are lists of master `allergy` codes (CR-187) — callers resolve labels to codes
 * and drop free text first, because free text is never matched automatically. A conflict is
 * advisory: the handover still goes ahead with an override and a reason.
 *
 * A free-text allergy on the recipient (CR-191 FR-MRM-11) is not matched either, but it forces
 * the override on every menu and is kept in the override reason (no extra log field).
 */

/** Allergy codes held by both the recipient and the menu, in menu order, without repeats. */
export function findAllergenConflicts(
	recipientAllergyCodes: readonly string[],
	menuAllergenCodes: readonly string[]
): string[] {
	const held = new Set(recipientAllergyCodes);
	return [...new Set(menuAllergenCodes.filter((code) => held.has(code)))];
}

/**
 * Override reason for a recipient with unlisted (free-text) allergies (CR-191 FR-MRM-11):
 * `แพ้ (ไม่อยู่ในรายการ): a, b — <staff reason>`. Unchanged when there is no free text.
 */
export function withFreeTextAllergyReason(freeText: readonly string[], reason: string): string {
	if (freeText.length === 0) return reason;
	return `แพ้ (ไม่อยู่ในรายการ): ${freeText.join(', ')} — ${reason}`;
}
