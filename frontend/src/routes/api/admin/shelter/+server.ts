import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminRaw, requireAdmin } from '$lib/server/couch-admin';

// Dev-only provisioning endpoint — never prerendered (absent from the static
// prod build). Production databases are provisioned out of band.
export const prerender = false;

const SHELTER_CODE = 'SH001';
// CouchDB requires lowercase database names; the `shelter_code` field stays 'SH001'.
const SHELTER_DB = `shelter_${SHELTER_CODE.toLowerCase()}`;

/**
 * Server-side `validate_doc_update` for the walking skeleton. Deployed
 * identically to Central (and later Edge). Enforces the common envelope +
 * shelter_code match + the doc types this slice allows. `_admin` bypasses, so
 * provisioning + seed writes are not blocked. Patterned on the demo shelter
 * seed (demo/lib/features/shelter/data/shelter.seed.ts).
 */
const VALIDATE_DOC_UPDATE = `function (newDoc, oldDoc, userCtx) {
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
  if (newDoc.shelter_code !== '${SHELTER_CODE}') {
    throw { forbidden: 'shelter_code must be ${SHELTER_CODE}' };
  }
  var allowed = ['evacuee'];
  if (allowed.indexOf(newDoc.type) === -1) {
    throw { forbidden: 'doc type not allowed yet: ' + newDoc.type };
  }
}`;

function nowIso(): string {
	return new Date().toISOString();
}

function seedEvacuee(first: string, last: string, gender: string, phone: string | null) {
	const ts = nowIso();
	// Deterministic id so re-running provisioning is idempotent (409 = already
	// seeded, not a new duplicate).
	return {
		_id: `evacuee:seed-${first.toLowerCase()}`,
		type: 'evacuee',
		schema_v: 1,
		shelter_code: SHELTER_CODE,
		created_at: ts,
		updated_at: ts,
		created_by: 'seed',
		first_name: first,
		last_name: last,
		gender,
		phone,
		special_needs: [],
		household_id: null,
		current_stay: { status: 'registered', zone: null, since: ts },
		privacy: { search_excluded: false },
		registered_via: 'import'
	};
}

export const POST: RequestHandler = async ({ request }) => {
	await requireAdmin(request.headers.get('cookie'));

	const steps: { step: string; status: number }[] = [];

	// 1. Create the database (412 = already exists → fine, idempotent).
	const created = await adminRaw(`/${SHELTER_DB}`, 'PUT');
	steps.push({ step: 'create-db', status: created.status });

	// 2. _security — admins bypass everything; members gain access by the
	//    shelter role (real role assignment is T-02/T-47; the workshop admin
	//    user is covered by the _admin bypass meanwhile).
	const security = await adminRaw(`/${SHELTER_DB}/_security`, 'PUT', {
		admins: { names: [], roles: [] },
		members: { names: [], roles: [`shelter:${SHELTER_CODE}`] }
	});
	steps.push({ step: 'security', status: security.status });

	// 3. validate_doc_update design doc (idempotent: read _rev, re-PUT).
	const existing = await adminRaw(`/${SHELTER_DB}/_design/access`, 'GET');
	const rev = existing.status === 200 ? (existing.data as { _rev: string })._rev : undefined;
	const design = await adminRaw(`/${SHELTER_DB}/_design/access`, 'PUT', {
		_id: '_design/access',
		...(rev ? { _rev: rev } : {}),
		validate_doc_update: VALIDATE_DOC_UPDATE
	});
	steps.push({ step: 'design', status: design.status });

	// 4. Seed a couple of evacuees (409 = already there → fine).
	const seeds = [
		seedEvacuee('Somchai', 'Jaidee', 'male', '0811111111'),
		seedEvacuee('Malee', 'Suksai', 'female', null)
	];
	for (const doc of seeds) {
		const res = await adminRaw(`/${SHELTER_DB}/${encodeURIComponent(doc._id)}`, 'PUT', doc);
		steps.push({ step: `seed:${doc.first_name}`, status: res.status });
	}

	return json({ ok: true, db: SHELTER_DB, steps });
};
