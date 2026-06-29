import type { BaseDoc } from './model';

/**
 * Reusable primitive #1 — a thin, type-agnostic wrapper around a single local
 * PouchDB database. Feature data layers build their concrete repositories on
 * top of this instead of touching PouchDB directly, so the doc envelope
 * (`BaseDoc`) and the `{type}:{ulid}` id convention are honoured in one place.
 *
 * `allByType` leans on the canonical `_id = "{type}:{ulid}"` shape (model.ts):
 * a prefix scan over `_all_docs` is deterministic and needs no secondary index.
 * Secondary-key lookups (by phone, status, …) graduate to Mango `find()` once
 * the `pouchdb-find` plugin + `createIndex` land (schema.md §6) — a later step.
 */
export interface PaginatedResult<T> {
	items: T[];
	total: number;
	page: number;
	pageSize: number;
	totalPages: number;
}

export interface Repository {
	put<T extends { _id: string }>(doc: T): Promise<T>;
	get<T extends { _id: string }>(id: string): Promise<T | null>;
	remove(doc: { _id: string; _rev?: string }): Promise<void>;
	allByType<T extends { _id: string; type: string }>(type: string, guard: (d: unknown) => d is T): Promise<T[]>;
	pageByType<T extends { _id: string; type: string }>(
		type: string,
		guard: (d: unknown) => d is T,
		page: number,
		pageSize: number
	): Promise<PaginatedResult<T>>;
}

/** Build a {@link Repository} bound to one local PouchDB database. */
export function createRepository(db: PouchDB.Database): Repository {
	return {
		async put<T extends { _id: string }>(doc: T): Promise<T> {
			const res = await db.put(doc as PouchDB.Core.PutDocument<T>);
			return { ...doc, _rev: res.rev };
		},

		async get<T extends { _id: string }>(id: string): Promise<T | null> {
			try {
				return (await db.get<T>(id)) as T;
			} catch (e) {
				if ((e as { status?: number }).status === 404) return null;
				throw e;
			}
		},

		async remove(doc: { _id: string; _rev?: string }): Promise<void> {
			await db.remove(doc as PouchDB.Core.RemoveDocument);
		},

		async allByType<T extends { _id: string; type: string }>(type: string, guard: (d: unknown) => d is T): Promise<T[]> {
			const res = await db.allDocs({
				include_docs: true,
				startkey: `${type}:`,
				// `￰` is a high code point — the inclusive upper bound of the prefix.
				endkey: `${type}:￰`
			});
			return res.rows.map((r) => r.doc as unknown).filter((d): d is T => guard(d));
		},

		async pageByType<T extends { _id: string; type: string }>(
			type: string,
			guard: (d: unknown) => d is T,
			page: number,
			pageSize: number
		): Promise<PaginatedResult<T>> {
			const all = await db.allDocs({
				include_docs: true,
				startkey: `${type}:`,
				endkey: `${type}:￰`
			});
			const matched = all.rows.map((r) => r.doc as unknown).filter((d): d is T => guard(d));
			const total = matched.length;
			const totalPages = Math.max(1, Math.ceil(total / pageSize));
			const safePage = Math.max(1, Math.min(page, totalPages));
			const start = (safePage - 1) * pageSize;
			const items = matched.slice(start, start + pageSize);
			return { items, total, page: safePage, pageSize, totalPages };
		}
	};
}
