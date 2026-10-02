import type { Shelter } from '$lib/features/shelters';

export interface DestinationOption {
	value: string;
	label: string;
}

export interface DestinationOptionGroups {
	zones: DestinationOption[];
	foodDistributionPoints: DestinationOption[];
}

/** UI-only sentinel for the "specify another destination" choice. Must never reach persistence. */
export const CUSTOM_DESTINATION_SENTINEL = '__CUSTOM__';

/**
 * Builds grouped destination options from shelter zones and food distribution points.
 * Preserves the original flat-list dedup order (zones checked before food points), so a
 * food distribution point sharing a display name with an already-listed zone is dropped
 * rather than shown twice — same option values Distribution has always persisted.
 */
export function buildDestinationOptionGroups(
	shelter: Pick<Shelter, 'zones' | 'food_distribution_points'> | undefined | null
): DestinationOptionGroups {
	const seen = new Set<string>();
	const zones: DestinationOption[] = [];
	const foodDistributionPoints: DestinationOption[] = [];

	for (const zone of shelter?.zones ?? []) {
		if (zone.name && !seen.has(zone.name)) {
			seen.add(zone.name);
			zones.push({ value: zone.name, label: zone.name });
		}
	}
	for (const point of shelter?.food_distribution_points ?? []) {
		if (point.name && !seen.has(point.name)) {
			seen.add(point.name);
			foodDistributionPoints.push({ value: point.name, label: point.name });
		}
	}

	return { zones, foodDistributionPoints };
}

/**
 * Resolves the final destination_location string to persist. The UI sentinel is never
 * returned — custom selection resolves to the trimmed manual text instead.
 */
export function resolveDestinationSelection(
	selection: string,
	customDestinationText: string
): string {
	if (selection === CUSTOM_DESTINATION_SENTINEL) {
		return customDestinationText.trim();
	}
	return selection.trim();
}
