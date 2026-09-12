/**
 * Helpers for mapping Superforms / Zod validation errors onto shelter wizard steps.
 */

/** Top-level shelterSchema keys that belong to each wizard step (index = step). */
export const SHELTER_STEP_FIELDS: readonly (readonly string[])[] = [
	[
		'name',
		'site_kind',
		'operation_status',
		'shelter_type',
		'project_level',
		'location',
		'contact',
		'municipality_zone',
		'community',
		'address_no',
		'village_no',
		'subdistrict',
		'district',
		'province',
		'postal_code',
		'key_personnel',
		'feature_flags'
	],
	['capacity', 'area_m2', 'area_type'],
	['zones', 'facilities', 'common_areas'],
	['utilities'],
	['risk'],
	['admission_policy'],
	['luggage_policy'],
	['parking_policy']
];

/** Top-level keys present on a Superforms errors object (skip `_errors`). */
export function topLevelErrorKeys(errors: unknown): string[] {
	if (!errors || typeof errors !== 'object') return [];
	return Object.keys(errors as Record<string, unknown>).filter((key) => key !== '_errors');
}

/** Step indexes (0-based) that contain at least one errored top-level field. */
export function findInvalidStepIndexes(
	errors: unknown,
	stepFields: readonly (readonly string[])[] = SHELTER_STEP_FIELDS
): number[] {
	const keys = new Set(topLevelErrorKeys(errors));
	if (keys.size === 0) return [];
	const invalid: number[] = [];
	for (let i = 0; i < stepFields.length; i++) {
		if (stepFields[i]?.some((field) => keys.has(field))) {
			invalid.push(i);
		}
	}
	return invalid;
}

function walkErrorMessages(node: unknown, out: string[], seen: Set<string>) {
	if (node == null) return;
	if (Array.isArray(node)) {
		for (const item of node) {
			if (typeof item === 'string') {
				const msg = item.trim();
				if (msg && !seen.has(msg)) {
					seen.add(msg);
					out.push(msg);
				}
			} else {
				walkErrorMessages(item, out, seen);
			}
		}
		return;
	}
	if (typeof node === 'object') {
		for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
			if (key === '_errors') {
				walkErrorMessages(value, out, seen);
			} else {
				walkErrorMessages(value, out, seen);
			}
		}
	}
}

/** Flatten nested Superforms / Zod error trees into unique human-readable messages. */
export function collectErrorMessages(errors: unknown): string[] {
	const out: string[] = [];
	walkErrorMessages(errors, out, new Set());
	return out;
}

/** Messages for a subset of top-level fields (e.g. the current wizard step). */
export function collectErrorMessagesForFields(
	errors: unknown,
	fields: readonly string[]
): string[] {
	if (!errors || typeof errors !== 'object') return [];
	const record = errors as Record<string, unknown>;
	const out: string[] = [];
	const seen = new Set<string>();
	for (const field of fields) {
		if (field in record) {
			walkErrorMessages(record[field], out, seen);
		}
	}
	return out;
}

export function stepHasFieldErrors(
	stepIndex: number,
	errors: unknown,
	stepFields: readonly (readonly string[])[] = SHELTER_STEP_FIELDS
): boolean {
	const fields = stepFields[stepIndex];
	if (!fields) return false;
	const keys = new Set(topLevelErrorKeys(errors));
	return fields.some((field) => keys.has(field));
}
