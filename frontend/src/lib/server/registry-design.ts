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
 * Bump when a view or the registry write policy changes so deployers can tell a
 * stale design doc from a current one without diffing every function body.
 */
export const REGISTRY_DESIGN_VERSION = 5;

export interface RegistryDesignDoc {
	_id: string;
	version: number;
	language: 'javascript';
	views: Record<string, { map: string }>;
	validate_doc_update: string;
}

/**
 * Registry is readable by scoped staff, but all registry writes are central
 * administration operations. In particular, import jobs/items/locks/counters
 * must not be forgeable through a browser-authenticated CouchDB session.
 */
export function buildRegistryValidateDocUpdate(): string {
	return `function (newDoc, oldDoc, userCtx) {
  if (userCtx.roles.indexOf('_admin') !== -1 || userCtx.roles.indexOf('system_admin') !== -1) {
    return;
  }
  throw({ forbidden: 'Only system administrators can write registry documents' });
}`;
}

/**
 * `by_code` — one row per shelter master, keyed by `shelter.code` (`SH001`).
 * Query with `?key="SH001"&include_docs=true&limit=1`.
 * `by_code_number` — the same masters keyed by their numeric suffix. Query
 * descending with `limit=1` to bootstrap the shelter-code sequence without a
 * full registry scan.
 * `by_normalized_name` — normalized shelter names for duplicate detection on the import
 * path without loading the whole registry for every item (CR-126).
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
			},
			by_code_number: {
				map: `function (doc) {
  if (doc.type === 'shelter' && /^SH\\d+$/i.test(doc.code || '')) {
    emit(parseInt(doc.code.slice(2), 10), null);
  }
}`
			},
			by_normalized_name: {
				map: `function (doc) {
  if (doc.type === 'shelter' && doc.name) {
    emit(doc.name.trim().replace(/\\s+/g, ' ').toLowerCase(), null);
  }
}`
			},
			by_name: {
				map: `function (doc) {
  if (doc.type === 'shelter' && doc.name) {
    emit(doc.name.trim().replace(/\\s+/g, ' ').toLowerCase(), null);
  }
}`
			}
		},
		validate_doc_update: buildRegistryValidateDocUpdate()
	};
}

/** Path for a single-shelter lookup by code (already URL-encoded). */
export function registryByCodePath(code: string): string {
	return `/${REGISTRY_DB}/${REGISTRY_DESIGN_ID}/_view/by_code?key=${encodeURIComponent(
		JSON.stringify(code)
	)}&include_docs=true&limit=1`;
}

/** Path for the highest numeric shelter-code suffix. */
export function registryHighestByCodePath(): string {
	return `/${REGISTRY_DB}/${REGISTRY_DESIGN_ID}/_view/by_code_number?descending=true&include_docs=true&limit=1`;
}

/** Path for a normalized shelter-name lookup. */
export function registryByNamePath(name: string): string {
	const normalized = name.trim().replace(/\s+/g, ' ').toLowerCase();
	return `/${REGISTRY_DB}/${REGISTRY_DESIGN_ID}/_view/by_normalized_name?key=${encodeURIComponent(
		JSON.stringify(normalized)
	)}&include_docs=true&limit=1`;
}
