import type { PaginatedResult, Repository } from './repository';

/** In-memory {@link Repository} for unit tests — no network. */
export function createInMemoryRepository(): Repository {
	const store = new Map<string, { _id: string; _rev?: string } & Record<string, unknown>>();

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
			const total = matched.length;
			const totalPages = Math.max(1, Math.ceil(total / pageSize));
			const safePage = Math.max(1, Math.min(page, totalPages));
			const start = (safePage - 1) * pageSize;
			return {
				items: matched.slice(start, start + pageSize),
				total,
				page: safePage,
				pageSize,
				totalPages
			};
		}
	};
}
