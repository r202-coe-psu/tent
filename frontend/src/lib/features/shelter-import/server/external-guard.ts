import { createShelterSchema } from '$lib/features/shelters/server';
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

/**
 * CR-252 FR-30 (authoritative twin of the preview check): an external shelter carries basic info
 * only. Returns the top-level keys (policy, utilities, risk, …) whose value differs from the
 * schema default — i.e. that a stale or hand-rolled client filled in. Zones / food points are
 * checked by the caller.
 */
export function externalForbiddenKeysFilled(data: Record<string, unknown>): string[] {
	// Two "untouched" shapes: every section as `{}`, and the optional policy sections omitted
	// (the importer emits either, depending on whether the sheet was present).
	const baselines = [false, true].flatMap((omit) => {
		const stripped: Record<string, unknown> = { ...data };
		for (const key of FORBIDDEN_KEYS) {
			if (omit && key.endsWith('_policy')) delete stripped[key];
			else stripped[key] = {};
		}
		const parsed = createShelterSchema.safeParse(stripped);
		return parsed.success ? [parsed.data as Record<string, unknown>] : [];
	});
	if (baselines.length === 0) return [];
	return FORBIDDEN_KEYS.filter((key) => {
		const got = JSON.stringify(data[key] ?? null);
		return !baselines.some((b) => JSON.stringify(b[key] ?? null) === got);
	});
}
