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

	function reset(): void {
		store.clear();
		revCounters.clear();
	}

	const couchDbModule = {
		ConflictError,
		getDoc: async <T extends { _id: string }>(_dbName: string, id: string): Promise<T | null> => {
			const doc = store.get(id);
			return doc ? clone(doc as unknown as T) : null;
		},
		putDoc: async <T extends { _id: string; _rev?: string }>(
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
		},
		allDocsByType: async <T extends { _id: string; type: string }>(
			_dbName: string,
			type: string
		): Promise<T[]> => {
			const results: T[] = [];
			for (const [id, doc] of store.entries()) {
				if (id.startsWith(`${type}:`) && doc.type === type) {
					results.push(clone(doc as unknown as T));
				}
			}
			return results;
		}
	};

	return { store, nextRev, reset, couchDbModule };
}
