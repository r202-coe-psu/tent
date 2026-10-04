import type { StockSort, StockStatusFilter } from './stock-view';

/** Query keys owned by the stock table. Anything else (`tab`, `action`, …) is left alone. */
export const STOCK_PARAM_KEYS = ['q', 'cat', 'loc', 'status', 'sort', 'page', 'all'] as const;

export const STOCK_PAGE_SIZE = 25;

export interface StockUrlState {
	q: string;
	cat: string;
	loc: string;
	status: StockStatusFilter | 'all';
	sort: StockSort;
	page: number;
	all: boolean;
}

export const STOCK_URL_DEFAULTS: StockUrlState = {
	q: '',
	cat: 'all',
	loc: 'all',
	status: 'all',
	sort: 'urgency',
	page: 1,
	all: false
};

const STATUSES: readonly StockStatusFilter[] = ['expired', 'empty', 'low', 'expiring'];
const SORTS: readonly StockSort[] = ['urgency', 'name', 'qty'];

/** Read the stock table state; unknown or malformed values fall back to the defaults. */
export function parseStockParams(params: URLSearchParams): StockUrlState {
	const status = params.get('status');
	const sort = params.get('sort');
	const page = Number(params.get('page'));
	return {
		q: params.get('q') ?? STOCK_URL_DEFAULTS.q,
		cat: params.get('cat') || STOCK_URL_DEFAULTS.cat,
		loc: params.get('loc') || STOCK_URL_DEFAULTS.loc,
		status: STATUSES.includes(status as StockStatusFilter)
			? (status as StockStatusFilter)
			: STOCK_URL_DEFAULTS.status,
		sort: SORTS.includes(sort as StockSort) ? (sort as StockSort) : STOCK_URL_DEFAULTS.sort,
		page: Number.isInteger(page) && page >= 1 ? page : STOCK_URL_DEFAULTS.page,
		all: params.get('all') === '1'
	};
}

/** Only the non-default stock keys. */
export function serializeStockParams(state: StockUrlState): URLSearchParams {
	const out = new URLSearchParams();
	if (state.q.trim()) out.set('q', state.q.trim());
	if (state.cat !== STOCK_URL_DEFAULTS.cat) out.set('cat', state.cat);
	if (state.loc !== STOCK_URL_DEFAULTS.loc) out.set('loc', state.loc);
	if (state.status !== STOCK_URL_DEFAULTS.status) out.set('status', state.status);
	if (state.sort !== STOCK_URL_DEFAULTS.sort) out.set('sort', state.sort);
	if (state.page > 1) out.set('page', String(state.page));
	if (state.all) out.set('all', '1');
	return out;
}

/** `base` with its stock keys replaced by `state`'s — every other key is kept as-is. */
export function mergeStockParams(base: URLSearchParams, state: StockUrlState): URLSearchParams {
	const out = new URLSearchParams(base);
	for (const key of STOCK_PARAM_KEYS) out.delete(key);
	for (const [key, value] of serializeStockParams(state)) out.set(key, value);
	return out;
}
