import { listDonationPoints, useShelter } from '$lib/features/shelters';
import type { NeedDropOffPointOption } from '../domain/need-drop-off-point';

/**
 * The shelter's current donation drop-off points (CR-205: ticked `accepts_donations`
 * with a pin) — the options for a campaign need's "จุดรับบริจาค". Reads the shelter doc
 * through the shared detail query.
 */
export function useDonationPoints(shelterCode: () => string) {
	const shelterQuery = useShelter(shelterCode);
	const points = $derived<NeedDropOffPointOption[]>(
		listDonationPoints(shelterQuery.data).map((p) => ({ id: p.id, name: p.name.trim() }))
	);
	return {
		get points() {
			return points;
		},
		/** False until the shelter doc has been read; saving before then would store `null`. */
		get isLoaded() {
			return shelterQuery.data != null;
		}
	};
}
