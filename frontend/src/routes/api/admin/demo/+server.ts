import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminRaw, requireAdmin } from '$lib/server/couch-admin';
import {
	DEMO_DBS,
	DEMO_USERS,
	type DemoDb,
	type SetupStep,
	type VerifyResult
} from '$lib/features/demo/data/demo.constants';

// Admin-only endpoints; never prerendered (static build omits them).
export const prerender = false;

async function setupDemo(): Promise<SetupStep[]> {
	const steps: SetupStep[] = [];

	// 1. Create databases
	for (const db of DEMO_DBS) {
		const { status, data } = await adminRaw(`/${db}`, 'PUT');
		if (status === 201) steps.push({ label: `Create ${db}`, status: 'ok' });
		else if (status === 412) steps.push({ label: `Create ${db}`, status: 'skip', detail: 'already exists' });
		else steps.push({ label: `Create ${db}`, status: 'error', detail: (data as { reason?: string })?.reason });
	}

	// 2. _security per database
	const securities: [DemoDb, object][] = [
		['demo_alpha',  { admins: { names: [], roles: [] }, members: { names: [], roles: ['team:alpha'] } }],
		['demo_beta',   { admins: { names: [], roles: [] }, members: { names: [], roles: ['team:beta'] } }],
		['demo_shared', { admins: { names: [], roles: [] }, members: { names: [], roles: ['team:alpha', 'team:beta'] } }]
	];
	for (const [db, sec] of securities) {
		const { status } = await adminRaw(`/${db}/_security`, 'PUT', sec);
		steps.push({ label: `Security ${db}`, status: status === 200 ? 'ok' : 'error' });
	}

	// 3. validate_doc_update design doc in demo_shared
	const validateFn = `function(newDoc, oldDoc, userCtx) {
  if (userCtx.roles.indexOf('_admin') !== -1) return;
  if (newDoc._deleted) {
    if (oldDoc && oldDoc.team) {
      if (userCtx.roles.indexOf('team:' + oldDoc.team) === -1)
        throw({ forbidden: 'cannot delete: wrong team' });
    }
    return;
  }
  var team = newDoc.team;
  if (!team) throw({ forbidden: 'team field required' });
  if (userCtx.roles.indexOf('team:' + team) === -1)
    throw({ forbidden: 'Access denied: requires role team:' + team });
}`;

	const { data: existing } = await adminRaw('/demo_shared/_design/access', 'GET');
	const rev = (existing as { _rev?: string })?._rev;
	const { status: dsStatus } = await adminRaw(
		'/demo_shared/_design/access',
		'PUT',
		{ _id: '_design/access', ...(rev ? { _rev: rev } : {}), validate_doc_update: validateFn }
	);
	steps.push({ label: 'Design doc demo_shared', status: dsStatus === 201 || dsStatus === 200 ? 'ok' : 'error' });

	// 4. Create demo users
	for (const u of DEMO_USERS) {
		const { data: existingUser } = await adminRaw(`/_users/org.couchdb.user:${u.name}`, 'GET');
		const uRev = (existingUser as { _rev?: string })?._rev;
		const { status } = await adminRaw(
			`/_users/org.couchdb.user:${u.name}`,
			'PUT',
			{ _id: `org.couchdb.user:${u.name}`, ...(uRev ? { _rev: uRev } : {}), name: u.name, password: u.password, roles: [...u.roles], type: 'user' }
		);
		steps.push({ label: `User ${u.name}`, status: status === 201 || status === 200 ? 'ok' : 'error' });
	}

	// 5. Seed initial documents so read test works even on empty DB
	const seeds = [
		{ db: 'demo_alpha',  id: 'seed_alpha', body: { type: 'seed', msg: 'Alpha data', team: 'alpha' } },
		{ db: 'demo_beta',   id: 'seed_beta',  body: { type: 'seed', msg: 'Beta data',  team: 'beta' } },
		{ db: 'demo_shared', id: 'seed_a',     body: { type: 'seed', msg: 'Shared alpha doc', team: 'alpha' } },
		{ db: 'demo_shared', id: 'seed_b',     body: { type: 'seed', msg: 'Shared beta doc',  team: 'beta' } }
	];
	for (const s of seeds) {
		const { data: sd } = await adminRaw(`/${s.db}/${s.id}`, 'GET');
		const sRev = (sd as { _rev?: string })?._rev;
		await adminRaw(`/${s.db}/${s.id}`, 'PUT', { ...s.body, ...(sRev ? { _rev: sRev } : {}) });
	}
	steps.push({ label: 'Seed documents', status: 'ok' });

	return steps;
}

async function teardownDemo(): Promise<SetupStep[]> {
	const steps: SetupStep[] = [];
	for (const db of DEMO_DBS) {
		const { status } = await adminRaw(`/${db}`, 'DELETE');
		steps.push({ label: `Delete ${db}`, status: status === 200 ? 'ok' : 'error' });
	}
	for (const u of DEMO_USERS) {
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

async function verifySetup(): Promise<VerifyResult> {
	const databases: VerifyResult['databases'] = [];
	for (const db of DEMO_DBS) {
		const { status, data } = await adminRaw(`/${db}/_security`, 'GET');
		if (status === 200) {
			databases.push({ db, exists: true, security: data as VerifyResult['databases'][number]['security'] });
		} else {
			databases.push({ db, exists: false, security: null, error: `HTTP ${status}` });
		}
	}

	const users: VerifyResult['users'] = [];
	for (const u of DEMO_USERS) {
		const { status, data } = await adminRaw(`/_users/org.couchdb.user:${u.name}`, 'GET');
		if (status === 200) {
			users.push({ name: u.name, roles: (data as { roles?: string[] }).roles ?? [] });
		} else {
			users.push({ name: u.name, roles: null, error: `HTTP ${status}` });
		}
	}

	return { databases, users };
}

export const POST: RequestHandler = async ({ request }) => {
	await requireAdmin(request.headers.get('cookie'));

	const { action } = (await request.json().catch(() => ({}))) as { action?: string };

	switch (action) {
		case 'setup':
			return json(await setupDemo());
		case 'teardown':
			return json(await teardownDemo());
		case 'verify':
			return json(await verifySetup());
		default:
			throw error(400, `Unknown action: ${action}`);
	}
};
