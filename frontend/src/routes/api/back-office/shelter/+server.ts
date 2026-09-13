import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin, requireShelterScopeOrSA, serviceError } from '$lib/server/couch-admin';
import {
	createShelterSchema,
	EMPTY_ADMISSION_POLICY,
	EMPTY_LUGGAGE_POLICY,
	EMPTY_PARKING_POLICY,
	DEFAULT_SHELTER_FEATURE_FLAGS,
	type ShelterMaster
} from '$lib/features/shelters/server';
import { migrate, listShelterMasters } from '$lib/server/shelters.admin';
import { shelterDbName } from '$lib/server/shelter-access-design';
import { provisionShelter } from '$lib/features/shelters/server/provisioner';

export const prerender = false;

/** POST shelter (5-section v3 schema) — provision a shelter; code is auto-assigned. */
export const POST: RequestHandler = async ({ request }) => {
	await requireAdmin(request.headers.get('cookie'));
	try {
		const body = (await request.json().catch(() => ({}))) as unknown;
		return json(await provisionShelter(createShelterSchema.parse(body)));
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
					site_kind: migrated.site_kind ?? 'evacuation_center',
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
					parking_policy: migrated.parking_policy ?? EMPTY_PARKING_POLICY,
					feature_flags: migrated.feature_flags ?? { ...DEFAULT_SHELTER_FEATURE_FLAGS }
				};
			}),
			{ headers: { 'cache-control': 'no-store, max-age=0' } }
		);
	} catch (e) {
		return serviceError(e);
	}
};
