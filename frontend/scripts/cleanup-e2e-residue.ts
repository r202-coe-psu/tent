#!/usr/bin/env tsx
/**
 * Remove what aborted E2E runs left behind on a target (local or staging).
 *
 * A run's own teardown only deletes what its created-data ledger names. The ledger lives in
 * `node_modules/.cache`, which the staging runner's container throws away, so a run killed
 * before its afterAll (Jenkins timeout, aborted build) leaks for good. This sweeps by marker
 * instead of by ledger:
 *
 *   - shelters — registry masters whose name starts with `E2E` (the prefix every suite gives
 *     its own shelter; `teardownShelter` refuses anything else). Each is closed first (stamping
 *     `closed_at` like the app does), then — once the public projection reads it as no longer
 *     open — its master doc and `shelter_<code>` database are deleted. The worker cascades the
 *     master delete to the shelter's public persons and needs.
 *   - staff users — `_users` docs carrying the E2E security-question fingerprint
 *     (`seedSecurityQuestion` in e2e/helpers/couch.ts), or scoped to a shelter removed above.
 *     `E2E_USERNAME` / `E2E_ADMIN_USERNAME` (the provisioned, long-lived accounts) are never
 *     touched.
 *
 * Not covered: central-queue registrations (FastAPI, per-run surname marker) and FAQ entries.
 *
 * Usage (from frontend/):
 *   pnpm cleanup:e2e                                    (dry-run: list what would go)
 *   pnpm cleanup:e2e --confirm                          (delete)
 *   pnpm cleanup:e2e --confirm --base-url=https://shelter.importstar.dev
 *
 * `--base-url` (or `E2E_BASE_URL`) is the app whose public BFF is polled until the closed
 * shelters project as closed; without it the script waits `--wait=<seconds>` (default 30)
 * between closing and deleting. Point `COUCHDB_ADMIN_URL` at the target's CouchDB.
 */

import { nextClosedAt } from '$lib/features/shelters/domain/closed-at';
import { couchReq, displayCouchUrl, env } from './seed/couch';

/** Name prefix of every shelter an E2E suite creates (`E2E_SHELTER_PREFIX`). */
export const E2E_SHELTER_PREFIX = 'E2E';

/** `answer_hash` that `seedSecurityQuestion` gives every E2E staff user. */
export const E2E_ANSWER_HASH = 'e2e'.padEnd(64, '0');

const USER_PREFIX = 'org.couchdb.user:';
const PROJECTION_TIMEOUT_MS = 120_000;

export interface RegistryShelter {
	_id: string;
	_rev: string;
	code: string;
	name?: string;
	operation_status?: string | null;
	closed_at?: string | null;
	[key: string]: unknown;
}

export interface CouchUser {
	_id: string;
	_rev: string;
	name: string;
	roles?: string[];
	shelter_id?: string | null;
	security_question?: { answer_hash?: string };
}

export function isE2eShelter(doc: Pick<RegistryShelter, 'name'>): boolean {
	return String(doc.name ?? '').startsWith(E2E_SHELTER_PREFIX);
}

/**
 * A user created by an E2E run: the security-question fingerprint, or scoped only to a
 * shelter being removed. `keep` names are never selected.
 */
export function isE2eUser(user: CouchUser, e2eCodes: Set<string>, keep: Set<string>): boolean {
	if (keep.has(user.name)) return false;
	if (user.security_question?.answer_hash === E2E_ANSWER_HASH) return true;
	const scoped = (user.roles ?? [])
		.filter((r) => r.startsWith('shelter:'))
		.map((r) => r.slice('shelter:'.length));
	if (user.shelter_id) scoped.push(user.shelter_id);
	return scoped.length > 0 && scoped.every((code) => e2eCodes.has(code));
}

function flag(argv: string[], name: string): string | undefined {
	return argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function listE2eShelters(): Promise<RegistryShelter[]> {
	const res = await couchReq('GET', '/registry/_design/app/_view/by_code?include_docs=true');
	if (res.status >= 400) throw new Error(`registry by_code HTTP ${res.status}`);
	const rows = (res.data as { rows: { doc?: RegistryShelter }[] }).rows;
	return rows.flatMap((r) => (r.doc && isE2eShelter(r.doc) ? [r.doc] : []));
}

async function listE2eUsers(e2eCodes: Set<string>, keep: Set<string>): Promise<CouchUser[]> {
	const res = await couchReq('GET', '/_users/_all_docs?include_docs=true');
	if (res.status >= 400) throw new Error(`_users _all_docs HTTP ${res.status}`);
	const rows = (res.data as { rows: { id: string; doc?: CouchUser }[] }).rows;
	return rows.flatMap((r) =>
		r.id.startsWith(USER_PREFIX) && r.doc && isE2eUser(r.doc, e2eCodes, keep) ? [r.doc] : []
	);
}

async function closeShelter(doc: RegistryShelter): Promise<string> {
	const now = new Date().toISOString();
	const res = await couchReq('PUT', `/registry/${encodeURIComponent(doc._id)}`, {
		...doc,
		operation_status: 'closed',
		closed_at: nextClosedAt(doc.operation_status ?? null, 'closed', doc.closed_at, now),
		updated_at: now
	});
	if (res.status >= 400) throw new Error(`close ${doc.code} failed (HTTP ${res.status})`);
	return (res.data as { rev: string }).rev;
}

/** Wait until none of `codes` reads `open` on the public BFF (or `waitSec` without one). */
async function waitForClosedProjection(
	codes: string[],
	baseUrl: string | undefined,
	waitSec: number
) {
	if (!baseUrl) {
		console.log(`No --base-url: waiting ${waitSec}s for the worker to project the closes…`);
		await new Promise((r) => setTimeout(r, waitSec * 1000));
		return;
	}
	const url = `${baseUrl.replace(/\/$/, '')}/api/public/v1/shelters`;
	const deadline = Date.now() + PROJECTION_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const res = await fetch(url).catch(() => null);
		if (res?.ok) {
			const { shelters } = (await res.json()) as { shelters: { code: string; status: string }[] };
			const open = shelters.filter((s) => codes.includes(s.code) && s.status === 'open');
			if (open.length === 0) return;
		}
		await new Promise((r) => setTimeout(r, 3_000));
	}
	throw new Error(
		`Shelters still project as open after ${PROJECTION_TIMEOUT_MS / 1000}s — is the sync worker running?`
	);
}

async function main() {
	const argv = process.argv.slice(2);
	const confirm = argv.includes('--confirm');
	const baseUrl = flag(argv, 'base-url') ?? process.env.E2E_BASE_URL ?? env.E2E_BASE_URL;
	const waitSec = Number(flag(argv, 'wait') ?? 30);
	const keep = new Set(
		[
			process.env.E2E_USERNAME ?? env.E2E_USERNAME,
			process.env.E2E_ADMIN_USERNAME ?? env.E2E_ADMIN_USERNAME
		].filter((n): n is string => Boolean(n))
	);

	console.log(
		`CouchDB: ${displayCouchUrl()}${confirm ? '' : '  (dry-run — pass --confirm to delete)'}`
	);

	const shelters = await listE2eShelters();
	const codes = new Set(shelters.map((s) => s.code));
	const users = await listE2eUsers(codes, keep);

	console.log(`\nE2E shelters (${shelters.length}):`);
	for (const s of shelters) console.log(`  ${s.code}  ${s.name}  [${s.operation_status ?? '-'}]`);
	console.log(`\nE2E staff users (${users.length}):`);
	for (const u of users) console.log(`  ${u.name}  ${(u.roles ?? []).join(',')}`);

	if (!confirm || (shelters.length === 0 && users.length === 0)) return;

	const revs = new Map<string, string>();
	for (const s of shelters) revs.set(s.code, await closeShelter(s));
	if (shelters.length > 0) await waitForClosedProjection([...codes], baseUrl, waitSec);

	let failed = 0;
	for (const s of shelters) {
		const del = await couchReq(
			'DELETE',
			`/registry/${encodeURIComponent(s._id)}?rev=${revs.get(s.code)}`
		);
		const db = await couchReq('DELETE', `/shelter_${s.code.toLowerCase()}`);
		const ok = (del.status < 400 || del.status === 404) && (db.status < 400 || db.status === 404);
		if (!ok) failed++;
		console.log(
			`${ok ? 'removed' : 'FAILED '} ${s.code} (master HTTP ${del.status}, db HTTP ${db.status})`
		);
	}
	for (const u of users) {
		const del = await couchReq('DELETE', `/_users/${encodeURIComponent(u._id)}?rev=${u._rev}`);
		const ok = del.status < 400 || del.status === 404;
		if (!ok) failed++;
		console.log(`${ok ? 'removed' : 'FAILED '} user ${u.name} (HTTP ${del.status})`);
	}
	if (failed > 0) {
		console.error(`\n${failed} deletion(s) failed — re-run to retry.`);
		process.exitCode = 1;
	}
}

if (process.argv[1]?.endsWith('cleanup-e2e-residue.ts')) {
	main().catch((err: unknown) => {
		console.error('\nE2E cleanup failed:', err);
		process.exit(1);
	});
}
