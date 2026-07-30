/**
 * One-off referral hardening cleanup.
 *
 * Usage (from frontend/):
 *   pnpm cleanup:referral-hardening           # dry-run
 *   pnpm cleanup:referral-hardening --apply   # repair documents
 *
 * Repairs:
 * - sent referrals with invalid `to_shelter_code` are administratively closed.
 * - sent referrals with a valid destination but missing destination peer are mirrored.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { shelterCodeSchema } from '$lib/db/model';
import { shelterDbName } from '$lib/server/shelter-access-design';

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
	console.error('✗ COUCHDB_ADMIN_URL is not set in frontend/.env');
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
const APPLY = process.argv.includes('--apply');
const CLEANUP_ACTOR = 'cleanup-referral-hardening';
const CLEANUP_REASON = 'closed by cleanup: invalid destination';

interface CouchResponse {
	status: number;
	data: unknown;
}

interface ReferralDoc {
	_id: string;
	_rev?: string;
	type?: string;
	status?: string;
	referral_type?: string;
	shelter_code?: string;
	to_shelter_code?: unknown;
	timeline?: {
		sent?: { at: string; by: string };
		responded?: { at: string; by: string };
		closed?: { at: string; by: string };
	};
	updated_at?: string;
	response_reason?: string;
	notes?: string;
	[key: string]: unknown;
}

async function couchReq(method: string, path: string, body?: unknown): Promise<CouchResponse> {
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
	const data = await res.json().catch(() => null);
	return { status: res.status, data };
}

async function listRegistryShelterCodes(): Promise<string[]> {
	const res = await couchReq('GET', '/registry/_all_docs?include_docs=true');
	if (res.status === 404) return [];
	if (res.status >= 400) {
		const detail = (res.data as { reason?: string; error?: string } | null) ?? {};
		throw new Error(
			`Could not read registry (${res.status}): ${detail.reason ?? detail.error ?? 'unknown'}`
		);
	}
	const rows =
		(res.data as { rows?: { id?: string; doc?: { type?: string; code?: unknown } }[] })?.rows ?? [];
	const codes = new Set<string>();
	for (const row of rows) {
		if (!row.id?.startsWith('shelter:') || row.doc?.type !== 'shelter') continue;
		const parsed = shelterCodeSchema.safeParse(row.doc.code);
		if (parsed.success) codes.add(parsed.data);
	}
	return [...codes].sort();
}

async function listReferralDocs(db: string): Promise<ReferralDoc[]> {
	const res = await couchReq('GET', `/${db}/_all_docs?include_docs=true`);
	if (res.status === 404) return [];
	if (res.status >= 400) {
		const detail = (res.data as { reason?: string; error?: string } | null) ?? {};
		throw new Error(
			`Could not scan ${db} (${res.status}): ${detail.reason ?? detail.error ?? 'unknown'}`
		);
	}
	const rows = (res.data as { rows?: { doc?: ReferralDoc }[] })?.rows ?? [];
	return rows.map((r) => r.doc).filter((doc): doc is ReferralDoc => doc?.type === 'referral');
}

async function dbExists(db: string): Promise<boolean> {
	const res = await couchReq('HEAD', `/${db}`);
	return res.status === 200;
}

async function getDoc(db: string, id: string): Promise<ReferralDoc | null> {
	const res = await couchReq('GET', `/${db}/${encodeURIComponent(id)}`);
	if (res.status === 404) return null;
	if (res.status >= 400) {
		const detail = (res.data as { reason?: string; error?: string } | null) ?? {};
		throw new Error(
			`Could not read ${id} from ${db} (${res.status}): ${detail.reason ?? detail.error ?? 'unknown'}`
		);
	}
	return res.data as ReferralDoc;
}

async function putDoc(db: string, doc: ReferralDoc): Promise<void> {
	const res = await couchReq('PUT', `/${db}/${encodeURIComponent(doc._id)}`, doc);
	if (res.status !== 200 && res.status !== 201) {
		const detail = (res.data as { reason?: string; error?: string } | null) ?? {};
		throw new Error(
			`Could not write ${doc._id} to ${db} (${res.status}): ${detail.reason ?? detail.error ?? 'unknown'}`
		);
	}
}

function closeInvalidDestination(doc: ReferralDoc, nowIso: string): ReferralDoc {
	return {
		...doc,
		status: 'closed',
		timeline: {
			...(doc.timeline ?? {}),
			closed: { at: nowIso, by: CLEANUP_ACTOR }
		},
		response_reason: CLEANUP_REASON,
		updated_at: nowIso
	};
}

function mirrorDoc(doc: ReferralDoc): ReferralDoc {
	const { _rev: _, ...withoutRev } = doc;
	void _;
	return withoutRev;
}

async function main() {
	console.log('Referral hardening cleanup');
	console.log(`mode: ${APPLY ? 'APPLY' : 'DRY-RUN (pass --apply to repair)'}`);
	console.log('');

	const shelterCodes = await listRegistryShelterCodes();
	if (shelterCodes.length === 0) {
		console.log('No shelter masters found in registry.');
		return;
	}

	let scanned = 0;
	let closedInvalid = 0;
	let mirroredMissing = 0;
	let skippedMissingDb = 0;

	for (const code of shelterCodes) {
		const sourceDb = shelterDbName(code);
		const docs = await listReferralDocs(sourceDb);
		scanned += docs.length;

		for (const doc of docs) {
			if (doc.status !== 'sent' || typeof doc.to_shelter_code !== 'string') continue;

			const parsedDestination = shelterCodeSchema.safeParse(doc.to_shelter_code);
			if (!parsedDestination.success) {
				console.log(
					`  ${APPLY ? 'closing' : 'would close'} invalid destination: ${sourceDb}/${doc._id}`
				);
				console.log(`    to_shelter_code=${JSON.stringify(doc.to_shelter_code)}`);
				if (APPLY) {
					await putDoc(sourceDb, closeInvalidDestination(doc, new Date().toISOString()));
				}
				closedInvalid++;
				continue;
			}

			const destinationDb = shelterDbName(parsedDestination.data);
			if (!(await dbExists(destinationDb))) {
				console.log(`  missing destination DB: ${destinationDb} for ${sourceDb}/${doc._id}`);
				skippedMissingDb++;
				continue;
			}

			const peer = await getDoc(destinationDb, doc._id);
			if (peer) continue;

			console.log(
				`  ${APPLY ? 'mirroring' : 'would mirror'} missing peer: ${sourceDb}/${doc._id} -> ${destinationDb}`
			);
			if (APPLY) {
				await putDoc(destinationDb, mirrorDoc(doc));
			}
			mirroredMissing++;
		}
	}

	console.log('');
	console.log(
		`Summary: scanned=${scanned} invalid_closed=${closedInvalid} missing_peer_mirrored=${mirroredMissing} missing_destination_db=${skippedMissingDb}`
	);
}

main().catch((e) => {
	console.error('Fatal:', e);
	process.exit(1);
});
