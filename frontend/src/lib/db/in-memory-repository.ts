import { paginateItems } from './paginate';
import type { FindPageResult, PaginatedResult, Repository } from './repository';

/** Dotted selector keys (`emergency_contact.phone`) resolve through nested objects, like Mango. */
function valueAtPath(doc: Record<string, unknown>, path: string): unknown {
	let cur: unknown = doc;
	for (const part of path.split('.')) {
		if (cur == null || typeof cur !== 'object') return undefined;
		cur = (cur as Record<string, unknown>)[part];
	}
	return cur;
}

// CouchDB compares Mango string ranges with ICU collation, not code points: `Somchai` sits inside
// [`som`, `som` + U+FFF0) and `เสือ` inside the `ส` range. A code-point fake hides those cases.
const collate = new Intl.Collator('und').compare;

function matchesSelector(doc: Record<string, unknown>, selector: Record<string, unknown>): boolean {
	for (const [key, cond] of Object.entries(selector)) {
		const val = valueAtPath(doc, key);
		if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
			for (const [op, opVal] of Object.entries(cond as Record<string, unknown>)) {
				if (op === '$in') {
					if (!Array.isArray(opVal) || !opVal.includes(val)) return false;
				} else if (op === '$eq') {
					if (val !== opVal) return false;
				} else if (op === '$gte' || op === '$gt' || op === '$lte' || op === '$lt') {
					if (typeof val !== typeof opVal || val == null) return false;
					const cmp =
						typeof val === 'string'
							? collate(val, opVal as string)
							: (val as number) - (opVal as number);
					if (op === '$gte' && !(cmp >= 0)) return false;
					if (op === '$gt' && !(cmp > 0)) return false;
					if (op === '$lte' && !(cmp <= 0)) return false;
					if (op === '$lt' && !(cmp < 0)) return false;
				} else if (val !== cond) {
					return false;
				}
			}
		} else if (val !== cond) {
			return false;
		}
	}
	return true;
}

/** In-memory {@link Repository} for unit tests — no network. */
export function createInMemoryRepository(): Repository {
	const store = new Map<string, { _id: string; _rev?: string } & Record<string, unknown>>();

	const matchingDocs = (selector: Record<string, unknown>) =>
		[...store.values()].filter((d) => matchesSelector(d, selector));

	return {
		async put<T extends { _id: string }>(doc: T): Promise<T> {
			const existing = store.get(doc._id);
			const gen = existing?._rev
				? `${parseInt(String(existing._rev).split('-')[0], 10) + 1}-test`
				: '1-test';
			const saved = { ...doc, _rev: gen } as T;
			store.set(doc._id, saved);
			return saved;
		},

		async get<T extends { _id: string }>(id: string): Promise<T | null> {
			return (store.get(id) as T | undefined) ?? null;
		},

		async remove(doc: { _id: string }): Promise<void> {
			store.delete(doc._id);
		},

		async allByType<T extends { _id: string; type: string }>(
			type: string,
			guard: (d: unknown) => d is T
		): Promise<T[]> {
			return [...store.values()].filter((d): d is T => d._id.startsWith(`${type}:`) && guard(d));
		},

		async pageByType<T extends { _id: string; type: string }>(
			type: string,
			guard: (d: unknown) => d is T,
			page: number,
			pageSize: number
		): Promise<PaginatedResult<T>> {
			const matched = await this.allByType(type, guard);
			return paginateItems(matched, page, pageSize);
		},

		async find<T>(query: {
			selector: Record<string, unknown>;
			[key: string]: unknown;
		}): Promise<T[]> {
			return matchingDocs(query.selector) as unknown as T[];
		},

		async findPage<T>(query: {
			selector: Record<string, unknown>;
			[key: string]: unknown;
		}): Promise<FindPageResult<T>> {
			const limit = typeof query.limit === 'number' ? query.limit : 25;
			const offset = typeof query.bookmark === 'string' ? Number(query.bookmark) || 0 : 0;
			const matched = matchingDocs(query.selector).sort((a, b) => (a._id < b._id ? -1 : 1));
			const docs = matched.slice(offset, offset + limit) as unknown as T[];
			return { docs, bookmark: String(offset + docs.length) };
		},

		async bulkDocs<T extends { _id: string; _rev?: string }>(docs: T[]): Promise<T[]> {
			const savedDocs: T[] = [];
			for (const doc of docs) {
				savedDocs.push(await this.put(doc));
			}
			return savedDocs;
		}
	};
}
