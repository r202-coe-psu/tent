import { catalogOrigin } from './catalog';

export type CatalogHistoryScope =
	{ visible: false } | { visible: true; shelterCode: string | null };

/**
 * Where the edit history of a catalog doc can be read from (CR-259 audit log).
 *
 * The worker stamps a catalog event with the shelter of the DB it was written to
 * (`shelter_*` for a shelter's local/override row, `null` for the central catalog),
 * and the audit-log API pins a non-admin reader to their own shelter. So:
 * - a shelter row (local/override) → anyone on the page, filtered to that shelter;
 * - a central row → system admin only (unfiltered); a shelter reader could never
 *   see its `null`-shelter events, so the panel is hidden instead of showing empty.
 */
export function catalogHistoryScope(
	doc: { shelter_code?: string; override?: boolean } | null | undefined,
	viewer: { isSystemAdmin: boolean; shelterCode: string | null | undefined }
): CatalogHistoryScope {
	if (!doc) return { visible: false };
	const shelterCode = viewer.shelterCode ?? null;
	if (catalogOrigin(doc, shelterCode) !== 'central') return { visible: true, shelterCode };
	return viewer.isSystemAdmin ? { visible: true, shelterCode: null } : { visible: false };
}
