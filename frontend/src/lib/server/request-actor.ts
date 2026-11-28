import { AsyncLocalStorage } from 'node:async_hooks';
import { isAuditedWriteDb } from '$lib/db/audited-db';

type ActorScope = { actor: string | null };

const storage = new AsyncLocalStorage<ActorScope>();

export function runWithActorScope<T>(fn: () => T): T {
	return storage.run({ actor: null }, fn);
}

export function runAsActor<T>(actor: string, fn: () => T): T {
	return storage.run({ actor }, fn);
}

export function setRequestActor(actor: string | null | undefined): void {
	const scope = storage.getStore();
	if (scope && actor) scope.actor = actor;
}

export function currentActor(): string | null {
	return storage.getStore()?.actor ?? null;
}

export function withActor<T extends object>(doc: T, actor: string): T {
	const next = { ...doc, updated_by: actor } as T & { created_by?: unknown; _rev?: unknown };
	if (!next._rev && !next.created_by) next.created_by = actor;
	return next;
}

/** `/{db}/{rest}` of an admin request path, without its query string. */
function splitPath(path: string): { db: string; rest: string } {
	const clean = path.split('?')[0];
	const [, db = '', ...rest] = clean.split('/');
	return { db: decodeURIComponent(db), rest: rest.join('/') };
}

function docWrite(path: string, method: string): 'single' | 'bulk' | 'delete' | null {
	const { db, rest } = splitPath(path);
	if (!isAuditedWriteDb(db)) return null;
	const upper = method.toUpperCase();
	if (upper === 'POST' && rest === '_bulk_docs') return 'bulk';
	if (upper === 'POST' && rest === '') return 'single';
	const isDocPath = rest !== '' && !rest.includes('/') && !decodeURIComponent(rest).startsWith('_');
	if (upper === 'PUT' && isDocPath) return 'single';
	if (upper === 'DELETE' && isDocPath) return 'delete';
	return null;
}

/**
 * Name the writer on one doc: the request actor when there is one; otherwise drop any
 * `updated_by` the doc carries over from its previous revision, so the worker records
 * `unknown` (FR-C8) instead of crediting the last writer with this change.
 */
function withWriter(doc: unknown, actor: string | null): unknown {
	if (!doc || typeof doc !== 'object') return doc;
	if (actor) return { ...doc, updated_by: actor };
	if (!('updated_by' in doc)) return doc;
	const rest: Record<string, unknown> = { ...doc };
	delete rest.updated_by;
	return rest;
}

export type AdminRequest = { path: string; method: string; body: unknown };

/**
 * Rewrite an admin-credential write to a `shelter_*` / `catalog` doc so it names its writer
 * (CR-260 FR-C6): stamps or clears `updated_by` on `PUT`/`POST`/`_bulk_docs`, and turns
 * `DELETE /{db}/{id}?rev=` into a `PUT` tombstone that names the deleter, like the client's
 * `deleteDoc` (FR-C4). Every other request is returned unchanged.
 */
export function prepareAdminWrite(path: string, method: string, body: unknown): AdminRequest {
	const kind = docWrite(path, method);
	const actor = currentActor();
	if (kind === 'single') return { path, method, body: withWriter(body, actor) };
	if (kind === 'bulk') {
		const docs = (body as { docs?: unknown } | null)?.docs;
		if (!Array.isArray(docs)) return { path, method, body };
		return {
			path,
			method,
			body: { ...(body as object), docs: docs.map((d) => withWriter(d, actor)) }
		};
	}
	if (kind === 'delete') {
		const [docPath, query = ''] = path.split('?');
		const rev = new URLSearchParams(query).get('rev');
		if (!rev) return { path, method, body };
		const tombstone = {
			_id: decodeURIComponent(splitPath(docPath).rest),
			_rev: rev,
			_deleted: true,
			updated_at: new Date().toISOString()
		};
		return { path: docPath, method: 'PUT', body: withWriter(tombstone, actor) };
	}
	return { path, method, body };
}
