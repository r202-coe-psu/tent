import { EXTERNAL_FORBIDDEN_HEADERS, PATH_TO_HEADER } from '../domain/columns';

const FORBIDDEN = new Set(EXTERNAL_FORBIDDEN_HEADERS);
/** Top-level shelter keys owned by the sheets an external shelter must leave empty. */
const FORBIDDEN_KEYS = [
	...new Set(
		Object.entries(PATH_TO_HEADER)
			.filter(([, header]) => FORBIDDEN.has(header))
			.map(([path]) => path.split('.')[0])
	)
];

/** null / '' / false / 0 / [] / {} — or an object or array holding only such values. */
function isBlank(value: unknown): boolean {
	if (value === null || value === undefined || value === '' || value === false || value === 0) {
		return true;
	}
	if (Array.isArray(value)) return value.every(isBlank);
	if (typeof value === 'object') return Object.values(value as object).every(isBlank);
	return false;
}

/**
 * CR-252 FR-30 (authoritative twin of the preview check): an external shelter carries basic info
 * only. Returns the top-level keys (facilities, utilities, risk, policies, …) that hold real
 * data — the importer and the schema both fill untouched sections with null / empty / false, so
 * "blank" means structurally empty. Zones / food points are checked by the caller.
 */
export function externalForbiddenKeysFilled(data: Record<string, unknown>): string[] {
	return FORBIDDEN_KEYS.filter((key) => !isBlank(data[key]));
}
