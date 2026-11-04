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
export const REGISTRY_DESIGN_VERSION = 8;

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
  var isAdmin =
    userCtx.roles.indexOf('_admin') !== -1 || userCtx.roles.indexOf('system_admin') !== -1;
  if (!isAdmin) {
    throw({ forbidden: 'Only system administrators can write registry documents' });
  }
  if (newDoc.type === 'kiosk_banner' && !newDoc._deleted) {
    if (newDoc.schema_v !== 1 && newDoc.schema_v !== 2) {
      throw({ forbidden: 'kiosk_banner schema_v must be 1 or 2' });
    }
    if (
      newDoc.schema_v === 2 &&
      (typeof newDoc.group_id !== 'string' || newDoc.group_id.indexOf('kiosk_banner_group:') !== 0)
    ) {
      throw({ forbidden: 'kiosk_banner group_id must be a kiosk_banner_group id' });
    }
    if (typeof newDoc.shelter_code !== 'string' || newDoc.shelter_code.length === 0) {
      throw({ forbidden: 'kiosk_banner shelter_code must be a non-empty string' });
    }
    if (
      typeof newDoc.title !== 'string' ||
      newDoc.title.trim().length === 0 ||
      newDoc.title.length > 120
    ) {
      throw({ forbidden: 'kiosk_banner title must be 1-120 characters' });
    }
    if (newDoc.caption !== undefined && newDoc.caption !== null) {
      if (typeof newDoc.caption !== 'string' || newDoc.caption.length > 200) {
        throw({ forbidden: 'kiosk_banner caption must be a string up to 200 characters' });
      }
    }
    var isInt = function (n) {
      return typeof n === 'number' && isFinite(n) && Math.floor(n) === n;
    };
    if (!isInt(newDoc.order) || newDoc.order < 1) {
      throw({ forbidden: 'kiosk_banner order must be an integer >= 1' });
    }
    if (!isInt(newDoc.duration_sec) || newDoc.duration_sec < 3 || newDoc.duration_sec > 60) {
      throw({ forbidden: 'kiosk_banner duration_sec must be an integer from 3 to 60' });
    }
    if (newDoc.status !== 'active' && newDoc.status !== 'inactive') {
      throw({ forbidden: 'kiosk_banner status must be active or inactive' });
    }
    if (
      newDoc.screen_type !== undefined &&
      newDoc.screen_type !== 'compact' &&
      newDoc.screen_type !== 'portrait'
    ) {
      throw({ forbidden: 'kiosk_banner screen_type must be compact or portrait' });
    }
    var startMs = typeof newDoc.start_at === 'string' ? Date.parse(newDoc.start_at) : NaN;
    var endMs = typeof newDoc.end_at === 'string' ? Date.parse(newDoc.end_at) : NaN;
    if (isNaN(startMs) || isNaN(endMs)) {
      throw({ forbidden: 'kiosk_banner start_at and end_at must be parseable dates' });
    }
    if (endMs <= startMs) {
      throw({ forbidden: 'kiosk_banner end_at must be after start_at' });
    }
  }
  if (newDoc.type === 'kiosk_banner_group' && !newDoc._deleted) {
    if (newDoc.schema_v !== 1) {
      throw({ forbidden: 'kiosk_banner_group schema_v must be 1' });
    }
    if (typeof newDoc._id !== 'string' || newDoc._id.indexOf('kiosk_banner_group:') !== 0) {
      throw({ forbidden: 'kiosk_banner_group _id must start with kiosk_banner_group:' });
    }
    if (typeof newDoc.shelter_code !== 'string' || newDoc.shelter_code.length === 0) {
      throw({ forbidden: 'kiosk_banner_group shelter_code must be a non-empty string' });
    }
    if (
      typeof newDoc.name !== 'string' ||
      newDoc.name.trim().length === 0 ||
      newDoc.name.trim().length > 60
    ) {
      throw({ forbidden: 'kiosk_banner_group name must be 1-60 characters' });
    }
    if (newDoc.description !== undefined && newDoc.description !== null) {
      if (typeof newDoc.description !== 'string' || newDoc.description.length > 200) {
        throw({ forbidden: 'kiosk_banner_group description must be a string up to 200 characters' });
      }
    }
    var requiredStrings = ['created_at', 'updated_at', 'created_by'];
    for (var i = 0; i < requiredStrings.length; i++) {
      var value = newDoc[requiredStrings[i]];
      if (typeof value !== 'string' || value.length === 0) {
        throw({ forbidden: 'kiosk_banner_group ' + requiredStrings[i] + ' must be a non-empty string' });
      }
    }
  }
}`;
}

/**
 * `by_code` — one row per shelter master, keyed by `shelter.code` (`SH001`).
 * Query with `?key="SH001"&include_docs=true&limit=1`.
 * `by_code_number` — the same masters keyed by their numeric suffix. Query
 * descending with `limit=1` to bootstrap the shelter-code sequence without a
 * full registry scan.
 * `by_normalized_name` — normalized shelter names for duplicate detection on the import
 * path without loading the whole registry for every item (CR-141).
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

/**
 * Mango index for the shelter banner list (`findRawBanners`). CouchDB only uses a json index
 * when the selector names every indexed field, so this mirrors `{ type, shelter_code }` exactly.
 * The same index also serves `{ type: 'kiosk_banner_group', shelter_code }` group lists.
 */
export const KIOSK_BANNER_MANGO_INDEX = {
	index: { fields: ['type', 'shelter_code'] },
	name: 'kiosk-banner-by-shelter',
	type: 'json'
} as const;

/** Mango indexes deployed with `_design/app`; `POST /_index` is idempotent. */
export const REGISTRY_MANGO_INDEXES = [KIOSK_BANNER_MANGO_INDEX] as const;

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
