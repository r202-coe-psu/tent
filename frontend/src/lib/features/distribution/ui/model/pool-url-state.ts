/** Query keys owned by the distribution back-office view switch / pool deep link. */
export const POOL_PARAM_KEYS = ['view', 'pool'] as const;

export type DistributionView = 'tickets' | 'bulk_pools';

export interface PoolUrlState {
	view: DistributionView;
	/** Open pool id, `null` when none (only meaningful in the `bulk_pools` view). */
	pool: string | null;
}

export const DISTRIBUTION_BACK_OFFICE_PATH = '/back-office/distribution';

/** Read `view` / `pool`. A `pool` param implies the pools view; unknown `view` falls back to tickets. */
export function parsePoolParams(params: URLSearchParams): PoolUrlState {
	const pool = params.get('pool')?.trim() || null;
	const view: DistributionView =
		params.get('view') === 'bulk_pools' || pool ? 'bulk_pools' : 'tickets';
	return { view, pool: view === 'bulk_pools' ? pool : null };
}

/** `base` with `view` / `pool` replaced by `state`'s; every other key is kept as-is. */
export function mergePoolParams(base: URLSearchParams, state: PoolUrlState): URLSearchParams {
	const out = new URLSearchParams(base);
	for (const key of POOL_PARAM_KEYS) out.delete(key);
	if (state.view === 'bulk_pools') {
		out.set('view', 'bulk_pools');
		if (state.pool) out.set('pool', state.pool);
	}
	return out;
}

/** Deep link to one ticket on the distribution back-office page. */
export function ticketHref(ticketId: string): string {
	return `${DISTRIBUTION_BACK_OFFICE_PATH}?ticketId=${encodeURIComponent(ticketId)}`;
}

/** Deep link to one bulk return pool on the distribution back-office page. */
export function bulkReturnPoolHref(poolId: string): string {
	return `${DISTRIBUTION_BACK_OFFICE_PATH}?view=bulk_pools&pool=${encodeURIComponent(poolId)}`;
}

/** Distribution Desk (Station 4) page — the pool link target for staff without back-office access. */
export const ONSITE_DISTRIBUTION_PATH = '/onsite/distribution';

/**
 * Desk href with an optional query string (typed so route code can pass it to `resolve`).
 * Must match `DeskFallbackHref` in `$lib/guards/auth.ts` (the guard does not import the feature).
 */
export type OnsiteDistributionHref =
	typeof ONSITE_DISTRIBUTION_PATH | `${typeof ONSITE_DISTRIBUTION_PATH}?${string}`;

export const FRONTLINE_TABS = ['receive', 'food', 'supplies', 'returns', 'reconciliation'] as const;

/** Tabs of the Distribution Desk (`?tab=`). */
export type FrontlineTab = (typeof FRONTLINE_TABS)[number];

/** Desk returns tab, with `pool` appended when a pool id is given. */
export function onsiteReturnsHref(poolId: string | null): OnsiteDistributionHref {
	const base = `${ONSITE_DISTRIBUTION_PATH}?tab=returns` as const;
	return poolId ? (`${base}&pool=${encodeURIComponent(poolId)}` as const) : base;
}

/**
 * Read `tab` / `pool` on the Distribution Desk. Unknown `tab` is `null`; a blank `pool` is `null`.
 * A present `pool` always forces the `returns` tab (pools live only there), whatever `tab` says.
 */
export function parseOnsiteDistributionParams(params: URLSearchParams): {
	tab: FrontlineTab | null;
	pool: string | null;
} {
	const rawTab = params.get('tab');
	const pool = params.get('pool')?.trim() || null;
	const tab = pool ? 'returns' : (FRONTLINE_TABS.find((t) => t === rawTab) ?? null);
	return { tab, pool };
}

/** `base` with the desk `tab` set; `pool` is dropped unless `returns`. Other keys are kept. */
export function mergeOnsiteTabParam(base: URLSearchParams, tab: FrontlineTab): URLSearchParams {
	const out = new URLSearchParams(base);
	out.set('tab', tab);
	if (tab !== 'returns') out.delete('pool');
	return out;
}

/** `base` with the desk `pool` param set (and `tab=returns`) or removed; other keys are kept. */
export function mergeOnsitePoolParam(
	base: URLSearchParams,
	poolId: string | null
): URLSearchParams {
	const out = new URLSearchParams(base);
	if (poolId) {
		out.set('tab', 'returns');
		out.set('pool', poolId);
	} else {
		out.delete('pool');
	}
	return out;
}

/**
 * Desk href to use when a user cannot open the back office but follows a pool link
 * (`?view=bulk_pools` or `?pool=`). `null` when the params are not a pool link.
 */
export function deskFallbackForBackOfficeParams(
	params: URLSearchParams
): OnsiteDistributionHref | null {
	const { view, pool } = parsePoolParams(params);
	return view === 'bulk_pools' ? onsiteReturnsHref(pool) : null;
}
