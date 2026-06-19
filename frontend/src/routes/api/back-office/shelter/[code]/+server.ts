import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminRaw, requireAdmin, serviceError, ServiceError } from '$lib/server/couch-admin';
import {
	updateShelterSchema,
	type Zone,
	type Item,
	type Rule,
	type Sop
} from '$lib/features/shelters';

export const prerender = false;

const REGISTRY_DB = 'registry';

interface ShelterMaster {
	_id: string;
	_rev?: string;
	type: 'shelter';
	schema_v: number;
	code: string;
	name: string;
	zones: Zone[];
	items?: Item[];
	rules?: Rule[];
	sops?: Sop[];
	status: string;
	capacity?: number;
	created_at: string;
	updated_at: string;
}

function nowIso(): string {
	return new Date().toISOString();
}

async function findMasterByCode(code: string): Promise<ShelterMaster | null> {
	const res = await adminRaw(`/${REGISTRY_DB}/_all_docs?include_docs=true`, 'GET');
	if (res.status === 404) return null;
	if (res.status >= 400) throw new ServiceError('INTERNAL', 'Could not read registry');
	const rows = (res.data as { rows?: { id: string; doc: ShelterMaster }[] })?.rows ?? [];
	const match = rows.find((r) => r.id.startsWith('shelter:') && r.doc && r.doc.code === code);
	return match?.doc ?? null;
}

function migrateV1ToV2(master: ShelterMaster): ShelterMaster {
	if (master.schema_v >= 2) return master;
	const zones = master.zones ?? [];
	const capacity = zones.reduce((sum, z) => sum + (z.capacity ?? 0), 0);
	const status = master.status === 'active' ? 'open' : master.status;
	return {
		...master,
		schema_v: 2,
		capacity,
		status
	};
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

		const migrated = migrateV1ToV2(master);
		return json({
			code: migrated.code,
			name: migrated.name,
			db: `shelter_${migrated.code.toLowerCase()}`,
			status: migrated.status,
			capacity: migrated.capacity ?? 0,
			zones: migrated.zones ?? [],
			items: migrated.items ?? [],
			rules: migrated.rules ?? [],
			sops: migrated.sops ?? []
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

		const migrated = migrateV1ToV2(master);
		const updated = {
			...migrated,
			name: input.name,
			capacity: input.capacity,
			zones: input.zones,
			items: input.items,
			rules: input.rules,
			sops: input.sops,
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
