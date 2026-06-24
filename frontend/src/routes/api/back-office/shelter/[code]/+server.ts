import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminRaw, requireAdmin, serviceError, ServiceError } from '$lib/server/couch-admin';
import {
	updateShelterSchema,
	migrateShelterV2ToCurrent,
	type ShelterMaster
} from '$lib/features/shelters';

export const prerender = false;

const REGISTRY_DB = 'registry';

function nowIso(): string {
	return new Date().toISOString();
}

async function findMasterByCode(code: string): Promise<ShelterMaster | null> {
	const res = await adminRaw(`/${REGISTRY_DB}/_all_docs?include_docs=true`, 'GET');
	if (res.status === 404) return null;
	if (res.status >= 400) throw new ServiceError('INTERNAL', 'Could not read registry');
	const rows = (res.data as { rows?: { id: string; doc: unknown }[] })?.rows ?? [];
	const match = rows.find(
		(r) => r.id.startsWith('shelter:') && r.doc && (r.doc as { code?: string }).code === code
	);
	return (match?.doc as ShelterMaster) ?? null;
}

function migrate(master: ShelterMaster): ShelterMaster {
	if (master.schema_v >= 3) return master;
	return migrateShelterV2ToCurrent(master);
}

export const GET: RequestHandler = async ({ request, params }) => {
	await requireAdmin(request.headers.get('cookie'));
	try {
		const code = params.code;
		if (!code) {
			return error(400, { message: 'Missing code' });
		}

		const master = await findMasterByCode(code);
		if (!master) {
			return error(404, { message: `Shelter "${code}" not found` });
		}

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
	await requireAdmin(request.headers.get('cookie'));
	try {
		const code = params.code;
		if (!code) {
			return error(400, { message: 'Missing code' });
		}

		const body = (await request.json().catch(() => ({}))) as unknown;
		const input = updateShelterSchema.parse(body);

		const master = await findMasterByCode(code);
		if (!master) {
			return error(404, { message: `Shelter "${code}" not found` });
		}
		if (!master._rev) {
			return error(500, { message: 'Shelter master doc has no _rev' });
		}

		const migrated = migrate(master);
		const updated: ShelterMaster = {
			...migrated,
			...input,
			updated_at: nowIso()
		};

		const res = await adminRaw(`/${REGISTRY_DB}/${encodeURIComponent(master._id)}`, 'PUT', updated);
		if (res.status >= 400) {
			const couchErr = res.data as { error?: string; reason?: string } | null;
			const detail = couchErr?.reason ?? couchErr?.error ?? 'unknown';
			throw new ServiceError('INTERNAL', `Registry PATCH failed (${res.status}): ${detail}`);
		}

		return json({ ok: true, code });
	} catch (e) {
		return serviceError(e);
	}
};
