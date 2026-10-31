/**
 * One-off, re-runnable backfill of `_users.staff_token_hash` for staff accounts created before
 * the staff card existed (implementation-plan-staff-qr.md, Phase 2d).
 *
 * Usage (from frontend/):
 *   pnpm backfill:staff-card-token --dry-run            # counts + names only, writes nothing (default)
 *   pnpm backfill:staff-card-token --write --confirm    # apply
 *
 * Needs: COUCHDB_ADMIN_URL in the environment or frontend/.env
 * Optional: COUCHDB_PUBLIC_WRITER_URL, so the public writer service account is never minted a card.
 *
 * Every `_users` doc without `volunteer_id` and without a valid `staff_token_hash` gets a fresh
 * hash. Only `staff_token_hash` is set, the plaintext token is discarded and neither is logged.
 * Skips design docs, volunteers, the service account and docs that already have a hash, so a
 * second run mints 0. A write conflict is re-read and retried once; what still conflicts is
 * reported and the script exits non-zero.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { isValidStaffTokenHash } from '$lib/features/users/server';
import { parseCouchCredentialUrl } from '$lib/server/couch-credentials';
import { planStaffCardBackfill, type StaffCardBackfillDoc } from '$lib/server/staff-card-backfill';
import { mintStaffTokenHash } from '$lib/server/staff-card-token';

function loadEnv(): Record<string, string> {
	const envPath = resolve(process.cwd(), '.env');
	if (!existsSync(envPath)) return {};
	const text = readFileSync(envPath, 'utf-8');
	return Object.fromEntries(
		text
			.split('\n')
			.map((l) => l.trim())
			.filter((l) => l && !l.startsWith('#') && l.includes('='))
			.map((l) => {
				const eq = l.indexOf('=');
				const k = l.slice(0, eq).trim();
				const v = l
					.slice(eq + 1)
					.trim()
					.replace(/^['"]|['"]$/g, '');
				return [k, v];
			})
	);
}

const env = loadEnv();
const rawCouchUrl = process.env.COUCHDB_ADMIN_URL ?? env.COUCHDB_ADMIN_URL;

if (!rawCouchUrl) {
	console.error('✗ COUCHDB_ADMIN_URL is not set');
	console.error('  Set it in the environment or frontend/.env');
	console.error('  Format: http://admin:<password>@<host>:<port>');
	process.exit(1);
}

function parseCouchUrl(raw: string): { baseUrl: string; authHeader: string } {
	const url = new URL(raw);
	const authHeader =
		url.username || url.password
			? `Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64')}`
			: '';
	url.username = '';
	url.password = '';
	return { baseUrl: url.toString().replace(/\/$/, ''), authHeader };
}

const { baseUrl: COUCH_URL, authHeader: COUCH_AUTH } = parseCouchUrl(rawCouchUrl);

const WRITE = process.argv.includes('--write');
const CONFIRMED = process.argv.includes('--confirm');
const DRY_RUN = !WRITE;

if (WRITE && process.argv.includes('--dry-run')) {
	console.error('✗ --dry-run and --write cannot be combined');
	process.exit(1);
}
if (WRITE && !CONFIRMED) {
	console.error('✗ --write requires --confirm (a typo could write to production)');
	console.error('  Re-run with: pnpm backfill:staff-card-token --write --confirm');
	process.exit(1);
}

async function couchReq(
	method: string,
	path: string,
	body?: unknown
): Promise<{ status: number; data: unknown }> {
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		Accept: 'application/json'
	};
	if (COUCH_AUTH) headers['Authorization'] = COUCH_AUTH;
	const res = await fetch(`${COUCH_URL}${path}`, {
		method,
		headers,
		...(body !== undefined ? { body: JSON.stringify(body) } : {})
	});
	const data = res.status === 204 ? null : await res.json().catch(() => null);
	return { status: res.status, data };
}

function failure(res: { status: number; data: unknown }): string {
	const detail = (res.data as { reason?: string; error?: string } | null) ?? {};
	return `${res.status} ${detail.reason ?? detail.error ?? 'unknown'}`;
}

type UserDoc = StaffCardBackfillDoc & Record<string, unknown>;

async function listUserDocs(): Promise<UserDoc[]> {
	const res = await couchReq('GET', '/_users/_all_docs?include_docs=true');
	if (res.status >= 400) throw new Error(`could not list _users (${failure(res)})`);
	const rows = (res.data as { rows?: { doc?: UserDoc }[] } | null)?.rows ?? [];
	return rows.flatMap((row) => (row.doc ? [row.doc] : []));
}

type MintOutcome = 'minted' | 'skipped' | 'conflict';

async function mintOnce(id: string): Promise<MintOutcome> {
	const path = `/_users/${encodeURIComponent(id)}`;
	const fresh = await couchReq('GET', path);
	if (fresh.status >= 400) throw new Error(`read ${id} failed (${failure(fresh)})`);
	const doc = fresh.data as UserDoc;
	if (doc.volunteer_id || isValidStaffTokenHash(doc.staff_token_hash)) return 'skipped';
	const put = await couchReq('PUT', path, {
		...doc,
		staff_token_hash: await mintStaffTokenHash()
	});
	if (put.status === 409) return 'conflict';
	if (put.status >= 400) throw new Error(`write ${id} failed (${failure(put)})`);
	return 'minted';
}

async function mintWithRetry(id: string): Promise<MintOutcome> {
	const first = await mintOnce(id);
	return first === 'conflict' ? mintOnce(id) : first;
}

function userName(id: string, docs: readonly UserDoc[]): string {
	const name = docs.find((d) => d._id === id)?.name;
	return typeof name === 'string' ? name : id;
}

async function main(): Promise<void> {
	console.log('🔄 Backfill _users.staff_token_hash (staff QR card)');
	console.log(`   COUCH: ${COUCH_URL}`);
	console.log(`   mode: ${DRY_RUN ? 'DRY-RUN (pass --write --confirm to apply)' : 'WRITE'}`);
	console.log('');

	const writer = parseCouchCredentialUrl(
		process.env.COUCHDB_PUBLIC_WRITER_URL ?? env.COUCHDB_PUBLIC_WRITER_URL
	);
	const serviceNames = writer ? [writer.user] : [];

	const docs = await listUserDocs();
	const plan = planStaffCardBackfill(docs, { serviceNames });

	console.log(`📋 Scanned ${docs.length} _users doc(s)`);
	console.log(`    ${DRY_RUN ? 'would mint' : 'to mint'}:          ${plan.mint.length}`);
	console.log(`    skipped (has hash):   ${plan.skipped.has_hash}`);
	console.log(`    skipped (volunteer):  ${plan.skipped.volunteer}`);
	console.log(`    skipped (service):    ${plan.skipped.service}`);
	console.log(`    skipped (design):     ${plan.skipped.design}`);

	if (DRY_RUN) {
		for (const id of plan.mint) console.log(`    · ${userName(id, docs)}`);
		return;
	}

	let minted = 0;
	let skippedFresh = 0;
	const conflicts: string[] = [];
	const failed: string[] = [];
	for (const id of plan.mint) {
		try {
			const outcome = await mintWithRetry(id);
			if (outcome === 'minted') minted++;
			else if (outcome === 'skipped') skippedFresh++;
			else conflicts.push(id);
		} catch (error) {
			failed.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	console.log('');
	console.log('📊 Result');
	console.log(`    minted:               ${minted}`);
	console.log(`    skipped (changed):    ${skippedFresh}`);
	console.log(`    conflicts:            ${conflicts.length}`);
	if (failed.length > 0) console.log(`    failed:               ${failed.length}`);
	for (const id of conflicts) console.error(`    ✗ conflict after retry: ${id}`);
	for (const line of failed) console.error(`    ✗ write failed: ${line}`);
	if (conflicts.length > 0 || failed.length > 0) process.exit(1);
}

main().catch((e) => {
	console.error('✗ Unexpected error:', e);
	process.exit(1);
});
