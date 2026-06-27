import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serviceError, requireShelterScopeOrSA, requireAdmin } from '$lib/server/couch-admin';
import { updateShelterSchema } from '$lib/features/shelters/server';
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
			location: migrated.location ?? {},
			contact: migrated.contact ?? {},
			area_m2: migrated.area_m2 ?? null,
			area_type: migrated.area_type ?? null,
			facilities: migrated.facilities ?? {},
			common_areas: migrated.common_areas ?? { sub_storage: [] },
			utilities: migrated.utilities ?? { communications: [] },
			risk: migrated.risk ?? {},
			zones: migrated.zones ?? []
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
