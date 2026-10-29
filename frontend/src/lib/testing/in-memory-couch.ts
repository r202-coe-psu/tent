import { ConflictError } from '$lib/utils/errors';

export interface InMemoryDoc {
	_id: string;
	_rev?: string;
	type?: string;
	[key: string]: unknown;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * Map-backed stand-in for the `$lib/db/couch-db` primitives the food-supplies repositories use
 * (`getDoc`, `putDoc`, `allDocsByType`). `putDoc` enforces optimistic concurrency like CouchDB
 * (existing doc + missing/stale `_rev` → `ConflictError`) and assigns a fresh `_rev` per write.
 *
 * Because `vi.mock()` factories are hoisted above module code, create the instance via
 * `vi.hoisted` and hand `couchDbModule` to the mock factory:
 *
 * ```ts
 * const couch = await vi.hoisted(async () => {
 * 	const { createInMemoryCouch } = await import('$lib/testing/in-memory-couch');
 * 	return createInMemoryCouch();
 * });
 * const { store, nextRev } = couch;
 * vi.mock('$lib/db/couch-db', () => couch.couchDbModule);
 * // beforeEach(() => couch.reset());
 * ```
 *
 * `store` is cleared in place by `reset()`, so destructuring it once stays valid.
 */
export function createInMemoryCouch() {
	const store = new Map<string, InMemoryDoc>();
	const revCounters = new Map<string, number>();

	function nextRev(id: string): string {
		const count = (revCounters.get(id) ?? 0) + 1;
		revCounters.set(id, count);
		return `${count}-rev${id.replace(/[^a-zA-Z0-9]/g, '')}`;
	}

	const findQueries: {
		dbName: string;
		selector: Record<string, unknown>;
		fields?: string[];
		limit?: number;
	}[] = [];

	function reset(): void {
		findQueries.length = 0;
		store.clear();
		revCounters.clear();
	}

	const putDoc = async <T extends { _id: string; _rev?: string }>(
		_dbName: string,
		doc: T
	): Promise<T> => {
		const existing = store.get(doc._id);
		if (existing && (!doc._rev || doc._rev !== existing._rev)) {
			throw new ConflictError(`Conflict on doc ${doc._id}`);
		}
		const saved = clone(doc) as T & { _rev: string };
		saved._rev = nextRev(doc._id);
		store.set(doc._id, saved as InMemoryDoc);
		return saved;
	};

	const couchDbModule = {
		ConflictError,
		getDoc: async <T extends { _id: string }>(_dbName: string, id: string): Promise<T | null> => {
			const doc = store.get(id);
			return doc ? clone(doc as unknown as T) : null;
		},
		putDoc,
		// This stand-in already throws ConflictError on a create over an existing doc.
		putDocStrict: putDoc,
		allDocsByType: async <T extends { _id: string; type: string }>(
			_dbName: string,
			type: string,
			guard?: (d: unknown) => d is T
		): Promise<T[]> => {
			const results: T[] = [];
			for (const [id, doc] of store.entries()) {
				// Like the real helper this is an id-prefix scan filtered by `guard`; without a guard
				// the doc's own `type` must equal the prefix.
				if (id.startsWith(`${type}:`) && (guard || doc.type === type)) {
					const copy = clone(doc as unknown as T);
					if (!guard || guard(copy)) results.push(copy);
				}
			}
			return results;
		},
		allDocsByIds: async <T>(
			_dbName: string,
			ids: readonly string[],
			guard: (d: unknown) => d is T
		): Promise<T[]> => {
			const results: T[] = [];
			for (const id of ids) {
				const doc = store.get(id);
				if (!doc) continue;
				const copy = clone(doc);
				if (guard(copy)) results.push(copy);
			}
			return results;
		},
		// `_find` without paging. A selector value is either an equality operand or an operator object
		// of `$in` / `$gte` / `$lte` (string comparison, all must hold); any other operator throws;
		// `fields` projects each doc to those keys; `limit` defaults to 25 like CouchDB. Docs are
		// served in `_id` order. Every query is recorded in `findQueries`.
		findDocs: async <T>(
			dbName: string,
			query: { selector: Record<string, unknown>; fields?: string[]; limit?: number }
		): Promise<T[]> => {
			findQueries.push({ dbName, ...clone(query) });
			for (const v of Object.values(query.selector)) {
				if (v && typeof v === 'object' && !Array.isArray(v)) {
					for (const op of Object.keys(v as Record<string, unknown>)) {
						if (op !== '$in' && op !== '$gte' && op !== '$lte') {
							throw new Error(`in-memory couch findDocs: unsupported operator ${op}`);
						}
					}
				}
			}
			const matches = [...store.values()]
				.filter((doc) =>
					Object.entries(query.selector).every(([k, v]) => {
						if (v && typeof v === 'object' && !Array.isArray(v)) {
							return Object.entries(v as Record<string, unknown>).every(([op, operand]) => {
								// Operators were validated up front; anything else here is `$lte`.
								switch (op) {
									case '$in':
										return ((operand as unknown[]) ?? []).includes(doc[k]);
									case '$gte':
										return typeof doc[k] === 'string' && doc[k] >= (operand as string);
									default:
										return typeof doc[k] === 'string' && doc[k] <= (operand as string);
								}
							});
						}
						return doc[k] === v;
					})
				)
				.sort((a, b) => (a._id < b._id ? -1 : a._id > b._id ? 1 : 0))
				.slice(0, query.limit ?? 25);
			return matches.map((doc) => {
				const copy = clone(doc) as Record<string, unknown>;
				if (!query.fields) return copy as T;
				const projected: Record<string, unknown> = {};
				for (const field of query.fields) {
					if (field in copy) projected[field] = copy[field];
				}
				return projected as T;
			});
		},
		// Equality-only selectors; `limit` defaults to 25 and `bookmark` is the next row offset, like
		// CouchDB (docs are served in `_id` order, as an index on [type, field] would).
		findDocsPage: async <T>(
			_dbName: string,
			query: { selector: Record<string, unknown>; limit?: number; bookmark?: string }
		): Promise<{ docs: T[]; bookmark: string | null }> => {
			const matches = [...store.values()]
				.filter((doc) => Object.entries(query.selector).every(([k, v]) => doc[k] === v))
				.sort((a, b) => (a._id < b._id ? -1 : a._id > b._id ? 1 : 0));
			const offset = query.bookmark ? Number(query.bookmark) : 0;
			const docs = matches.slice(offset, offset + (query.limit ?? 25)).map((d) => clone(d) as T);
			return { docs, bookmark: String(offset + docs.length) };
		}
	};

	return { store, nextRev, reset, couchDbModule, findQueries };
}
