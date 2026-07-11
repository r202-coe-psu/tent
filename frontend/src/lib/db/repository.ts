/**
 * Reusable primitive #1 — a thin, type-agnostic wrapper around a single remote
 * CouchDB database. Feature data layers build their concrete repositories on
 * top of this instead of calling CouchDB HTTP directly, so the doc envelope
 * (`BaseDoc`) and the `{type}:{ulid}` id convention are honoured in one place.
 *
 * `allByType` leans on the canonical `_id = "{type}:{ulid}"` shape (model.ts):
 * a prefix scan over `_all_docs` is deterministic and needs no secondary index.
 * Secondary-key lookups (by phone, status, …) graduate to Mango `find()` once
 * indexes land (schema.md §6) — a later step.
 */
import { allDocsByType, deleteDoc, findDocs, getDoc, putDoc } from './couch-db';

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
	allByType<T extends { _id: string; type: string }>(
		type: string,
		guard: (d: unknown) => d is T
	): Promise<T[]>;
	pageByType<T extends { _id: string; type: string }>(
		type: string,
		guard: (d: unknown) => d is T,
		page: number,
		pageSize: number
	): Promise<PaginatedResult<T>>;
	find<T>(query: { selector: Record<string, unknown>; [key: string]: unknown }): Promise<T[]>;
}

/** Build a {@link Repository} bound to one remote CouchDB database. */
export function createRemoteRepository(dbName: string): Repository {
	return {
		async put<T extends { _id: string }>(doc: T): Promise<T> {
			return putDoc(dbName, doc);
		},

		async get<T extends { _id: string }>(id: string): Promise<T | null> {
			return getDoc<T>(dbName, id);
		},

		async remove(doc: { _id: string; _rev?: string }): Promise<void> {
			await deleteDoc(dbName, doc);
		},

		async allByType<T extends { _id: string; type: string }>(
			type: string,
			guard: (d: unknown) => d is T
		): Promise<T[]> {
			return allDocsByType(dbName, type, guard);
		},

		async pageByType<T extends { _id: string; type: string }>(
			type: string,
			guard: (d: unknown) => d is T,
			page: number,
			pageSize: number
		): Promise<PaginatedResult<T>> {
			const matched = await allDocsByType(dbName, type, guard);
			const total = matched.length;
			const totalPages = Math.max(1, Math.ceil(total / pageSize));
			const safePage = Math.max(1, Math.min(page, totalPages));
			const start = (safePage - 1) * pageSize;
			const items = matched.slice(start, start + pageSize);
			return { items, total, page: safePage, pageSize, totalPages };
		},

		async find<T>(query: {
			selector: Record<string, unknown>;
			[key: string]: unknown;
		}): Promise<T[]> {
			return findDocs<T>(dbName, query);
		}
	};
}

/** @deprecated Use {@link createRemoteRepository}. Kept temporarily for test migration. */
export const createRepository = createRemoteRepository;
