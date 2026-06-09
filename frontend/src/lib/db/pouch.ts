import { browser } from '$app/environment';
import PouchDB from 'pouchdb-browser';
import { COUCH_URL } from './couch';

let db: PouchDB.Database | null = null;
let syncHandler: PouchDB.Replication.Sync<object> | null = null;

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

function getDb(): PouchDB.Database {
	if (!db) {
		db = new PouchDB('notes');
	}
	return db;
}

/**
 * PouchDB remote instance with cookieFetch baked into the constructor.
 * PouchDB's HTTP adapter reads `fetch` from the DB options, not from
 * per-operation options — passing it here is the reliable path.
 */
function getRemoteDb(): PouchDB.Database {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return new PouchDB(buildRemoteUrl('/notes'), { fetch: cookieFetch } as any);
}

/**
 * Begin live, retrying sync to the remote using cookie auth. Idempotent —
 * if a live sync is already running this is a no-op.
 *
 * Network errors are handled by PouchDB's own retry loop (sync resumes when
 * connectivity returns). An auth failure (401/403) is different: the session
 * cookie has expired, so we stop syncing and hand control to `onAuthError`,
 * letting the app prompt for re-authentication WITHOUT logging the user out of
 * the local-only experience.
 */
export function startSync(onAuthError?: (status: number) => void): void {
	if (!browser) return;
	if (syncHandler) return;

	syncHandler = getDb().sync(getRemoteDb(), { live: true, retry: true });

	syncHandler.on('error', (err) => {
		const status = (err as { status?: number })?.status;
		if (status === 401 || status === 403) {
			stopSync();
			onAuthError?.(status);
			return;
		}
		console.warn('[PouchDB] sync error', err);
	});
}

/** Cancel the live sync handler if one is running. */
export function stopSync(): void {
	if (syncHandler) {
		syncHandler.cancel();
		syncHandler = null;
	}
}

/** One-shot bidirectional sync — useful for manual "force sync" actions. */
export function forceSync(): Promise<void> {
	if (!browser) return Promise.resolve();
	return new Promise((resolve, reject) => {
		getDb()
			.sync(getRemoteDb())
			.on('complete', () => resolve())
			.on('error', reject);
	});
}

// Only instantiate in browser — SSR guard. Local-only usage (changes feed,
// allDocs, put, remove) works offline regardless of session state.
export const localDb = browser ? getDb() : (null as unknown as PouchDB.Database);

// ---------------------------------------------------------------- multi-db
//
// The shelter demo keeps one database per shelter (shelter_a / _b / _c). These
// helpers manage an arbitrary named local DB + its live sync, reusing the same
// cookie auth + 401 handling as the notes sync above.

const namedDbs = new Map<string, PouchDB.Database>();
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

/** Begin live, retrying sync for a named database. Idempotent per name. */
export function startNamedSync(name: string, onAuthError?: (status: number) => void): void {
	if (!browser) return;
	if (namedSyncs.has(name)) return;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const remote = new PouchDB(buildRemoteUrl(`/${name}`), { fetch: cookieFetch } as any);
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
