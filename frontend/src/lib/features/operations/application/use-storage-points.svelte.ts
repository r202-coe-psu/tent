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
		 * True only when the shelter query succeeded with data: the points list is then
		 * authoritative, so a missing id can safely be treated as a deleted point.
		 */
		get isLoaded() {
			return shelterQuery.isSuccess && shelterQuery.data != null;
		}
	};
}
