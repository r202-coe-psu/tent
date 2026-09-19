/**
 * Helpers for mapping Superforms / Zod validation errors onto shelter form sections.
 */

/**
 * Top-level shelterSchema keys that belong to each single-page form section,
 * keyed by the section anchor id. Key order is the canonical DOM order.
 */
export const SHELTER_SECTION_FIELDS: Record<string, readonly string[]> = {
	'basic-info': [
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
	capacity: ['capacity', 'area_m2', 'area_type'],
	'zones-facilities': ['zones', 'facilities', 'common_areas'],
	'food-distribution': ['food_distribution_points'],
	utilities: ['utilities'],
	risk: ['risk'],
	'admission-policy': ['admission_policy'],
	'luggage-policy': ['luggage_policy'],
	'parking-policy': ['parking_policy']
};

/** Top-level keys present on a Superforms errors object (skip `_errors`). */
export function topLevelErrorKeys(errors: unknown): string[] {
	if (!errors || typeof errors !== 'object') return [];
	return Object.keys(errors as Record<string, unknown>).filter((key) => key !== '_errors');
}

/** Section ids that contain at least one errored top-level field, in canonical order. */
export function findInvalidSectionIds(
	errors: unknown,
	sectionFields: Record<string, readonly string[]> = SHELTER_SECTION_FIELDS
): string[] {
	const keys = new Set(topLevelErrorKeys(errors));
	if (keys.size === 0) return [];
	const invalid: string[] = [];
	for (const [sectionId, fields] of Object.entries(sectionFields)) {
		if (fields.some((field) => keys.has(field))) {
			invalid.push(sectionId);
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

/** Messages for a section's top-level fields (e.g. the section being revealed). */
export function collectErrorMessagesForFields(
	errors: unknown,
	sectionId: string,
	sectionFields: Record<string, readonly string[]> = SHELTER_SECTION_FIELDS
): string[] {
	if (!errors || typeof errors !== 'object') return [];
	const fields = sectionFields[sectionId];
	if (!fields) return [];
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

export function sectionHasFieldErrors(
	sectionId: string,
	errors: unknown,
	sectionFields: Record<string, readonly string[]> = SHELTER_SECTION_FIELDS
): boolean {
	const fields = sectionFields[sectionId];
	if (!fields) return false;
	const keys = new Set(topLevelErrorKeys(errors));
	return fields.some((field) => keys.has(field));
}
