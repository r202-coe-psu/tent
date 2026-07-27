import { serviceFetch } from '$lib/api/service';
import { getShelterCode } from '$lib/db/shelter';
import type {
	MasterData,
	MasterDataItem,
	MasterDataItemSource,
	MasterDataQueryContext,
	MasterDataScope,
	MasterDataType
} from '../domain/master-data';

/**
 * Master Data Engine — service plane client (CR-010).
 *
 * Talks to `/api/back-office/master-data/*` (admin-only server BFF). SA-only
 * writes; reads are open to any authenticated user (Phase 2 will widen the
 * surface to `/api/v1/*` for forms).
 *
 * Errors propagate as thrown `Error` from `serviceFetch`; the UI toasts the
 * message. No console.log — the service plane uses toast notifications only.
 */

const BASE = '/api/back-office/master-data';

export type MasterDataSummary = Pick<
	MasterData,
	'_id' | 'master_type' | 'items' | 'shelter_code'
> & {
	scope?: MasterDataScope;
	source_shelter_code?: string | null;
	item_sources?: Record<string, MasterDataItemSource>;
};

function effectiveContext(context?: MasterDataQueryContext): Required<
	Pick<MasterDataQueryContext, 'scope'>
> & {
	shelterCode?: string;
} {
	const scope = context?.scope ?? 'effective';
	const shelterCode =
		context?.shelterCode ?? (scope === 'effective' ? getShelterCode() : undefined);
	return { scope, ...(shelterCode ? { shelterCode } : {}) };
}

function queryString(context?: MasterDataQueryContext): string {
	const resolved = effectiveContext(context);
	const params = new URLSearchParams({ scope: resolved.scope });
	if (resolved.shelterCode) params.set('shelter_code', resolved.shelterCode);
	return `?${params.toString()}`;
}

export function listMasters(context?: MasterDataQueryContext): Promise<MasterDataSummary[]> {
	return serviceFetch<MasterDataSummary[]>(`${BASE}${queryString(context)}`);
}

export function getMaster(
	type: MasterDataType,
	context?: MasterDataQueryContext
): Promise<MasterDataSummary> {
	return serviceFetch<MasterDataSummary>(
		`${BASE}/${encodeURIComponent(type)}${queryString(context)}`
	);
}

export function putMaster(
	type: MasterDataType,
	items: readonly MasterDataItem[],
	context: MasterDataQueryContext = { scope: 'global' },
	/** Per-shelter disable list for GLOBAL items (CR-049 amendment). Pass to
	 *  update it (a global-item toggle); omit for a normal shelter-local edit. */
	disabledGlobalCodes?: readonly string[],
	/** Shelter's chosen GLOBAL default (CR-049 amendment). Pass the global
	 *  item's code to set it, `null` to clear it (revert to the global doc's
	 *  own `is_default`), or omit to leave the current pointer untouched. */
	defaultGlobalCode?: string | null
): Promise<{ ok: true; rev: string }> {
	const resolved = effectiveContext(context);
	return serviceFetch(`${BASE}/${encodeURIComponent(type)}${queryString(context)}`, {
		method: 'PUT',
		body: JSON.stringify({
			items,
			...(resolved.shelterCode ? { shelter_code: resolved.shelterCode } : {}),
			...(disabledGlobalCodes ? { disabled_global_codes: disabledGlobalCodes } : {}),
			...(defaultGlobalCode !== undefined ? { default_global_code: defaultGlobalCode } : {})
		}),
		headers: { 'content-type': 'application/json' }
	});
}
