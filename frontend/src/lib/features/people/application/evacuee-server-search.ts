import {
	parseEvacueeSearchQuery,
	type EvacueeSearchCursor,
	type EvacueeSearchPage
} from '../domain/evacuee-search';

/** The next page param, or `null` (stops TanStack paging) when every clause is exhausted. */
export const getNextEvacueeSearchPageParam = (
	last: EvacueeSearchPage
): EvacueeSearchCursor | null => last.nextCursor;

/** A blank query issues no request. */
export const isEvacueeSearchEnabled = (query: string): boolean =>
	parseEvacueeSearchQuery(query).kind !== 'empty';
