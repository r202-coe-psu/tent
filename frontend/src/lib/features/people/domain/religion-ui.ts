/**
 * Religion choices shown on registration forms (CR-148: 「อื่นๆ (ระบุ)」 is selectable and
 * requires `religion_other`).
 */
export const RELIGION_UI_VALUES = ['buddhist', 'muslim', 'christian', 'other', 'unknown'] as const;

export type ReligionUiValue = (typeof RELIGION_UI_VALUES)[number];

export function normalizeReligionForUi(religion: string | null | undefined): ReligionUiValue {
	return (RELIGION_UI_VALUES as readonly string[]).includes(religion ?? '')
		? (religion as ReligionUiValue)
		: 'unknown';
}
