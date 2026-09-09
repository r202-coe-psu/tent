/**
 * Religion choices shown on registration forms.
 * Schema still allows `other` for legacy docs — UI maps that to `unknown`.
 */
export const RELIGION_UI_VALUES = ['buddhist', 'muslim', 'christian', 'unknown'] as const;

export type ReligionUiValue = (typeof RELIGION_UI_VALUES)[number];

export function normalizeReligionForUi(
	religion: string | null | undefined
): ReligionUiValue {
	if (
		religion === 'buddhist' ||
		religion === 'muslim' ||
		religion === 'christian' ||
		religion === 'unknown'
	) {
		return religion;
	}
	return 'unknown';
}
