import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminRaw, requireAdmin, serviceError, ServiceError } from '$lib/server/couch-admin';
import { shelterCodeSchema } from '$lib/db/model';
import { ulid } from '$lib/db/ulid';

// Dev-only provisioning endpoint — never prerendered (absent from the static
// prod build). In production shelters are minted from the central counter
// (schema.md §3.1/§5.3); here we take an explicit shelter_code from the form —
// a documented dev shortcut, NOT a schema change. Requires CouchDB `_admin`
// since creating databases needs server admin.
export const prerender = false;

const REGISTRY_DB = 'registry';

interface Zone {
	code: string;
	name: string;
	capacity: number;
}

const DEFAULT_ZONES: Zone[] = [{ code: 'Z1', name: 'Zone 1', capacity: 100 }];

function shelterDbName(code: string): string {
	// CouchDB requires lowercase database names; the `shelter_code` field stays canonical (e.g. SH001).
	return `shelter_${code.toLowerCase()}`;
}

/**
 * Server-side `validate_doc_update` for a shelter db. Enforces the common
 * envelope (schema.md §0) + shelter_code match + allowed doc types. `_admin`
 * bypasses so provisioning/seed writes are not blocked. Patterned on the demo
 * shelter seed (demo/lib/features/shelter/data/shelter.seed.ts).
 */
function validateDocUpdate(code: string): string {
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
  var allowed = ['evacuee'];
  if (allowed.indexOf(newDoc.type) === -1) {
    throw { forbidden: 'doc type not allowed yet: ' + newDoc.type };
  }
}`;
}

function nowIso(): string {
	return new Date().toISOString();
}

function seedEvacuee(
	code: string,
	first: string,
	last: string,
	gender: string,
	phone: string | null
) {
	const ts = nowIso();
	return {
		_id: `evacuee:seed-${first.toLowerCase()}`,
		type: 'evacuee',
		schema_v: 1,
		shelter_code: code,
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

interface ShelterMaster {
	_id: string;
	_rev?: string;
	type: 'shelter';
	schema_v: number;
	code: string;
	name: string;
	zones: Zone[];
	status: string;
	created_at: string;
	updated_at: string;
}

/** Read all shelter master docs from the registry (empty if the db is absent). */
async function listShelterMasters(): Promise<ShelterMaster[]> {
	const res = await adminRaw(`/${REGISTRY_DB}/_all_docs?include_docs=true`, 'GET');
	if (res.status === 404) return [];
	if (res.status >= 400) throw new ServiceError('INTERNAL', 'Could not read registry');
	const rows = (res.data as { rows?: { id: string; doc: ShelterMaster }[] })?.rows ?? [];
	return rows.filter((r) => r.id.startsWith('shelter:') && r.doc).map((r) => r.doc);
}

/** POST { shelter_code, name?, zones? } — provision a shelter end to end. */
export const POST: RequestHandler = async ({ request }) => {
	await requireAdmin(request.headers.get('cookie'));
	try {
		const body = (await request.json().catch(() => ({}))) as {
			shelter_code?: unknown;
			name?: unknown;
			zones?: unknown;
		};
		const parsed = shelterCodeSchema.safeParse(body.shelter_code);
		if (!parsed.success) throw new ServiceError('VALIDATION', 'shelter_code must look like SH001');
		const code = parsed.data;
		const name =
			typeof body.name === 'string' && body.name.trim() ? body.name.trim() : `Shelter ${code}`;
		const zones =
			Array.isArray(body.zones) && body.zones.length ? (body.zones as Zone[]) : DEFAULT_ZONES;
		const db = shelterDbName(code);

		const steps: { step: string; status: number }[] = [];

		// 1. Shelter database (412 = already exists → idempotent).
		steps.push({ step: 'create-db', status: (await adminRaw(`/${db}`, 'PUT')).status });

		// 2. _security — members by shelter role, admins by system_admin (data-model.md §6).
		const security = await adminRaw(`/${db}/_security`, 'PUT', {
			admins: { names: [], roles: ['system_admin'] },
			members: { names: [], roles: [`shelter:${code}`] }
		});
		steps.push({ step: 'security', status: security.status });

		// 3. validate_doc_update design doc (idempotent re-PUT with _rev).
		const existing = await adminRaw(`/${db}/_design/access`, 'GET');
		const rev = existing.status === 200 ? (existing.data as { _rev: string })._rev : undefined;
		const design = await adminRaw(`/${db}/_design/access`, 'PUT', {
			_id: '_design/access',
			...(rev ? { _rev: rev } : {}),
			validate_doc_update: validateDocUpdate(code)
		});
		steps.push({ step: 'design', status: design.status });

		// 4. Registry + shelter master doc (schema.md §3.1) — idempotent by `code`.
		await adminRaw(`/${REGISTRY_DB}`, 'PUT');
		const masters = await listShelterMasters();
		if (!masters.some((m) => m.code === code)) {
			const ts = nowIso();
			const master: ShelterMaster = {
				_id: `shelter:${ulid()}`,
				type: 'shelter',
				schema_v: 1,
				code,
				name,
				zones,
				status: 'active',
				created_at: ts,
				updated_at: ts
			};
			const res = await adminRaw(
				`/${REGISTRY_DB}/${encodeURIComponent(master._id)}`,
				'PUT',
				master
			);
			steps.push({ step: 'registry-master', status: res.status });
		} else {
			steps.push({ step: 'registry-master', status: 200 });
		}

		// 5. Seed a couple of evacuees (409 = already there → fine).
		const seeds = [
			seedEvacuee(code, 'Somchai', 'Jaidee', 'male', '0811111111'),
			seedEvacuee(code, 'Malee', 'Suksai', 'female', null)
		];
		for (const doc of seeds) {
			const res = await adminRaw(`/${db}/${encodeURIComponent(doc._id)}`, 'PUT', doc);
			steps.push({ step: `seed:${doc.first_name}`, status: res.status });
		}

		return json({ ok: true, code, db, steps });
	} catch (e) {
		return serviceError(e);
	}
};

/** GET — list provisioned shelters from the registry. */
export const GET: RequestHandler = async ({ request }) => {
	await requireAdmin(request.headers.get('cookie'));
	try {
		const masters = await listShelterMasters();
		return json(
			masters.map((m) => ({
				code: m.code,
				name: m.name,
				db: shelterDbName(m.code),
				zones: m.zones ?? [],
				status: m.status
			}))
		);
	} catch (e) {
		return serviceError(e);
	}
};
