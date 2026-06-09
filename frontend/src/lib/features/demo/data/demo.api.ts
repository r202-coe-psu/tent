import { couchFetch } from '$lib/db/couch';
import {
	DEMO_DBS,
	DEMO_USERS,
	DB_META,
	type DemoDb,
	type SetupStep,
	type DbVerifyResult,
	type UserVerifyResult,
	type VerifyResult
} from './demo.constants';

// Re-export pure metadata so existing imports from this module keep working.
export { DEMO_DBS, DEMO_USERS, DB_META };
export type { DemoDb, SetupStep, DbVerifyResult, UserVerifyResult };

// ------------------------------------------------------------------ admin ops
//
// All privileged setup/teardown/verify work runs on the server endpoint
// (/api/admin/demo), which holds the admin credentials. The browser only
// triggers it with its session cookie — the admin password never reaches the
// client bundle.

async function demoAction<T>(action: 'setup' | 'teardown' | 'verify'): Promise<T> {
	const res = await fetch('/api/admin/demo', {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action })
	});
	const data = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
	if (!res.ok) {
		throw new Error((data as { message?: string } | null)?.message ?? `Demo ${action} failed (${res.status})`);
	}
	return data as T;
}

export function setupDemo(): Promise<SetupStep[]> {
	return demoAction<SetupStep[]>('setup');
}

export function teardownDemo(): Promise<SetupStep[]> {
	return demoAction<SetupStep[]>('teardown');
}

export function verifySetup(): Promise<VerifyResult> {
	return demoAction<VerifyResult>('verify');
}

// ------------------------------------------------------------------ session

/** Live session from CouchDB (not cached authStore) — shows real roles after login. */
export async function getLiveSession(): Promise<{ name: string | null; roles: string[] }> {
	const res = await couchFetch<{ userCtx: { name: string | null; roles: string[] } }>('/_session');
	return res.userCtx;
}

// ------------------------------------------------------------------ access tests

export interface AccessResult {
	canRead:    boolean;
	canWrite:   boolean;
	readError?: string;
	writeError?: string;
	loading:    boolean;
}

export async function testDbAccess(db: string): Promise<Omit<AccessResult, 'loading'>> {
	// test read
	let canRead = false;
	let readError: string | undefined;
	try {
		await couchFetch(`/${db}/_all_docs?limit=0`);
		canRead = true;
	} catch (e) {
		readError = (e as Error).message;
	}

	// test write (use couchFetch so it uses the current session cookie)
	let canWrite = false;
	let writeError: string | undefined;
	const testId = `rbacdemo_${Date.now()}`;
	try {
		await couchFetch<{ rev: string }>(`/${db}/${testId}`, {
			method: 'PUT',
			body: JSON.stringify({ type: '_demo_test', ts: Date.now() })
		});
		canWrite = true;
		// cleanup — best effort
		try {
			const doc = await couchFetch<{ _rev: string }>(`/${db}/${testId}`);
			await couchFetch(`/${db}/${testId}?rev=${doc._rev}`, { method: 'DELETE' });
		} catch { /* ignore */ }
	} catch (e) {
		writeError = (e as Error).message;
	}

	return { canRead, canWrite, readError, writeError };
}

export async function testSharedWrite(team: 'alpha' | 'beta'): Promise<{ ok: boolean; error?: string }> {
	const testId = `rbacdemo_shared_${team}_${Date.now()}`;
	try {
		await couchFetch<{ rev: string }>(`/demo_shared/${testId}`, {
			method: 'PUT',
			body: JSON.stringify({ type: '_demo_test', team, ts: Date.now() })
		});
		// cleanup
		try {
			const doc = await couchFetch<{ _rev: string }>(`/demo_shared/${testId}`);
			await couchFetch(`/demo_shared/${testId}?rev=${doc._rev}`, { method: 'DELETE' });
		} catch { /* ignore */ }
		return { ok: true };
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}
