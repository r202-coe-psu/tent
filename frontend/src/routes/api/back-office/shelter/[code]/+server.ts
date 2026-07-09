import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serviceError, requireShelterScopeOrSA, requireAdmin } from '$lib/server/couch-admin';
import {
	updateShelterSchema,
	EMPTY_ADMISSION_POLICY,
	EMPTY_LUGGAGE_POLICY,
	EMPTY_PARKING_POLICY
} from '$lib/features/shelters/server';
import { findMasterByCode, migrate, nowIso, updateMaster } from '$lib/server/shelters.admin';

export const prerender = false;

export const GET: RequestHandler = async ({ request, params }) => {
	const code = params.code;
	if (!code) return error(400, { message: 'Missing code' });

	try {
		await requireShelterScopeOrSA(request.headers.get('cookie'), code);

		const master = await findMasterByCode(code);
		if (!master) return error(404, { message: `Shelter "${code}" not found` });

		const migrated = migrate(master);
		return json({
			code: migrated.code,
			name: migrated.name,
			db: `shelter_${migrated.code.toLowerCase()}`,
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
		});
	} catch (e) {
		return serviceError(e);
	}
};

export const PATCH: RequestHandler = async ({ request, params }) => {
	const code = params.code;
	if (!code) return error(400, { message: 'Missing code' });

	try {
		await requireAdmin(request.headers.get('cookie'));

		const body = (await request.json().catch(() => ({}))) as unknown;
		const input = updateShelterSchema.parse(body);

		// updateMaster re-reads the doc + retries 409s internally
		// (skill: couchdb-pouchdb-bestpractices §3).
		await updateMaster(code, () => ({
			patch: {
				...input,
				updated_at: nowIso()
			}
		}));

		return json({ ok: true, code });
	} catch (e) {
		return serviceError(e);
	}
};
