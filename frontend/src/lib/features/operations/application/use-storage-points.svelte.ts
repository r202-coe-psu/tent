import { listStoragePoints, subStorageTypeLabels, useShelter } from '$lib/features/shelters';
import type { StoragePointRef } from '../domain/lot-storage';

/**
 * The shelter's storage points ("จุดเก็บของ", `common_areas.sub_storage`) — the
 * options for "สถานที่จัดเก็บ" and the names used to label ledger lots
 * (draft-shelter-storage-points). Read through the shelter detail query, so it
 * shares that cache and live updates.
 */
export function useStoragePoints(shelterCode: () => string) {
	const shelterQuery = useShelter(shelterCode);
	const points = $derived<StoragePointRef[]>(
		listStoragePoints(shelterQuery.data).map((p) => ({
			id: p.id,
			name: p.name.trim(),
			typeLabels: subStorageTypeLabels(p.types ?? [])
		}))
	);
	return {
		get points() {
			return points;
		},
		get isLoading() {
			return shelterQuery.isLoading;
		},
		/**
		 * True once the shelter doc has been read (the last successful data is kept through
		 * a failed refetch), so the points list is authoritative and a missing id can be
		 * treated as deleted.
		 */
		get isLoaded() {
			return shelterQuery.data != null;
		}
	};
}
