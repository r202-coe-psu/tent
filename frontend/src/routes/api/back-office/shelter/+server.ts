import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	adminRaw,
	requireAdmin,
	requireShelterScopeOrSA,
	serviceError
} from '$lib/server/couch-admin';
import { ulid } from '$lib/db/ulid';
import {
	createShelterSchema,
	EMPTY_ADMISSION_POLICY,
	EMPTY_LUGGAGE_POLICY,
	EMPTY_PARKING_POLICY,
	type ShelterMaster
} from '$lib/features/shelters/server';
import { SHELTER_CAPABILITIES } from '$lib/auth/roles';
import {
	SHELTER_REGISTRY_DB,
	listShelterMasters,
	migrate,
	mergeShelterSecurity,
	nowIso,
	deployShelterViews
} from '$lib/server/shelters.admin';
import { buildValidateDocUpdate, shelterDbName } from '$lib/server/shelter-access-design';

export const prerender = false;

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

/** Auto-assign the next shelter code in the SHxxx sequence. */
async function nextShelterCode(): Promise<string> {
	const masters = await listShelterMasters();
	let max = 0;
	for (const m of masters) {
		const match = m.code.match(/^SH(\d+)$/i);
		if (match) {
			const n = parseInt(match[1], 10);
			if (n > max) max = n;
		}
	}
	return `SH${String(max + 1).padStart(3, '0')}`;
}

/** POST shelter (5-section v3 schema) — provision a shelter; code is auto-assigned. */
export const POST: RequestHandler = async ({ request }) => {
	await requireAdmin(request.headers.get('cookie'));
	try {
		const body = (await request.json().catch(() => ({}))) as unknown;
		const input = createShelterSchema.parse(body);
		const code = await nextShelterCode();
		const db = shelterDbName(code);

		const steps: { step: string; status: number }[] = [];

		// 1. Shelter database (412 = already exists → idempotent).
		steps.push({ step: 'create-db', status: (await adminRaw(`/${db}`, 'PUT')).status });

		// 2. _security — read-modify-write to avoid clobbering existing members
		// (skill: couchdb-pouchdb-bestpractices §4). On first provision this is
		// a no-op merge; on re-runs it preserves any staff added since.
		await mergeShelterSecurity(db, { roles: ['system_admin'] }, { roles: [`shelter:${code}`] });
		steps.push({ step: 'security', status: 200 });

		// 3. validate_doc_update design doc (idempotent re-PUT with _rev).
		const existing = await adminRaw(`/${db}/_design/access`, 'GET');
		const rev = existing.status === 200 ? (existing.data as { _rev: string })._rev : undefined;
		const design = await adminRaw(`/${db}/_design/access`, 'PUT', {
			_id: '_design/access',
			...(rev ? { _rev: rev } : {}),
			validate_doc_update: buildValidateDocUpdate(code)
		});
		steps.push({ step: 'design', status: design.status });

		// 3.5. Deploy app views (CR-017)
		const appStatus = await deployShelterViews(db);
		steps.push({ step: 'design-app', status: appStatus });

		// 4. Registry + shelter master doc (schema.md §3.1) — idempotent by `code`.
		await adminRaw(`/${SHELTER_REGISTRY_DB}`, 'PUT');
		// Ensure authenticated users (SM / staff) can sync the registry.
		await mergeShelterSecurity(
			SHELTER_REGISTRY_DB,
			{ roles: ['system_admin'] },
			{ roles: [...SHELTER_CAPABILITIES] }
		);
		const masters = await listShelterMasters();
		if (!masters.some((m) => m.code === code)) {
			const ts = nowIso();
			const master = {
				_id: `shelter:${ulid()}`,
				type: 'shelter' as const,
				schema_v: 4 as const,
				code,
				...input,
				created_at: ts,
				updated_at: ts
			};
			const res = await adminRaw(
				`/${SHELTER_REGISTRY_DB}/${encodeURIComponent(master._id)}`,
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
	try {
		const caller = await requireShelterScopeOrSA(request.headers.get('cookie'));
		const masters = await listShelterMasters();
		// SA sees every shelter; a shelter-scoped user only sees their own.
		const visible = caller.isSA ? masters : masters.filter((m) => m.code === caller.shelterCode);
		return json(
			visible.map((m) => {
				const migrated = migrate(m as ShelterMaster);
				return {
					code: migrated.code,
					name: migrated.name,
					db: shelterDbName(migrated.code),
					operation_status: migrated.operation_status ?? 'standby',
					capacity: migrated.capacity ?? 0,
					shelter_type: migrated.shelter_type ?? null,
					project_level: migrated.project_level ?? null,
					location: migrated.location ?? {},
					contact: migrated.contact ?? {},
					municipality_zone: migrated.municipality_zone ?? null,
					community: migrated.community ?? null,
					address_no: migrated.address_no ?? null,
					village_no: migrated.village_no ?? null,
					subdistrict: migrated.subdistrict ?? null,
					district: migrated.district ?? null,
					province: migrated.province ?? null,
					postal_code: migrated.postal_code ?? null,
					key_personnel: migrated.key_personnel ?? null,
					area_m2: migrated.area_m2 ?? null,
					area_type: migrated.area_type ?? null,
					facilities: migrated.facilities ?? {},
					common_areas: migrated.common_areas ?? { sub_storage: [] },
					utilities: migrated.utilities ?? { communications: [] },
					risk: migrated.risk ?? {},
					zones: migrated.zones ?? [],
					admission_policy: migrated.admission_policy ?? EMPTY_ADMISSION_POLICY,
					luggage_policy: migrated.luggage_policy ?? EMPTY_LUGGAGE_POLICY,
					parking_policy: migrated.parking_policy ?? EMPTY_PARKING_POLICY
				};
			})
		);
	} catch (e) {
		return serviceError(e);
	}
};
