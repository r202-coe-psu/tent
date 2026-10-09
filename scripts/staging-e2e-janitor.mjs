#!/usr/bin/env node
/**
 * Staging E2E janitor — delete leftover E2E fixtures older than N hours.
 *
 * Safety (frontend/e2e/README.md §4 + §9.C):
 *   - Only registry shelter docs whose **name starts with exactly `E2E`**
 *     (same prefix as helpers/public-cleanup.ts E2E_SHELTER_PREFIX).
 *   - Age gate: created_at (fallback updated_at) older than --max-age-hours.
 *   - Never fuzzy-search people / never touch SH001–SH004 / config:app.
 *   - Default mode is --dry-run (list only). Pass --execute to delete.
 *
 * Usage:
 *   COUCHDB_ADMIN_URL=http://admin:…@host:5984 \
 *     node scripts/staging-e2e-janitor.mjs [--dry-run|--execute] [--max-age-hours=6]
 *
 * Every candidate id/code/name/age is logged. Exit 0 even when nothing matches.
 */

import process from 'node:process';

const E2E_SHELTER_PREFIX = 'E2E';
const DEFAULT_MAX_AGE_HOURS = 6;

function usage(exitCode = 0) {
	const out = exitCode === 0 ? console.log : console.error;
	out(`Usage: node scripts/staging-e2e-janitor.mjs [options]

Options:
  --dry-run              List matching E2E shelters only (default)
  --execute              Close + delete matching shelters and their DBs
  --max-age-hours=N      Only touch docs older than N hours (default ${DEFAULT_MAX_AGE_HOURS})
  -h, --help             Show this help

Requires COUCHDB_ADMIN_URL (embedded credentials).`);
	process.exit(exitCode);
}

function parseArgs(argv) {
	let dryRun = true;
	let maxAgeHours = DEFAULT_MAX_AGE_HOURS;
	for (const arg of argv) {
		if (arg === '--dry-run') dryRun = true;
		else if (arg === '--execute') dryRun = false;
		else if (arg.startsWith('--max-age-hours=')) {
			const n = Number(arg.slice('--max-age-hours='.length));
			if (!Number.isFinite(n) || n <= 0) {
				console.error(`Invalid --max-age-hours value: ${arg}`);
				usage(2);
			}
			maxAgeHours = n;
		} else if (arg === '-h' || arg === '--help') usage(0);
		else {
			console.error(`Unknown argument: ${arg}`);
			usage(2);
		}
	}
	return { dryRun, maxAgeHours };
}

function parseCouchUrl(raw) {
	const m = raw.match(/^(https?:\/\/)([^:]+):([^@]+)@(.+)$/);
	if (!m) throw new Error(`Invalid COUCHDB_ADMIN_URL: ${raw}`);
	const [, scheme, user, pass, host] = m;
	return {
		base: `${scheme}${host}`.replace(/\/$/, ''),
		auth: 'Basic ' + Buffer.from(`${decodeURIComponent(user)}:${decodeURIComponent(pass)}`).toString('base64')
	};
}

async function couchReq(couch, method, path, body) {
	const res = await fetch(`${couch.base}${path}`, {
		method,
		headers: {
			Authorization: couch.auth,
			'Content-Type': 'application/json',
			Accept: 'application/json'
		},
		...(body !== undefined ? { body: JSON.stringify(body) } : {})
	});
	const data = await res.json().catch(() => null);
	return { status: res.status, data };
}

function docAgeMs(doc) {
	const stamp = doc.created_at ?? doc.updated_at;
	if (typeof stamp !== 'string' || !stamp) return null;
	const t = Date.parse(stamp);
	return Number.isFinite(t) ? Date.now() - t : null;
}

function formatAge(ms) {
	if (ms == null) return 'unknown-age';
	const hours = ms / 3_600_000;
	if (hours < 24) return `${hours.toFixed(1)}h`;
	return `${(hours / 24).toFixed(1)}d`;
}

async function listE2EShelters(couch) {
	const res = await couchReq(couch, 'GET', '/registry/_all_docs?include_docs=true');
	if (res.status >= 400) {
		throw new Error(`registry/_all_docs HTTP ${res.status}: ${JSON.stringify(res.data)}`);
	}
	const rows = res.data?.rows ?? [];
	const out = [];
	for (const row of rows) {
		const doc = row.doc;
		if (!doc || doc.type !== 'shelter') continue;
		if (typeof doc.name !== 'string' || !doc.name.startsWith(E2E_SHELTER_PREFIX)) continue;
		out.push(doc);
	}
	return out;
}

async function teardownShelter(couch, doc, { dryRun }) {
	const code = String(doc.code ?? '');
	const id = String(doc._id ?? '');
	const age = docAgeMs(doc);
	const line = {
		action: dryRun ? 'would-delete' : 'delete',
		_id: id,
		code,
		name: doc.name,
		created_at: doc.created_at ?? null,
		updated_at: doc.updated_at ?? null,
		age: formatAge(age)
	};
	console.log(JSON.stringify(line));

	if (dryRun) return { ok: true, dryRun: true };

	if (!code || !id || !doc._rev) {
		throw new Error(`Cannot delete incomplete shelter doc: ${JSON.stringify(line)}`);
	}

	const closed = await couchReq(couch, 'PUT', `/registry/${encodeURIComponent(id)}`, {
		...doc,
		operation_status: 'closed',
		updated_at: new Date().toISOString()
	});
	if (closed.status >= 400) {
		throw new Error(`close ${code} failed HTTP ${closed.status}: ${JSON.stringify(closed.data)}`);
	}
	const rev = closed.data?.rev;
	const delDoc = await couchReq(
		couch,
		'DELETE',
		`/registry/${encodeURIComponent(id)}?rev=${encodeURIComponent(rev)}`
	);
	if (delDoc.status >= 400 && delDoc.status !== 404) {
		throw new Error(
			`delete master ${id} failed HTTP ${delDoc.status}: ${JSON.stringify(delDoc.data)}`
		);
	}
	const db = `shelter_${code.toLowerCase()}`;
	const delDb = await couchReq(couch, 'DELETE', `/${db}`);
	if (delDb.status >= 400 && delDb.status !== 404) {
		console.warn(
			JSON.stringify({
				warning: 'shelter-db-delete-failed',
				db,
				status: delDb.status,
				body: delDb.data
			})
		);
	}
	console.log(JSON.stringify({ deleted: true, _id: id, code, db }));
	return { ok: true, dryRun: false };
}

async function main() {
	const { dryRun, maxAgeHours } = parseArgs(process.argv.slice(2));
	const rawUrl = process.env.COUCHDB_ADMIN_URL?.trim();
	if (!rawUrl) {
		console.error('COUCHDB_ADMIN_URL is required');
		usage(2);
	}
	const couch = parseCouchUrl(rawUrl);
	const minAgeMs = maxAgeHours * 3_600_000;

	console.log(
		JSON.stringify({
			mode: dryRun ? 'dry-run' : 'execute',
			max_age_hours: maxAgeHours,
			prefix: E2E_SHELTER_PREFIX,
			couch_host: couch.base
		})
	);

	const shelters = await listE2EShelters(couch);
	const candidates = [];
	const skippedYoung = [];
	for (const doc of shelters) {
		const age = docAgeMs(doc);
		if (age == null || age < minAgeMs) {
			skippedYoung.push({
				_id: doc._id,
				code: doc.code,
				name: doc.name,
				age: formatAge(age),
				reason: age == null ? 'missing-timestamp' : 'too-young'
			});
			continue;
		}
		candidates.push(doc);
	}

	for (const s of skippedYoung) {
		console.log(JSON.stringify({ action: 'skip', ...s }));
	}

	let deleted = 0;
	for (const doc of candidates) {
		await teardownShelter(couch, doc, { dryRun });
		deleted += 1;
	}

	console.log(
		JSON.stringify({
			summary: true,
			mode: dryRun ? 'dry-run' : 'execute',
			e2e_shelters_seen: shelters.length,
			candidates: candidates.length,
			skipped_young_or_untimestamped: skippedYoung.length,
			processed: deleted
		})
	);
}

main().catch((err) => {
	console.error(err instanceof Error ? err.stack ?? err.message : err);
	process.exit(1);
});
