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

/** Read the shelter-local override first, then fall back to the global master. */
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

function sameMasterDataItem(a: MasterDataItem, b: MasterDataItem): boolean {
	return (
		a.code === b.code &&
		a.label === b.label &&
		a.is_default === b.is_default &&
		(a.parent_code ?? null) === (b.parent_code ?? null)
	);
}

/**
 * Split the effective array sent by the UI into a shelter-local overlay.
 * Global items are not copied into the local document unless they were edited.
 */
export function splitMasterDataItems(
	items: readonly MasterDataItem[],
	globalDoc: MasterData | null
): { items: MasterDataItem[]; excludedCodes: string[] } {
	if (!globalDoc) return { items: [...items], excludedCodes: [] };

	const globalByCode = new Map(globalDoc.items.map((item) => [item.code, item]));
	const requestedCodes = new Set(items.map((item) => item.code));
	const localItems = items.filter((item) => {
		const globalItem = globalByCode.get(item.code);
		return !globalItem || !sameMasterDataItem(item, globalItem);
	});
	const excludedCodes = globalDoc.items
		.filter((item) => !requestedCodes.has(item.code))
		.map((item) => item.code);

	return { items: localItems, excludedCodes };
}

/** Resolve global + shelter-local items and expose source metadata for the UI. */
export function mergeMasterDataItems(
	globalDoc: MasterData | null,
	localDoc: MasterData | null,
	shelterCode?: string | null
): { items: MasterDataItem[]; itemSources: Record<string, MasterDataItemSource> } {
	const globalItems = globalDoc?.items ?? [];
	const localItems = localDoc?.items ?? [];
	const excluded = new Set(localDoc?.excluded_codes ?? []);
	const globalByCode = new Map(globalItems.map((item) => [item.code, item]));
	const localOverrides = new Map(
		localItems
			.filter((item) => {
				const globalItem = globalByCode.get(item.code);
				// Treat old local documents that copied an unchanged global item as global
				// during the transition; the next write will physically split the document.
				return !globalItem || !sameMasterDataItem(item, globalItem);
			})
			.map((item) => [item.code, item])
	);
	const items: MasterDataItem[] = [];
	const itemSources: Record<string, MasterDataItemSource> = {};

	for (const globalItem of globalItems) {
		if (excluded.has(globalItem.code)) continue;
		const localItem = localOverrides.get(globalItem.code);
		const resolved = localItem ?? globalItem;
		items.push(resolved);
		itemSources[resolved.code] = localItem
			? { scope: 'shelter', shelter_code: shelterCode ?? localDoc?.shelter_code ?? null }
			: { scope: 'global', shelter_code: null };
	}

	for (const localItem of localOverrides.values()) {
		if (globalByCode.has(localItem.code)) continue;
		items.push(localItem);
		itemSources[localItem.code] = {
			scope: 'shelter',
			shelter_code: shelterCode ?? localDoc?.shelter_code ?? null
		};
	}

	return { items, itemSources };
}
