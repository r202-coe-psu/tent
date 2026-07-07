import { browser } from '$app/environment';
import PouchDB from 'pouchdb-browser';
import { COUCH_URL } from './couch';

// PouchDB requires an absolute URL. When COUCH_URL is a proxy path ("/couch"),
// resolve it against the current page origin at runtime.
function buildRemoteUrl(path: string): string {
	if (COUCH_URL.startsWith('/')) {
		return `${window.location.origin}${COUCH_URL}${path}`;
	}
	return `${COUCH_URL}${path}`;
}

/** Fetch that forwards the CouchDB `_session` cookie on every remote request. */
const cookieFetch: typeof fetch = (url, opts) => fetch(url, { ...opts, credentials: 'include' });

// ---------------------------------------------------------------- multi-db
//
// Generic helpers for managing an arbitrary named local DB + its live sync
// (e.g. one database per scope).

const namedDbs = new Map<string, PouchDB.Database>();
const namedRemoteDbs = new Map<string, PouchDB.Database>();
const namedSyncs = new Map<string, PouchDB.Replication.Sync<object>>();

/** Local PouchDB for a named database (offline-capable, no auth needed). */
export function namedLocalDb(name: string): PouchDB.Database {
	let db = namedDbs.get(name);
	if (!db) {
		db = new PouchDB(name);
		namedDbs.set(name, db);
	}
	return db;
}

/** Remote CouchDB handle for a named database — one instance per name. */
function namedRemoteDb(name: string): PouchDB.Database {
	let db = namedRemoteDbs.get(name);
	if (!db) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		db = new PouchDB(buildRemoteUrl(`/${name}`), { fetch: cookieFetch } as any);
		namedRemoteDbs.set(name, db);
	}
	return db;
}

/** Begin live, retrying sync for a named database. Idempotent per name. */
export function startNamedSync(name: string, onAuthError?: (status: number) => void): void {
	if (!browser) return;
	if (namedSyncs.has(name)) return;

	const remote = namedRemoteDb(name);
	const handler = namedLocalDb(name).sync(remote, { live: true, retry: true });

	handler.on('error', (err) => {
		const status = (err as { status?: number })?.status;
		if (status === 401 || status === 403) {
			stopNamedSync(name);
			onAuthError?.(status);
			return;
		}
		console.warn(`[PouchDB] sync error (${name})`, err);
	});

	namedSyncs.set(name, handler);
}

/** Cancel the live sync for a named database, if running. */
export function stopNamedSync(name: string): void {
	const handler = namedSyncs.get(name);
	if (handler) {
		handler.cancel();
		namedSyncs.delete(name);
	}
}

/** Cancel every named sync (e.g. on logout). */
export function stopAllNamedSync(): void {
	for (const name of [...namedSyncs.keys()]) stopNamedSync(name);
}
