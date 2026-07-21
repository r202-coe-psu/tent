import { adminRaw, ServiceError } from '$lib/server/couch-admin';
import { masterDocId } from '$lib/features/master-data/domain';
import type { MasterData, MasterDataType } from '$lib/features/master-data/domain';

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
	if (shelterCode) {
		const local = await readMasterDoc(type, shelterCode);
		if (local) return local;
	}
	return readMasterDoc(type);
}
