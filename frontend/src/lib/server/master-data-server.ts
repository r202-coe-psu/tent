import { adminRaw, ServiceError } from '$lib/server/couch-admin';
import { masterDocId } from '$lib/features/master-data/domain';
import type {
	MasterData,
	MasterDataItem,
	MasterDataItemSource,
	MasterDataType
} from '$lib/features/master-data/domain';

const REGISTRY_DB = 'registry';

/**
 * Shared helper for master_data server endpoints. Reads one doc by type
 * from the registry. Returns `null` on 404 (doc doesn't exist yet);
 * throws {@link ServiceError} on unexpected errors.
 *
 * Do NOT import this into client bundles — `$lib/server/` is server-only.
 */
export async function readMasterDoc(
	type: MasterDataType,
	shelterCode?: string | null
): Promise<MasterData | null> {
	const id = masterDocId(type, shelterCode);
	const res = await adminRaw(`/${REGISTRY_DB}/${encodeURIComponent(id)}`, 'GET');
	if (res.status === 404) return null;
	if (res.status >= 400) {
		throw new ServiceError('INTERNAL', `Could not read ${id}`);
	}
	return res.data as MasterData;
}

/** Read the global master doc plus the shelter-local doc and concat their items. */
export async function readEffectiveMasterDoc(
	type: MasterDataType,
	shelterCode?: string | null
): Promise<MasterData | null> {
	const global = await readMasterDoc(type);
	const local = shelterCode ? await readMasterDoc(type, shelterCode) : null;
	if (!global && !local) return null;
	const base = local ?? global!;
	return {
		...base,
		items: mergeMasterDataItems(global, local, shelterCode).items
	};
}

/**
 * Resolve the effective item list for a type/shelter as a simple concat:
 * global items first, then shelter-local items. Item codes are ULIDs
 * (domain-guaranteed disjoint between the global and shelter-local
 * documents), so no dedup / field comparison / excluded_codes bookkeeping is
 * needed. Items are returned as-is (active + inactive) — consumers filter by
 * status.
 */
export function mergeMasterDataItems(
	globalDoc: MasterData | null,
	localDoc: MasterData | null,
	shelterCode?: string | null
): { items: MasterDataItem[]; itemSources: Record<string, MasterDataItemSource> } {
	const globalItems = globalDoc?.items ?? [];
	const localItems = localDoc?.items ?? [];
	const resolvedShelterCode = shelterCode ?? localDoc?.shelter_code ?? null;

	const itemSources: Record<string, MasterDataItemSource> = {};
	for (const item of globalItems) {
		itemSources[item.code] = { scope: 'global', shelter_code: null };
	}
	for (const item of localItems) {
		itemSources[item.code] = { scope: 'shelter', shelter_code: resolvedShelterCode };
	}

	return { items: [...globalItems, ...localItems], itemSources };
}
