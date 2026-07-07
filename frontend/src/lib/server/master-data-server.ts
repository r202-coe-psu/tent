import { adminRaw, ServiceError } from '$lib/server/couch-admin';
import type { MasterData, MasterDataType } from '$lib/features/master-data/domain';

const REGISTRY_DB = 'registry';

/**
 * Shared helper for master_data server endpoints. Reads one doc by type
 * from the registry. Returns `null` on 404 (doc doesn't exist yet);
 * throws {@link ServiceError} on unexpected errors.
 *
 * Do NOT import this into client bundles — `$lib/server/` is server-only.
 */
export async function readMasterDoc(type: MasterDataType): Promise<MasterData | null> {
	const id = `master_data:${type}`;
	const res = await adminRaw(`/${REGISTRY_DB}/${encodeURIComponent(id)}`, 'GET');
	if (res.status === 404) return null;
	if (res.status >= 400) {
		throw new ServiceError('INTERNAL', `Could not read master_data:${type}`);
	}
	return res.data as MasterData;
}
