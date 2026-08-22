/**
 * CouchDB `_design/app` for the `registry` database.
 *
 * `registry` holds `shelter:{ulid}` masters, so a shelter cannot be fetched by
 * its human code without a view — `findMasterByCode()` used to scan the whole
 * database on every call. The public booking BFF (CR-070/T-71) needs that
 * lookup on the write path to reject unknown and closed shelters, so the scan
 * is replaced by this view.
 *
 * Deliberately free of `$env` / `@sveltejs/kit` so the maintenance scripts under
 * `frontend/scripts/` (plain `tsx`) can deploy it too. Keep it that way.
 */

export const REGISTRY_DB = 'registry';
export const REGISTRY_DESIGN_ID = '_design/app';

/**
 * Bump when a view's map function changes so deployers can tell a stale design
 * doc from a current one without diffing every function body.
 */
export const REGISTRY_DESIGN_VERSION = 1;

export interface RegistryDesignDoc {
	_id: string;
	version: number;
	language: 'javascript';
	views: Record<string, { map: string }>;
}

/**
 * `by_code` — one row per shelter master, keyed by `shelter.code` (`SH001`).
 * Query with `?key="SH001"&include_docs=true&limit=1`.
 */
export function buildRegistryDesignDoc(): RegistryDesignDoc {
	return {
		_id: REGISTRY_DESIGN_ID,
		version: REGISTRY_DESIGN_VERSION,
		language: 'javascript',
		views: {
			by_code: {
				map: `function (doc) {
  if (doc.type === 'shelter' && doc.code) {
    emit(doc.code, null);
  }
}`
			}
		}
	};
}

/** Path for a single-shelter lookup by code (already URL-encoded). */
export function registryByCodePath(code: string): string {
	return `/${REGISTRY_DB}/${REGISTRY_DESIGN_ID}/_view/by_code?key=${encodeURIComponent(
		JSON.stringify(code)
	)}&include_docs=true&limit=1`;
}
