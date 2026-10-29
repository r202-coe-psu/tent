import {
	STATION_TABS,
	isDeskMode,
	modeOwningStep,
	type DeskMode,
	type StationTab
} from './desk-mode';

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
 * Must match `DeskFallbackHref` in `$lib/guards/auth.ts` (the guard does not import the feature);
 * a type check in `pool-url-state.test.ts` fails on drift.
 */
export type OnsiteDistributionHref =
	typeof ONSITE_DISTRIBUTION_PATH | `${typeof ONSITE_DISTRIBUTION_PATH}?${string}`;

/**
 * The whole desk URL, always written from the desk's state: `?mode=<m>&tab=<t>[&pool=<id>]`.
 * `pool` appears only on the returns tab with a pool open.
 */
export function onsiteDeskHref(state: {
	mode: DeskMode;
	tab: StationTab;
	pool?: string | null;
}): OnsiteDistributionHref {
	const base = `${ONSITE_DISTRIBUTION_PATH}?mode=${state.mode}&tab=${state.tab}` as const;
	return state.tab === 'returns' && state.pool
		? (`${base}&pool=${encodeURIComponent(state.pool)}` as const)
		: base;
}

/** Desk returns step (supplies mode), with `pool` appended when a pool id is given. */
export function onsiteReturnsHref(poolId: string | null): OnsiteDistributionHref {
	return onsiteDeskHref({ mode: 'supplies', tab: 'returns', pool: poolId });
}

/**
 * Read `mode` / `tab` / `pool` on the Distribution Desk. Unknown values are `null`; a blank `pool`
 * is `null`. A `pool` forces `tab=returns`, and a tab that exists in one mode only (`food`,
 * `supplies`, `returns`) forces that mode, whatever `?mode=` says. Otherwise a valid `?mode=` wins.
 */
export function parseOnsiteDistributionParams(params: URLSearchParams): {
	mode: DeskMode | null;
	tab: StationTab | null;
	pool: string | null;
} {
	const rawTab = params.get('tab');
	const rawMode = params.get('mode');
	const pool = params.get('pool')?.trim() || null;
	const tab: StationTab | null = pool
		? 'returns'
		: (STATION_TABS.find((t) => t === rawTab) ?? null);
	const mode = (tab ? modeOwningStep(tab) : null) ?? (isDeskMode(rawMode) ? rawMode : null);
	return { mode, tab, pool };
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
