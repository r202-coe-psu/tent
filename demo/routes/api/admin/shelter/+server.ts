import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminRaw, requireAdmin } from '$lib/server/couch-admin';
// Server endpoints import the feature's PURE modules directly (not the barrel),
// because the barrel re-exports Svelte components + browser-only code that must
// not enter the server bundle. Same pattern as the demo setup endpoint.
// eslint-disable-next-line no-restricted-imports
import { SHELTER_IDS, shelterDbName, shelterRole } from '$lib/features/shelter/domain/shelter';
// eslint-disable-next-line no-restricted-imports
import {
	SHELTER_SEED_CONFIG,
	SHELTER_SEED_ITEMS,
	SHELTER_SEED_USERS,
	validateDocUpdateFn,
	type SetupStep,
	type ShelterVerifyResult
} from '$lib/features/shelter/data/shelter.seed';

// Admin-only endpoint; never prerendered (static build omits it).
export const prerender = false;

/** PUT a doc, carrying the existing _rev if one is present (idempotent). */
async function upsert(db: string, id: string, body: Record<string, unknown>): Promise<number> {
	const { data: existing } = await adminRaw(`/${db}/${encodeURIComponent(id)}`, 'GET');
	const rev = (existing as { _rev?: string })?._rev;
	const { status } = await adminRaw(`/${db}/${encodeURIComponent(id)}`, 'PUT', {
		...body,
		...(rev ? { _rev: rev } : {})
	});
	return status;
}

async function setup(): Promise<SetupStep[]> {
	const steps: SetupStep[] = [];

	for (const id of SHELTER_IDS) {
		const db = shelterDbName(id);

		// 1. database
		const { status: dbStatus } = await adminRaw(`/${db}`, 'PUT');
		if (dbStatus === 201) steps.push({ label: `Create ${db}`, status: 'ok' });
		else if (dbStatus === 412)
			steps.push({ label: `Create ${db}`, status: 'skip', detail: 'exists' });
		else steps.push({ label: `Create ${db}`, status: 'error', detail: `HTTP ${dbStatus}` });

		// 2. _security — members = this shelter's manager + volunteer roles
		const { status: secStatus } = await adminRaw(`/${db}/_security`, 'PUT', {
			admins: { names: [], roles: [] },
			members: { names: [], roles: [shelterRole(id, 'manager'), shelterRole(id, 'volunteer')] }
		});
		steps.push({ label: `Security ${db}`, status: secStatus === 200 ? 'ok' : 'error' });

		// 3. validate_doc_update design doc (role-based write rules)
		const dsStatus = await upsert(db, '_design/access', {
			_id: '_design/access',
			validate_doc_update: validateDocUpdateFn(id)
		});
		steps.push({
			label: `Rules ${db}`,
			status: dsStatus === 201 || dsStatus === 200 ? 'ok' : 'error'
		});

		// 4. config singleton
		const cfg = SHELTER_SEED_CONFIG[id];
		await upsert(db, 'config', {
			_id: 'config',
			type: 'shelter_config',
			shelterId: id,
			name: cfg.name,
			capacity: cfg.capacity
		});

		// 5. inventory items + opening stock txn
		for (const item of SHELTER_SEED_ITEMS) {
			const itemId = `item:seed-${item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
			await upsert(db, itemId, {
				_id: itemId,
				type: 'inventory_item',
				name: item.name,
				unit: item.unit
			});
			await upsert(db, `txn:seed-${itemId}`, {
				_id: `txn:seed-${itemId}`,
				type: 'stock_txn',
				itemId,
				delta: item.initial,
				reason: 'Opening stock',
				byUser: 'system',
				at: new Date().toISOString()
			});
		}
		steps.push({ label: `Seed data ${db}`, status: 'ok' });
	}

	// 6. users
	for (const u of SHELTER_SEED_USERS) {
		const status = await upsert('_users', `org.couchdb.user:${u.name}`, {
			_id: `org.couchdb.user:${u.name}`,
			name: u.name,
			password: u.password,
			roles: [shelterRole(u.shelter, u.role)],
			type: 'user'
		});
		steps.push({
			label: `User ${u.name}`,
			status: status === 201 || status === 200 ? 'ok' : 'error'
		});
	}

	return steps;
}

async function teardown(): Promise<SetupStep[]> {
	const steps: SetupStep[] = [];
	for (const id of SHELTER_IDS) {
		const db = shelterDbName(id);
		const { status } = await adminRaw(`/${db}`, 'DELETE');
		steps.push({
			label: `Delete ${db}`,
			status: status === 200 ? 'ok' : status === 404 ? 'skip' : 'error'
		});
	}
	for (const u of SHELTER_SEED_USERS) {
		const { data } = await adminRaw(`/_users/org.couchdb.user:${u.name}`, 'GET');
		const rev = (data as { _rev?: string })?._rev;
		if (rev) {
			const { status } = await adminRaw(`/_users/org.couchdb.user:${u.name}?rev=${rev}`, 'DELETE');
			steps.push({ label: `Delete user ${u.name}`, status: status === 200 ? 'ok' : 'error' });
		} else {
			steps.push({ label: `Delete user ${u.name}`, status: 'skip', detail: 'not found' });
		}
	}
	return steps;
}

async function verify(): Promise<ShelterVerifyResult> {
	const databases: ShelterVerifyResult['databases'] = [];
	for (const id of SHELTER_IDS) {
		const db = shelterDbName(id);
		const { status, data } = await adminRaw(`/${db}/_security`, 'GET');
		if (status === 200) {
			databases.push({
				db,
				exists: true,
				members: (data as { members?: unknown }).members ?? null
			});
		} else {
			databases.push({ db, exists: false, members: null, error: `HTTP ${status}` });
		}
	}

	const users: ShelterVerifyResult['users'] = [];
	for (const u of SHELTER_SEED_USERS) {
		const { status, data } = await adminRaw(`/_users/org.couchdb.user:${u.name}`, 'GET');
		if (status === 200)
			users.push({ name: u.name, roles: (data as { roles?: string[] }).roles ?? [] });
		else users.push({ name: u.name, roles: null, error: `HTTP ${status}` });
	}

	return { databases, users };
}

export const POST: RequestHandler = async ({ request }) => {
	await requireAdmin(request.headers.get('cookie'));

	const { action } = (await request.json().catch(() => ({}))) as { action?: string };
	switch (action) {
		case 'setup':
			return json(await setup());
		case 'teardown':
			return json(await teardown());
		case 'verify':
			return json(await verify());
		default:
			throw error(400, `Unknown action: ${action}`);
	}
};
