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

/**
 * Every shelter-local doc of one type (`master_data:{type}:{shelter_code}`),
 * via an `_all_docs` prefix scan — no Mango index required, same pattern as the
 * donation/public readers. The trailing `￰` is CouchDB's high sentinel, so
 * the range covers exactly the ids that carry a shelter suffix and never the
 * global `master_data:{type}` doc itself.
 *
 * Used by the label-uniqueness gate (CR-078) to check a GLOBAL write against
 * every shelter's list. Do NOT import into client bundles.
 */
export async function readShelterMasterDocs(type: MasterDataType): Promise<MasterData[]> {
	const prefix = `${masterDocId(type)}:`;
	const res = await adminRaw(
		`/${REGISTRY_DB}/_all_docs?include_docs=true&startkey="${prefix}"&endkey="${prefix}￰"`,
		'GET'
	);
	if (res.status >= 400) {
		throw new ServiceError('INTERNAL', `Could not list shelter master data for ${type}`);
	}
	const rows = (res.data as { rows?: { doc?: MasterData | null }[] })?.rows ?? [];
	return rows.map((r) => r.doc).filter((d): d is MasterData => !!d && Array.isArray(d.items));
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
 * documents), so no dedup / field comparison is needed.
 *
 * Per-shelter override (CR-049 amendment): a global item whose code is in the
 * shelter-local `disabled_global_codes` is returned with `status: 'inactive'`
 * for THIS shelter and tagged `shelter_disabled: true` in its source — the
 * global doc is never mutated. Consumers filter by the resolved `status`, so
 * no consumer change is needed.
 */
export function mergeMasterDataItems(
	globalDoc: MasterData | null,
	localDoc: MasterData | null,
	shelterCode?: string | null
): { items: MasterDataItem[]; itemSources: Record<string, MasterDataItemSource> } {
	const globalItems = globalDoc?.items ?? [];
	const localItems = localDoc?.items ?? [];
	const resolvedShelterCode = shelterCode ?? localDoc?.shelter_code ?? null;
	const disabled = new Set(localDoc?.disabled_global_codes ?? []);

	const itemSources: Record<string, MasterDataItemSource> = {};
	const globalResolved = globalItems.map((item) => {
		const isDisabledHere = disabled.has(item.code);
		itemSources[item.code] = {
			scope: 'global',
			shelter_code: null,
			shelter_disabled: isDisabledHere
		};
		// One-directional: a shelter can only deactivate an active global item;
		// a globally-inactive item stays inactive regardless.
		return isDisabledHere && item.status === 'active'
			? { ...item, status: 'inactive' as const }
			: item;
	});
	for (const item of localItems) {
		itemSources[item.code] = { scope: 'shelter', shelter_code: resolvedShelterCode };
	}

	// Each tier runs enforceOneDefault independently, so the concat can carry two
	// `is_default` items (one global, one shelter-local). Resolve to a single
	// effective default: a shelter-local default supersedes the global one, and
	// an inactive/per-shelter-disabled item can never be the default. Clear the
	// flag on every other item so consumers never see two defaults. (CR-049)
	//
	// CR-049 amendment: a shelter may also point at a NON-default GLOBAL item as
	// its default (`default_global_code`) without touching the global doc's own
	// `is_default`/`label`. That pointer only wins when the target global item
	// resolves active for this shelter; otherwise fall back to the global item
	// flagged `is_default`.
	const effectiveItems = [...globalResolved, ...localItems];
	const localDefault = localItems.find((i) => i.is_default && i.status === 'active');
	const pointedGlobal = localDoc?.default_global_code
		? globalResolved.find((i) => i.code === localDoc.default_global_code && i.status === 'active')
		: undefined;
	const globalDefault = globalResolved.find((i) => i.is_default && i.status === 'active');
	const globalDefaultForShelter = pointedGlobal ?? globalDefault;
	const chosenCode = (localDefault ?? globalDefaultForShelter)?.code;
	const items = effectiveItems.map((i) => ({ ...i, is_default: i.code === chosenCode }));

	return { items, itemSources };
}
