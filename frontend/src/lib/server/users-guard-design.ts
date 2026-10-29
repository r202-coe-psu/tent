/**
 * CouchDB `_users/_design/tent_guard` (draft-coordinator-limited-access-grant FR-11).
 *
 * CouchDB's own `_auth` lets a user rewrite their own `_users` doc, apart from `roles`. A
 * coordinator grant lives in `role_grants`, and `active`, `personnel_type` and `volunteer_id`
 * decide which accounts a coordinator may extend, so a user holding a grant could otherwise
 * delete their own expiry, reactivate themselves or point the account at another volunteer.
 * This validation rejects those edits from anyone but a CouchDB admin. The BFF and the worker
 * write `_users` with the admin credential, so they pass; passwords and every other field stay
 * with `_auth`.
 *
 * Deliberately free of `$env` / `@sveltejs/kit` so `scripts/sync-central-db.ts` (plain `tsx`)
 * can deploy it. Server-only: the admin URL it is deployed with never reaches a client bundle.
 */

import type { CouchReq } from './ensure-public-writer';

export const USERS_DB = '_users';
export const USERS_GUARD_DESIGN_ID = '_design/tent_guard';

/** Fields only an admin may change on a `_users` doc. */
export const USERS_GUARDED_FIELDS = [
	'role_grants',
	'active',
	'personnel_type',
	'volunteer_id'
] as const;

/** Bump when the validation changes so a deployer can tell a stale design doc from a current one. */
export const USERS_GUARD_DESIGN_VERSION = 1;

export interface UsersGuardDesignDoc {
	_id: string;
	version: number;
	language: 'javascript';
	validate_doc_update: string;
}

/**
 * CouchDB runs this in SpiderMonkey (ES5): `var`, no arrow functions. A missing field equals
 * `null`, and so does an empty `role_grants`; objects compare by content, not key order.
 */
export function buildUsersGuardValidateDocUpdate(): string {
	return `function (newDoc, oldDoc, userCtx) {
  if (userCtx.roles.indexOf('_admin') !== -1) return;
  if (newDoc._deleted) return;
  if (typeof newDoc._id !== 'string' || newDoc._id.indexOf('org.couchdb.user:') !== 0) return;
  function canon(v) {
    if (v === undefined || v === null) return 'null';
    if (typeof v !== 'object') return JSON.stringify(v);
    if (Object.prototype.toString.call(v) === '[object Array]') {
      var items = [];
      for (var i = 0; i < v.length; i++) items.push(canon(v[i]));
      return '[' + items.join(',') + ']';
    }
    var keys = [];
    for (var k in v) {
      if (Object.prototype.hasOwnProperty.call(v, k)) keys.push(k);
    }
    keys.sort();
    var pairs = [];
    for (var j = 0; j < keys.length; j++) pairs.push(JSON.stringify(keys[j]) + ':' + canon(v[keys[j]]));
    return '{' + pairs.join(',') + '}';
  }
  function value(doc, field) {
    var v = doc ? doc[field] : undefined;
    if (field === 'role_grants' && (!v || v.length === 0)) return undefined;
    return v;
  }
  var guarded = ${JSON.stringify(USERS_GUARDED_FIELDS)};
  for (var f = 0; f < guarded.length; f++) {
    if (canon(value(oldDoc, guarded[f])) !== canon(value(newDoc, guarded[f]))) {
      throw({ forbidden: guarded[f] + ' can only be changed by an administrator' });
    }
  }
}`;
}

export function buildUsersGuardDesignDoc(): UsersGuardDesignDoc {
	return {
		_id: USERS_GUARD_DESIGN_ID,
		version: USERS_GUARD_DESIGN_VERSION,
		language: 'javascript',
		validate_doc_update: buildUsersGuardValidateDocUpdate()
	};
}

/**
 * Idempotent PUT of `_users/_design/tent_guard`: nothing is written when the stored version and
 * function already match. `dryRun` only reports what would change.
 */
export async function deployUsersGuardDesign(
	couchReq: CouchReq,
	dryRun: boolean
): Promise<'current' | 'deployed'> {
	const desired = buildUsersGuardDesignDoc();
	const existing = await couchReq('GET', `/${USERS_DB}/${USERS_GUARD_DESIGN_ID}`);
	const current =
		existing.status === 200
			? (existing.data as { _rev?: string; version?: number; validate_doc_update?: string } | null)
			: null;
	if (
		current &&
		current.version === desired.version &&
		current.validate_doc_update === desired.validate_doc_update
	) {
		return 'current';
	}
	if (dryRun) return 'deployed';
	const res = await couchReq('PUT', `/${USERS_DB}/${USERS_GUARD_DESIGN_ID}`, {
		...desired,
		...(current?._rev ? { _rev: current._rev } : {})
	});
	if (res.status >= 400) {
		const detail = (res.data as { reason?: string; error?: string } | null) ?? {};
		throw new Error(
			`_users ${USERS_GUARD_DESIGN_ID} deploy failed (${res.status}): ${detail.reason ?? detail.error ?? 'unknown'}`
		);
	}
	return 'deployed';
}
