import type { PaginatedResult } from './repository';

/**
 * Slice an in-memory list into a {@link PaginatedResult}.
 * Page is clamped into `[1, totalPages]` (totalPages is at least 1).
 */
export function paginateItems<T>(items: T[], page: number, pageSize: number): PaginatedResult<T> {
	const total = items.length;
	const totalPages = Math.max(1, Math.ceil(total / pageSize));
	const safePage = clampPage(page, totalPages);
	const start = (safePage - 1) * pageSize;
	return {
		items: items.slice(start, start + pageSize),
		total,
		page: safePage,
		pageSize,
		totalPages
	};
}

/** Clamp `page` into `[1, totalPages]`. */
export function clampPage(page: number, totalPages: number): number {
	const max = Math.max(1, totalPages);
	return Math.max(1, Math.min(page, max));
}
