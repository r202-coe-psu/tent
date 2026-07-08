import { couchFetch, COUCH_URL } from './couch';
import {
	AuthError,
	CannotConnectError,
	ConflictError,
	CouchAuthError,
	NetworkError,
	NotFoundError,
	type AppError
} from '$lib/utils/errors';
import { authStore } from '$lib/stores/auth.svelte';
import { endpointStore } from '$lib/stores/endpoint.svelte';

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 200;
const TYPE_PREFIX_END = '\ufff0';

export interface CouchDbHttpError extends Error {
	status: number;
	couchError?: string;
	reason?: string;
}

interface PutResult {
	ok: boolean;
	id: string;
	rev: string;
}

interface BulkDocResult {
	ok?: boolean;
	id?: string;
	rev?: string;
	error?: string;
	status?: number;
	reason?: string;
}

interface AllDocsRow {
	id: string;
	doc?: unknown;
}

interface AllDocsResponse {
	rows: AllDocsRow[];
}

type CouchFetchInit = RequestInit & { fetch?: typeof fetch };

async function couchDbFetchRaw<T>(
	dbName: string,
	path: string,
	init: CouchFetchInit = {}
): Promise<{ data: T | null; status: number; ok: boolean }> {
	const { fetch: customFetch, ...rest } = init;
	const fetchFn = customFetch ?? fetch;
	const res = await fetchFn(`${COUCH_URL}/${dbName}${path}`, {
		credentials: 'include',
		...rest,
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json',
			...rest.headers
		}
	});

	const data = (await res.json().catch(() => null)) as
		| (T & { error?: string; reason?: string })
		| null;

	return { data, status: res.status, ok: res.ok };
}

function toHttpError(
	status: number,
	data: { error?: string; reason?: string } | null,
	fallback: string
): AppError {
	if (status === 404) return new NotFoundError();
	if (status === 409) return new ConflictError();
	if (status === 401) return new CouchAuthError(401);
	if (status === 403) return new CouchAuthError(403);
	if (status >= 500 || status === 0) return new NetworkError();
	const message = data?.reason || data?.error || fallback;
	return new ConflictError(message);
}

function isRetryable(err: unknown): boolean {
	if (err instanceof CouchAuthError || err instanceof AuthError) return false;
	if (err instanceof ConflictError) return false;
	if (err instanceof CannotConnectError) return false;
	if (err instanceof TypeError) return true;
	if (err instanceof DOMException && err.name === 'AbortError') return true;
	if (err instanceof Error && err.message.includes('fetch')) return true;
	return err instanceof NetworkError;
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
	let lastError: unknown;
	for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
		try {
			const result = await fn();
			endpointStore.markConnected();
			return result;
		} catch (err) {
			lastError = err;
			if (err instanceof CouchAuthError) {
				authStore.markNeedsReauth();
				throw err;
			}
			if (!isRetryable(err) || attempt === MAX_RETRIES - 1) break;
			await new Promise((r) => setTimeout(r, RETRY_BASE_MS * (attempt + 1)));
		}
	}
	if (isRetryable(lastError)) {
		endpointStore.markDisconnected();
		throw new CannotConnectError();
	}
	throw lastError;
}

/** Low-level CouchDB database fetch — throws typed AppError on failure. */
export async function couchDbFetch<T>(
	dbName: string,
	path: string,
	init: CouchFetchInit = {}
): Promise<T> {
	return withRetry(async () => {
		const { data, status, ok } = await couchDbFetchRaw<T>(dbName, path, init);
		if (!ok) {
			throw toHttpError(
				status,
				data as { error?: string; reason?: string } | null,
				`CouchDB request failed (${status})`
			);
		}
		return data as T;
	});
}

export async function getDoc<T extends { _id: string }>(
	dbName: string,
	id: string,
	init?: CouchFetchInit
): Promise<T | null> {
	try {
		return await couchDbFetch<T>(dbName, `/${encodeURIComponent(id)}`, init);
	} catch (err) {
		if (err instanceof NotFoundError) return null;
		throw err;
	}
}

export async function putDoc<T extends { _id: string; _rev?: string }>(
	dbName: string,
	doc: T,
	init?: CouchFetchInit
): Promise<T> {
	const isCreate = !doc._rev;
	try {
		const res = await couchDbFetch<PutResult>(dbName, `/${encodeURIComponent(doc._id)}`, {
			method: 'PUT',
			body: JSON.stringify(doc),
			...init
		});
		return { ...doc, _rev: res.rev };
	} catch (err) {
		if (err instanceof ConflictError && isCreate) {
			const existing = await getDoc<T>(dbName, doc._id, init);
			if (existing) return existing;
		}
		throw err;
	}
}

export async function deleteDoc(
	dbName: string,
	doc: { _id: string; _rev?: string },
	init?: CouchFetchInit
): Promise<void> {
	if (!doc._rev) {
		const latest = await getDoc<{ _id: string; _rev?: string }>(dbName, doc._id, init);
		if (!latest?._rev) return;
		doc = { ...doc, _rev: latest._rev };
	}
	await couchDbFetch(
		dbName,
		`/${encodeURIComponent(doc._id)}?rev=${encodeURIComponent(doc._rev!)}`,
		{
			method: 'DELETE',
			...init
		}
	);
}

export async function allDocsByType<T>(
	dbName: string,
	type: string,
	guard: (d: unknown) => d is T,
	init?: CouchFetchInit
): Promise<T[]> {
	const startkey = JSON.stringify(`${type}:`);
	const endkey = JSON.stringify(`${type}:${TYPE_PREFIX_END}`);
	const res = await couchDbFetch<AllDocsResponse>(
		dbName,
		`/_all_docs?include_docs=true&startkey=${encodeURIComponent(startkey)}&endkey=${encodeURIComponent(endkey)}`,
		init
	);
	return res.rows.map((r) => r.doc).filter((d): d is T => guard(d));
}

export async function bulkDocs<T extends { _id: string; _rev?: string }>(
	dbName: string,
	docs: T[],
	init?: CouchFetchInit
): Promise<T[]> {
	const results = await couchDbFetch<BulkDocResult[]>(dbName, '/_bulk_docs', {
		method: 'POST',
		body: JSON.stringify({ docs }),
		...init
	});

	const failures = results.filter((r) => r.error);
	const idempotentConflicts = failures.every((r) => r.status === 409 || r.error === 'conflict');

	if (failures.length > 0 && !idempotentConflicts) {
		throw new Error(`bulkDocs: ${failures.length} doc(s) failed: ${JSON.stringify(failures)}`);
	}

	return docs.map((doc) => {
		const res = results.find((r) => r.id === doc._id);
		if (res?.rev) return { ...doc, _rev: res.rev };
		return doc;
	});
}

/**
 * Bulk save with MVCC conflict retry — used by sop-ratio version writes.
 */
export async function saveBulkAtomic<T extends { _id: string; _rev?: string }>(
	dbName: string,
	docs: T[],
	label: string,
	init?: CouchFetchInit
): Promise<T[]> {
	const MAX_BULK_RETRIES = 3;
	let attempts = 0;
	let currentDocs = [...docs];

	while (attempts < MAX_BULK_RETRIES) {
		try {
			const results = await couchDbFetch<BulkDocResult[]>(dbName, '/_bulk_docs', {
				method: 'POST',
				body: JSON.stringify({ docs: currentDocs }),
				...init
			});

			const errors = results.filter((r) => r.error);
			const hasConflict = errors.some((e) => e.status === 409 || e.error === 'conflict');

			if (hasConflict) {
				throw new Error('409_CONFLICT');
			}
			if (errors.length > 0) {
				throw new Error(`Failed to save ${label} atomically: ${JSON.stringify(errors)}`);
			}

			return currentDocs.map((doc) => {
				const res = results.find((r) => r.ok && r.id === doc._id);
				return res?.rev ? { ...doc, _rev: res.rev } : doc;
			});
		} catch (error: unknown) {
			if (error instanceof Error && error.message === '409_CONFLICT') {
				attempts++;
				if (attempts >= MAX_BULK_RETRIES) {
					throw new Error(`Max retries reached due to Document Conflicts (409) in ${label}.`, {
						cause: error
					});
				}
				await new Promise((resolve) => setTimeout(resolve, 50 * attempts));

				const refreshed: T[] = [];
				for (const doc of currentDocs) {
					const fresh = await getDoc<T>(dbName, doc._id, init);
					refreshed.push(fresh ? { ...doc, _rev: fresh._rev } : doc);
				}
				currentDocs = refreshed;
				continue;
			}
			throw error;
		}
	}
	throw new Error(`Unexpected error in saveBulkAtomic for ${label}`);
}

/** Probe central CouchDB reachability. */
export async function probeCentral(init?: CouchFetchInit): Promise<boolean> {
	try {
		await couchFetch('/_up', init);
		return true;
	} catch {
		return false;
	}
}
