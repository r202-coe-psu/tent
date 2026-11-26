import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Load `tests/.env`, then `frontend/.env` for anything still unset (most developers already
 * have `COUCHDB_ADMIN_URL` there). Neither file overrides a variable set in the shell or CI.
 */
export function loadEnv(): void {
	for (const file of [resolve(ROOT, '.env'), resolve(ROOT, '../frontend/.env')]) {
		if (existsSync(file)) process.loadEnvFile(file);
	}
}

export interface CouchTarget {
	/** Origin without credentials, e.g. `http://localhost:5984`. */
	base: string;
	/** `Authorization` header value for the server admin. */
	adminAuth: string;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * The CouchDB these tests write to. Refuses a non-local host unless `ALLOW_REMOTE_WRITES`
 * is exactly `true` (same opt-in as frontend/e2e), so a stray production URL cannot be hit.
 */
export function couchTarget(): CouchTarget {
	const raw = process.env.COUCHDB_ADMIN_URL;
	if (!raw) throw new Error('COUCHDB_ADMIN_URL is not set (see tests/.env.example)');
	const url = new URL(raw);
	if (!LOCAL_HOSTS.has(url.hostname) && process.env.ALLOW_REMOTE_WRITES?.trim() !== 'true') {
		throw new Error(
			`Refusing to write to ${url.host}: set ALLOW_REMOTE_WRITES=true for a staging target`
		);
	}
	const user = decodeURIComponent(url.username);
	const password = decodeURIComponent(url.password);
	url.username = '';
	url.password = '';
	return {
		base: url.toString().replace(/\/$/, ''),
		adminAuth: 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64')
	};
}

/** Shelter codes of the two seeded shelters the permission suites use. */
export function shelterCodes(): { a: string; b: string } {
	return {
		a: process.env.TENT_SHELTER_A?.trim() || 'SH001',
		b: process.env.TENT_SHELTER_B?.trim() || 'SH002'
	};
}
