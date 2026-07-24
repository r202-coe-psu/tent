/**
 * CouchDB `_design/access` helpers for per-shelter databases.
 * Shared by provisioning (+server.ts) and admin redeploy (shelters.admin.ts).
 */

/** Database name for a shelter's own per-shelter CouchDB. */
export function shelterDbName(code: string): string {
	return `shelter_${code.toLowerCase()}`;
}

/** Mango index definitions required by referral list/find (CR-045). */
export const REFERRAL_MANGO_INDEXES = [
	{
		index: { fields: ['type', 'status'] },
		name: 'referral-type-status-idx',
		type: 'json' as const
	},
	{
		index: { fields: ['type', 'evacuee_id'] },
		name: 'referral-type-evacuee-idx',
		type: 'json' as const
	},
	{
		index: { fields: ['type', 'created_at', 'status', 'evacuee_id'] },
		name: 'referral-list-sort-idx',
		type: 'json' as const
	},
	{
		index: { fields: ['type', 'created_at'] },
		name: 'referral-list-basic-idx',
		type: 'json' as const
	}
];

/**
 * Server-side `validate_doc_update` for a shelter db. Enforces the common
 * envelope (schema.md §0) + shelter_code match + allowed doc types. `_admin`
 * bypasses so provisioning/seed writes are not blocked.
 */
export function buildValidateDocUpdate(code: string): string {
	return `function (newDoc, oldDoc, userCtx) {
  if (userCtx.roles.indexOf('_admin') !== -1) return;
  if (newDoc._deleted) return;
  function require(field) {
    if (typeof newDoc[field] === 'undefined' || newDoc[field] === null) {
      throw { forbidden: field + ' is required' };
    }
  }
  require('type');
  require('schema_v');
  require('shelter_code');
  require('created_at');
  require('updated_at');
  require('created_by');
  if (newDoc.shelter_code !== '${code}') {
    throw { forbidden: 'shelter_code must be ${code}' };
  }
  var allowed = ['evacuee', 'donation', 'donation_campaign', 'stock_ledger', 'donation_slot', 'audit', 'referral'];
  if (allowed.indexOf(newDoc.type) === -1) {
    throw { forbidden: 'doc type not allowed yet: ' + newDoc.type };
  }
}`;
}
