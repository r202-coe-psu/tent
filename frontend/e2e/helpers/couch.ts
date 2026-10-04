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

import type { Page } from '@playwright/test';
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

/** CouchDB server-admin credentials from `COUCHDB_ADMIN_URL` (never mintable via the app). */
export function couchBootstrapAdmin(): { name: string; password: string } {
	const m = COUCH_URL.match(/^(https?:\/\/)([^:]+):([^@]+)@(.+)$/);
	if (!m) throw new Error(`Invalid COUCHDB_ADMIN_URL: ${COUCH_URL}`);
	return { name: decodeURIComponent(m[2]), password: decodeURIComponent(m[3]) };
}

export async function couchReq(
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
	if (res.status >= 400)
		throw new Error(`Could not create test user "${name}" (HTTP ${res.status})`);
}

/** Test users require this setup to avoid the ordinary first-login gate. */
export async function seedSecurityQuestion(name: string): Promise<void> {
	const path = `/_users/${USER_PREFIX}${encodeURIComponent(name)}`;
	const got = await couchReq('GET', path);
	if (got.status >= 400 || !got.data || typeof got.data !== 'object') {
		throw new Error(`Could not load E2E user ${name} for setup`);
	}
	const res = await couchReq('PUT', path, {
		...(got.data as Record<string, unknown>),
		security_question: {
			question_id: 'high_school',
			answer_hash: 'e2e'.padEnd(64, '0'),
			salt: 'e2e'.padEnd(32, '0'),
			set_at: new Date().toISOString()
		},
		must_change_password: false
	});
	if (res.status >= 400) throw new Error(`Could not finish E2E user setup for ${name}`);
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

/**
 * A freshly minted user has no `security_question`, and the post-login gate sends
 * anyone in that state to `/force-setup` before any back-office route renders. Seed
 * one so tests exercise the page under test and not the onboarding wizard.
 */
export async function seedSecurityQuestion(name: string): Promise<void> {
	const path = `/_users/org.couchdb.user:${encodeURIComponent(name)}`;
	const got = await couchReq('GET', path);
	const doc = got.data as Record<string, unknown>;
	const res = await couchReq('PUT', path, {
		...doc,
		security_question: {
			question_id: 'high_school',
			answer_hash: 'e2e'.padEnd(64, '0'),
			salt: 'e2e'.padEnd(32, '0'),
			set_at: new Date().toISOString()
		},
		must_change_password: false
	});
	if (res.status >= 400) {
		throw new Error(`Could not seed security question for "${name}" (HTTP ${res.status})`);
	}
}

/** Roles for a System Admin user. */
export const SA_ROLES = ['system_admin'];

/** Roles for a Shelter Manager of SH001. */
export const SM_SH001_ROLES = ['shelter:SH001', 'shelter_manager'];

/** Roles for a Shelter Manager of SH002. */
export const SM_SH002_ROLES = ['shelter:SH002', 'shelter_manager'];

/** Roles for a Registration Staff member of SH001. */
export const STAFF_SH001_ROLES = ['shelter:SH001', 'registration_staff'];

// ─── App proxy ─────────────────────────────────────────────────────────────────

/** Base URL of the previewed app; keep in sync with `playwright.config.ts`. */
export const APP_BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL ?? 'http://localhost:4173';

/**
 * Route browser requests aimed at CouchDB through the application's /couch proxy,
 * adding CORS headers so cookie-authenticated requests succeed when the test build
 * leaves PUBLIC_COUCH_PROXY empty.
 */
export async function routeBrowserCouchThroughApp(page: Page): Promise<void> {
	await page.route(`${COUCH_BASE}/**`, async (route) => {
		const request = route.request();
		const origin = new URL(request.url());
		const allowOrigin = new URL(APP_BASE_URL).origin;
		const corsHeaders = {
			'access-control-allow-origin': allowOrigin,
			'access-control-allow-credentials': 'true',
			'access-control-allow-methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
			'access-control-allow-headers':
				request.headers()['access-control-request-headers'] ?? 'Content-Type, Accept',
			'access-control-expose-headers': 'ETag, Location, Content-Type'
		};

		if (request.method() === 'OPTIONS') {
			await route.fulfill({ status: 204, headers: corsHeaders });
			return;
		}

		const response = await route.fetch({
			url: `${APP_BASE_URL}/couch${origin.pathname}${origin.search}`
		});
		await route.fulfill({
			response,
			headers: { ...response.headers(), ...corsHeaders }
		});
	});
}

// ─── Document access ───────────────────────────────────────────────────────────

export type CouchDocument = Record<string, unknown> & { _id: string; _rev?: string };

export async function getDocument(db: string, id: string): Promise<CouchDocument | null> {
	const res = await couchReq('GET', `/${db}/${encodeURIComponent(id)}`);
	if (res.status === 404) return null;
	if (res.status >= 400 || !res.data || typeof res.data !== 'object') {
		throw new Error(`Could not read ${id} from ${db} (HTTP ${res.status})`);
	}
	return res.data as CouchDocument;
}

export async function putDocument(db: string, doc: CouchDocument): Promise<void> {
	const res = await couchReq('PUT', `/${db}/${encodeURIComponent(doc._id)}`, doc);
	if (res.status >= 400) {
		throw new Error(`Could not seed ${doc._id} in ${db} (HTTP ${res.status})`);
	}
}

export async function allDocuments(db: string): Promise<CouchDocument[]> {
	const res = await couchReq('GET', `/${db}/_all_docs?include_docs=true`);
	if (res.status >= 400 || !res.data || typeof res.data !== 'object') {
		throw new Error(`Could not list ${db} during E2E setup/cleanup`);
	}
	const rows = (res.data as { rows?: Array<{ doc?: CouchDocument }> }).rows ?? [];
	return rows.flatMap((row) => (row.doc ? [row.doc] : []));
}

export async function deleteDocument(db: string, doc: CouchDocument): Promise<void> {
	const rev = doc._rev;
	if (typeof rev !== 'string') return;
	const res = await couchReq(
		'DELETE',
		`/${db}/${encodeURIComponent(doc._id)}?rev=${encodeURIComponent(rev)}`
	);
	if (res.status >= 400 && res.status !== 404) {
		throw new Error(`Could not remove E2E document ${doc._id} (HTTP ${res.status})`);
	}
}
