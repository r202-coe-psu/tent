/**
 * Minimal CouchDB client for permission tests: the admin sets up and cleans up, while
 * every assertion is made with the test account's own `AuthSession` cookie — the same
 * credential the browser sends through `/couch`. Nothing here goes through the app, so a
 * result shows what CouchDB itself (`_security` + `validate_doc_update`) enforces.
 */
import { randomBytes } from 'node:crypto';
import { couchTarget } from './env.ts';

export type CouchDoc = Record<string, unknown> & { _id: string; _rev?: string };

export interface CouchResult<T = unknown> {
	status: number;
	body: T;
}

async function send<T>(
	path: string,
	init: { method: string; auth?: string; cookie?: string; body?: unknown }
): Promise<CouchResult<T>> {
	const { base } = couchTarget();
	const headers: Record<string, string> = { Accept: 'application/json' };
	if (init.auth) headers.Authorization = init.auth;
	if (init.cookie) headers.Cookie = `AuthSession=${init.cookie}`;
	if (init.body !== undefined) headers['Content-Type'] = 'application/json';
	const res = await fetch(`${base}${path}`, {
		method: init.method,
		headers,
		body: init.body === undefined ? undefined : JSON.stringify(init.body)
	});
	const body = (await res.json().catch(() => null)) as T;
	return { status: res.status, body };
}

/** Request as the CouchDB server admin (setup and cleanup only). */
export function asAdmin<T = unknown>(method: string, path: string, body?: unknown) {
	return send<T>(path, { method, auth: couchTarget().adminAuth, body });
}

/** Request as a logged-in account, using its `AuthSession` cookie. */
export function asSession<T = unknown>(
	session: string,
	method: string,
	path: string,
	body?: unknown
) {
	return send<T>(path, { method, cookie: session, body });
}

export function shelterDb(code: string): string {
	return `shelter_${code.toLowerCase()}`;
}

/** True when `db` exists — the suites need the seeded shelters (`pnpm seed` in frontend/). */
export async function dbExists(db: string): Promise<boolean> {
	return (await asAdmin('GET', `/${db}`)).status === 200;
}

// ─── Accounts ───────────────────────────────────────────────────────────────────

export interface TestAccount {
	name: string;
	/** Random per account; used to sign in through the login form. */
	password: string;
	roles: string[];
	session: string;
}

const USER_PREFIX = 'org.couchdb.user:';

/**
 * Create (or replace) a `_users` account and log it in. With `firstLoginDone`, the account
 * already has a security question, no forced password change and the staff consent, so
 * signing in through the UI lands on `/portal` instead of `/force-setup` or `/consent`.
 */
export async function createAccount(
	name: string,
	roles: string[],
	{ displayName = name, firstLoginDone = false } = {}
): Promise<TestAccount> {
	await deleteAccount(name);
	const password = randomBytes(18).toString('base64url');
	const put = await asAdmin('PUT', `/_users/${USER_PREFIX}${encodeURIComponent(name)}`, {
		name,
		password,
		roles,
		type: 'user',
		display_name: displayName,
		shelter_id: roles.find((r) => r.startsWith('shelter:'))?.slice('shelter:'.length) ?? null,
		affiliation_tags: [],
		...(firstLoginDone
			? {
					// Same shape frontend/e2e seeds (helpers/couch.ts seedSecurityQuestion).
					security_question: {
						question_id: 'high_school',
						answer_hash: 'permtest'.padEnd(64, '0'),
						salt: 'permtest'.padEnd(32, '0'),
						set_at: new Date().toISOString()
					},
					must_change_password: false,
					// Staff data-use consent (src/lib/features/users/domain/consent.ts).
					consent: { agreed: true, agreed_at: new Date().toISOString(), version: '1.0' }
				}
			: {})
	});
	if (put.status >= 300) throw new Error(`Could not create account ${name} (HTTP ${put.status})`);
	return { name, password, roles, session: await login(name, password) };
}

async function login(name: string, password: string): Promise<string> {
	const { base } = couchTarget();
	const res = await fetch(`${base}/_session`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
		body: JSON.stringify({ name, password })
	});
	const cookie = res.headers.get('set-cookie')?.match(/AuthSession=([^;]+)/)?.[1];
	if (!res.ok || !cookie) throw new Error(`Login failed for ${name} (HTTP ${res.status})`);
	return cookie;
}

export async function deleteAccount(name: string): Promise<void> {
	const path = `/_users/${USER_PREFIX}${encodeURIComponent(name)}`;
	const got = await asAdmin<{ _rev: string }>('GET', path);
	if (got.status === 404) return;
	if (got.status !== 200) throw new Error(`Could not read account ${name} (HTTP ${got.status})`);
	const del = await asAdmin('DELETE', `${path}?rev=${got.body._rev}`);
	if (del.status >= 300 && del.status !== 404) {
		throw new Error(`Could not delete account ${name} (HTTP ${del.status})`);
	}
}

// ─── Documents ──────────────────────────────────────────────────────────────────

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A ULID-shaped id (26 Crockford base32 chars), unique enough for throwaway docs. */
export function fakeUlid(): string {
	return Array.from(randomBytes(26), (b) => CROCKFORD[b % 32]).join('');
}

/**
 * Remove docs for good. `_purge` skips `validate_doc_update`, so append-only types
 * (screening, movement) can be cleaned up too, and it leaves no tombstone behind.
 */
export async function purgeDocs(db: string, ids: readonly string[]): Promise<void> {
	if (ids.length === 0) return;
	const revs: Record<string, string[]> = {};
	for (const id of ids) {
		const got = await asAdmin<{ _rev: string }>('GET', `/${db}/${encodeURIComponent(id)}`);
		if (got.status === 200) revs[id] = [got.body._rev];
	}
	if (Object.keys(revs).length === 0) return;
	const res = await asAdmin('POST', `/${db}/_purge`, revs);
	if (res.status >= 300)
		throw new Error(`Could not purge test docs from ${db} (HTTP ${res.status})`);
}
