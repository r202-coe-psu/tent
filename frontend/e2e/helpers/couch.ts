/**
 * CouchDB admin helpers for E2E tests.
 *
 * Used to:
 * 1. Create temporary test users with specific roles (setup)
 * 2. Delete test users after each test (cleanup)
 * 3. Obtain AuthSession cookies for different roles so the BFF sees the correct caller
 *
 * Communicates directly with CouchDB on port 5984 (bypasses the SvelteKit BFF)
 * so we can set up state before hitting the actual endpoints under test.
 */

import process from 'node:process';

const COUCH_URL = process.env.COUCHDB_ADMIN_URL ?? 'http://admin:password@localhost:5984';
const USER_PREFIX = 'org.couchdb.user:';

/** Parse embedded-credentials URL into base + Basic auth header. */
function parseCouchUrl(raw: string): { base: string; auth: string } {
	const m = raw.match(/^(https?:\/\/)([^:]+):([^@]+)@(.+)$/);
	if (!m) throw new Error(`Invalid COUCHDB_ADMIN_URL: ${raw}`);
	const [, scheme, user, pass, host] = m;
	return {
		base: `${scheme}${host}`.replace(/\/$/, ''),
		auth: 'Basic ' + btoa(`${user}:${pass}`)
	};
}

export const { base: COUCH_BASE, auth: COUCH_AUTH } = parseCouchUrl(COUCH_URL);

async function couchReq(
	method: string,
	path: string,
	body?: unknown
): Promise<{ status: number; data: unknown }> {
	const res = await fetch(`${COUCH_BASE}${path}`, {
		method,
		headers: {
			Authorization: COUCH_AUTH,
			'Content-Type': 'application/json',
			Accept: 'application/json'
		},
		...(body !== undefined ? { body: JSON.stringify(body) } : {})
	});
	const data = await res.json().catch(() => null);
	return { status: res.status, data };
}

// ─── User Lifecycle ────────────────────────────────────────────────────────────

export interface TestUser {
	name: string;
	password: string;
	roles: string[];
	display_name?: string;
}

/**
 * Create a user in CouchDB _users (upsert — delete first if exists).
 * This handles leftover users from previously crashed test runs.
 */
export async function createCouchUser(user: TestUser): Promise<void> {
	// Delete first in case a previous run crashed before cleanup
	await deleteCouchUser(user.name);
	const { name, password, roles, display_name } = user;
	const res = await couchReq('PUT', `/_users/${USER_PREFIX}${encodeURIComponent(name)}`, {
		name,
		password,
		roles,
		display_name: display_name ?? name,
		type: 'user',
		shelter_id: roles.find((r) => r.startsWith('shelter:'))?.slice('shelter:'.length) ?? null,
		affiliation_tags: []
	});
	if (res.status >= 400) throw new Error(`Could not create test user "${name}" (HTTP ${res.status})`);
}

/** Delete a user from CouchDB _users. Silently ignores 404 (already gone). */
export async function deleteCouchUser(name: string): Promise<void> {
	const got = await couchReq('GET', `/_users/${USER_PREFIX}${encodeURIComponent(name)}`);
	if (got.status === 404) return; // already cleaned up
	if (got.status >= 400)
		throw new Error(`Could not fetch user "${name}" for deletion (HTTP ${got.status})`);
	const doc = got.data as { _rev: string };
	const del = await couchReq(
		'DELETE',
		`/_users/${USER_PREFIX}${encodeURIComponent(name)}?rev=${doc._rev}`
	);
	if (del.status >= 400 && del.status !== 404)
		throw new Error(`Could not delete user "${name}" (HTTP ${del.status})`);
}

/**
 * Login to CouchDB and return the `AuthSession` cookie value.
 * The SvelteKit BFF reads this cookie from the incoming request to resolve the caller.
 */
export async function couchLogin(name: string, password: string): Promise<string> {
	const res = await fetch(`${COUCH_BASE}/_session`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
		body: JSON.stringify({ name, password })
	});
	if (!res.ok) throw new Error(`CouchDB login failed for "${name}" (HTTP ${res.status})`);
	// Extract the AuthSession value from Set-Cookie header
	const setCookie = res.headers.get('set-cookie') ?? '';
	const match = setCookie.match(/AuthSession=([^;]+)/);
	if (!match) throw new Error(`No AuthSession cookie returned for "${name}"`);
	return match[1];
}

// ─── Pre-built role sets ───────────────────────────────────────────────────────

/** Roles for a System Admin user. */
export const SA_ROLES = ['system_admin'];

/** Roles for a Shelter Manager of SH001. */
export const SM_SH001_ROLES = ['shelter:SH001', 'shelter_manager'];

/** Roles for a Shelter Manager of SH002. */
export const SM_SH002_ROLES = ['shelter:SH002', 'shelter_manager'];

/** Roles for a Registration Staff member of SH001. */
export const STAFF_SH001_ROLES = ['shelter:SH001', 'registration_staff'];
