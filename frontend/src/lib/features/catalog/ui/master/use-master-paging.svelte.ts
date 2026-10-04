import { clampPage, MASTER_PAGE_SIZE } from './master-view';

/**
 * Page state for a filtered list. The page goes back to 1 whenever `getKey()` (the
 * filter state, serialised) changes, and is clamped when the row count shrinks.
 */
export function useMasterPaging(
	getKey: () => string,
	getCount: () => number,
	perPage: number = MASTER_PAGE_SIZE
) {
	let state = $state({ key: '', page: 1 });
	const page = $derived(clampPage(state.key === getKey() ? state.page : 1, getCount(), perPage));
	return {
		get page() {
			return page;
		},
		set page(next: number) {
			state = { key: getKey(), page: next };
		},
		perPage
	};
}
