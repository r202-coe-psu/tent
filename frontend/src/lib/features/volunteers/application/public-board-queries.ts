/**
 * TanStack Query hooks for the public job board (CONVENTIONS §7/§12): the board page for the
 * current filters (previous page stays on screen while the next loads) and the board-wide
 * summary counts.
 */
import { createQuery, keepPreviousData } from '@tanstack/svelte-query';
import {
	fetchPublicBoard,
	fetchPublicBoardSummary,
	type PublicBoardParams
} from '../data/public-board.api';

export const publicBoardKeys = {
	all: ['public-volunteer-board'] as const,
	page: (params: PublicBoardParams) => [...publicBoardKeys.all, 'page', params] as const,
	summary: () => [...publicBoardKeys.all, 'summary'] as const
};

export function usePublicBoard<Job = Record<string, unknown>>(params: () => PublicBoardParams) {
	return createQuery(() => {
		const current = params();
		return {
			queryKey: publicBoardKeys.page(current),
			queryFn: ({ signal }) => fetchPublicBoard<Job>(current, signal),
			placeholderData: keepPreviousData,
			// Seats move with every application; never serve a stale board from cache.
			staleTime: 0,
			gcTime: 60_000
		};
	});
}

export function usePublicBoardSummary() {
	return createQuery(() => ({
		queryKey: publicBoardKeys.summary(),
		queryFn: ({ signal }) => fetchPublicBoardSummary(signal),
		staleTime: 0,
		gcTime: 60_000
	}));
}
