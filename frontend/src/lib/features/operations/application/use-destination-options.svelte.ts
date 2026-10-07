import { listStoragePoints, useShelter } from '$lib/features/shelters';
import { listDestinationOptions } from '../domain/distribute-destination';

/**
 * Chip labels for "เบิกให้ใคร / ไปที่ไหน" on a direct issue (CR-143 FR-E2): the
 * shelter's storage points and zones. Read through the shelter detail query, so
 * it shares that cache with `useStoragePoints`.
 */
export function useDestinationOptions(shelterCode: () => string) {
	const shelterQuery = useShelter(shelterCode);
	const options = $derived(
		listDestinationOptions({
			storagePoints: listStoragePoints(shelterQuery.data),
			zones: shelterQuery.data?.zones
		})
	);
	return {
		get options() {
			return options;
		},
		get isLoading() {
			return shelterQuery.isLoading;
		}
	};
}
