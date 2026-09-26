/**
 * Helpers for mapping Superforms / Zod validation errors onto shelter form sections.
 */

/**
 * shelterSchema keys that belong to each single-page form section, keyed by the
 * section anchor id. Key order is the canonical DOM order. A dotted path
 * (`common_areas.sub_storage`) claims that child away from the section that
 * lists its parent key.
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
	'storage-points': ['common_areas.sub_storage'],
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

function valueAtPath(record: Record<string, unknown>, path: string): unknown {
	let node: unknown = record;
	for (const key of path.split('.')) {
		if (!node || typeof node !== 'object') return undefined;
		node = (node as Record<string, unknown>)[key];
	}
	return node;
}

/** Child keys of top-level `field` that a dotted path in another section claims. */
function claimedChildren(
	field: string,
	sectionFields: Record<string, readonly string[]>
): Set<string> {
	const prefix = `${field}.`;
	const out = new Set<string>();
	for (const fields of Object.values(sectionFields)) {
		for (const f of fields) if (f.startsWith(prefix)) out.add(f.slice(prefix.length));
	}
	return out;
}

/** The error subtrees a section field owns — minus children claimed elsewhere. */
function ownedErrorNodes(
	record: Record<string, unknown>,
	field: string,
	sectionFields: Record<string, readonly string[]>
): unknown[] {
	if (field.includes('.')) {
		const node = valueAtPath(record, field);
		return node === undefined ? [] : [node];
	}
	if (!(field in record)) return [];
	const node = record[field];
	const claimed = claimedChildren(field, sectionFields);
	if (claimed.size === 0 || !node || typeof node !== 'object' || Array.isArray(node)) {
		return [node];
	}
	return Object.entries(node as Record<string, unknown>)
		.filter(([key]) => !claimed.has(key))
		.map(([, value]) => value);
}

function fieldHasErrors(
	record: Record<string, unknown>,
	field: string,
	sectionFields: Record<string, readonly string[]>
): boolean {
	return ownedErrorNodes(record, field, sectionFields).length > 0;
}

/** Section ids that contain at least one errored field, in canonical order. */
export function findInvalidSectionIds(
	errors: unknown,
	sectionFields: Record<string, readonly string[]> = SHELTER_SECTION_FIELDS
): string[] {
	if (topLevelErrorKeys(errors).length === 0) return [];
	const record = errors as Record<string, unknown>;
	const invalid: string[] = [];
	for (const [sectionId, fields] of Object.entries(sectionFields)) {
		if (fields.some((field) => fieldHasErrors(record, field, sectionFields))) {
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

/** Messages for a section's fields (e.g. the section being revealed). */
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
		for (const node of ownedErrorNodes(record, field, sectionFields)) {
			walkErrorMessages(node, out, seen);
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
	if (!fields || topLevelErrorKeys(errors).length === 0) return false;
	const record = errors as Record<string, unknown>;
	return fields.some((field) => fieldHasErrors(record, field, sectionFields));
}
