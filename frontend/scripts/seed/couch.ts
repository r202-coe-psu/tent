/**
 * Shared CouchDB helpers for seed scripts.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCouchCredentialUrl } from '$lib/server/couch-credentials';
import { assertBulkWriteResults, type BulkWriteResult } from '../t31-seed-support';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPaths = [
	resolve(__dirname, '../../../.env'),
	resolve(__dirname, '../../.env'),
	resolve(process.cwd(), '.env')
];

function loadEnv(): Record<string, string> {
	const merged: Record<string, string> = {};
	for (const p of envPaths) {
		if (!existsSync(p)) continue;
		const parsed = Object.fromEntries(
			readFileSync(p, 'utf-8')
				.split('\n')
				.filter((l) => l.trim() && !l.startsWith('#') && l.includes('='))
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
		Object.assign(merged, parsed);
	}
	return merged;
}

export const env = loadEnv();
export const rawCouchUrl =
	process.env.COUCHDB_ADMIN_URL ??
	env.COUCHDB_ADMIN_URL ??
	(env.COUCHDB_USER && env.COUCHDB_PASSWORD
		? `http://${env.COUCHDB_USER}:${env.COUCHDB_PASSWORD}@${env.COUCHDB_HOST || '127.0.0.1'}:${env.COUCHDB_PORT || '5984'}`
		: 'http://admin:password@localhost:5984');

/** Public-writer username(s) for shelter `_security.members.names`. */
export const PUBLIC_WRITER_NAMES: string[] = (() => {
	const creds = parseCouchCredentialUrl(
		process.env.COUCHDB_PUBLIC_WRITER_URL ??
			env.COUCHDB_PUBLIC_WRITER_URL ??
			(env.COUCHDB_PUBLIC_WRITER_USER && env.COUCHDB_PUBLIC_WRITER_PASSWORD
				? `http://${env.COUCHDB_PUBLIC_WRITER_USER}:${env.COUCHDB_PUBLIC_WRITER_PASSWORD}@${env.COUCHDB_HOST || '127.0.0.1'}:${env.COUCHDB_PORT || '5984'}`
				: undefined)
	);
	return creds ? [creds.user] : [];
})();

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

export function displayCouchUrl(): string {
	return rawCouchUrl.replace(/\/\/([^:]+):[^@]+@/, '//$1:***@');
}

export async function couchReq(
	method: string,
	path: string,
	body?: unknown
): Promise<{ status: number; data: unknown }> {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (COUCH_AUTH) headers['Authorization'] = COUCH_AUTH;
	const res = await fetch(`${COUCH_URL}${path}`, {
		method,
		headers,
		...(body !== undefined ? { body: JSON.stringify(body) } : {})
	});
	const data = await res.json().catch(() => null);
	return { status: res.status, data };
}

export async function ensureDb(name: string): Promise<void> {
	const { status } = await couchReq('PUT', `/${name}`);
	if (status !== 201 && status !== 412) {
		throw new Error(`Cannot create database "${name}" (HTTP ${status})`);
	}
}

interface CouchDbSecurity {
	admins?: { names?: string[]; roles?: string[] };
	members?: { names?: string[]; roles?: string[] };
}

export async function setSecurity(db: string, security: CouchDbSecurity): Promise<void> {
	const { status: getStatus, data } = await couchReq('GET', `/${db}/_security`);
	const existing = (getStatus === 200 ? data : {}) as CouchDbSecurity;

	existing.admins ??= { names: [], roles: [] };
	existing.members ??= { names: [], roles: [] };
	existing.admins.names ??= [];
	existing.admins.roles ??= [];
	existing.members.names ??= [];
	existing.members.roles ??= [];

	const merge = (a: string[], b: string[] = []) => Array.from(new Set([...a, ...b]));

	existing.admins.roles = merge(existing.admins.roles, security.admins?.roles);
	existing.admins.names = merge(existing.admins.names, security.admins?.names);
	existing.members.roles = merge(existing.members.roles, security.members?.roles);
	existing.members.names = merge(existing.members.names, security.members?.names);

	const { status } = await couchReq('PUT', `/${db}/_security`, existing);
	if (status !== 200) throw new Error(`Cannot set _security for "${db}" (HTTP ${status})`);
	console.log(`  ✓ ${db}: _security set`);
}

export async function putDoc(
	db: string,
	doc: Record<string, unknown> | { _id: string }
): Promise<void> {
	const id = (doc as { _id: string })._id;
	const { status } = await couchReq('PUT', `/${db}/${encodeURIComponent(id)}`, doc);
	if (status !== 201 && status !== 409) {
		throw new Error(`PUT ${id} → ${db} failed (HTTP ${status})`);
	}
}

/** PUT a deterministic fixture, carrying the current revision when it exists. */
export async function putDocUpsert(
	db: string,
	doc: Record<string, unknown> & { _id: string }
): Promise<void> {
	const id = doc._id;
	const path = `/${db}/${encodeURIComponent(id)}`;
	const current = await couchReq('GET', path);
	const currentRev =
		current.status === 200 && current.data && typeof current.data === 'object'
			? (current.data as { _rev?: string })._rev
			: undefined;
	const next = currentRev ? { ...doc, _rev: currentRev } : doc;
	const { status } = await couchReq('PUT', path, next);
	if (status !== 201 && status !== 409) {
		throw new Error(`PUT ${id} → ${db} failed (HTTP ${status})`);
	}
}

export async function bulkDocs(
	db: string,
	docs: unknown[],
	options: { allowConflicts?: boolean } = { allowConflicts: true }
): Promise<void> {
	if (docs.length === 0) return;
	const { status, data } = await couchReq('POST', `/${db}/_bulk_docs`, { docs });
	if (status !== 201) throw new Error(`_bulk_docs to "${db}" failed (HTTP ${status})`);
	assertBulkWriteResults(db, data as BulkWriteResult[], options);
}

/** Write docs in batches to avoid oversized CouchDB requests. */
export async function bulkDocsBatched(
	db: string,
	docs: unknown[],
	batchSize = 150,
	options: { allowConflicts?: boolean } = { allowConflicts: true }
): Promise<void> {
	for (let i = 0; i < docs.length; i += batchSize) {
		await bulkDocs(db, docs.slice(i, i + batchSize), options);
	}
}
