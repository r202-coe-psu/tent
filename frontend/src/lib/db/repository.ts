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
export interface Repository {
	/** Insert or update a doc; returns it stamped with the new `_rev`. */
	put<T extends BaseDoc>(doc: T): Promise<T>;
	/** Fetch a doc by `_id`, or `null` when it does not exist. */
	get<T extends BaseDoc>(id: string): Promise<T | null>;
	/** Delete a doc (needs a live `_rev`). */
	remove(doc: BaseDoc): Promise<void>;
	/** Every doc whose `_id` starts with `"{type}:"`, narrowed by `guard`. */
	allByType<T extends BaseDoc>(type: string, guard: (d: unknown) => d is T): Promise<T[]>;
}

/** Build a {@link Repository} bound to one local PouchDB database. */
export function createRepository(db: PouchDB.Database): Repository {
	return {
		async put<T extends BaseDoc>(doc: T): Promise<T> {
			const res = await db.put(doc as PouchDB.Core.PutDocument<T>);
			return { ...doc, _rev: res.rev };
		},

		async get<T extends BaseDoc>(id: string): Promise<T | null> {
			try {
				return (await db.get<T>(id)) as T;
			} catch (e) {
				if ((e as { status?: number }).status === 404) return null;
				throw e;
			}
		},

		async remove(doc: BaseDoc): Promise<void> {
			await db.remove(doc as PouchDB.Core.RemoveDocument);
		},

		async allByType<T extends BaseDoc>(type: string, guard: (d: unknown) => d is T): Promise<T[]> {
			const res = await db.allDocs({
				include_docs: true,
				startkey: `${type}:`,
				// `￰` is a high code point — the inclusive upper bound of the prefix.
				endkey: `${type}:￰`
			});
			return res.rows.map((r) => r.doc as unknown).filter((d): d is T => guard(d));
		}
	};
}
