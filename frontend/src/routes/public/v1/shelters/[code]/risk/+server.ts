import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminRaw, serviceError, ServiceError } from '$lib/server/couch-admin';
import {
	migrateShelterV2ToCurrent,
	type ShelterMaster,
	type ShelterMasterV2
} from '$lib/features/shelters';

export const prerender = false;

const REGISTRY_DB = 'registry';

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

function migrate(master: ShelterMasterV2 | ShelterMaster): ShelterMaster {
	if (master.schema_v >= 3) return master as ShelterMaster;
	return migrateShelterV2ToCurrent(master);
}

/**
 * GET /public/v1/shelters/{code}/risk
 * Public endpoint (no auth) — returns section 5 fields for EOC real-time consumption.
 * Live-sync driven (PouchDB changes feed → revalidate public query key).
 */
export const GET: RequestHandler = async ({ params }) => {
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
			operation_status: migrated.operation_status,
			risk: {
				elevation_m: migrated.risk?.elevation_m ?? null,
				entrance_description: migrated.risk?.entrance_description ?? null,
				constraints: migrated.risk?.constraints ?? null
			},
			updated_at: migrated.updated_at
		});
	} catch (e) {
		return serviceError(e);
	}
};
