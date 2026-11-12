import type { VulnerabilityMarker } from '$lib/utils/vulnerability-marker';

/**
 * The printed QR card is stale when the evacuee's current vulnerability level differs from the
 * level on the latest printed card (CR-233 FR-EQR-57). The latest card is the last `prints[]`
 * entry (append order, FR-EQR-11); a legacy entry without `marker` counts as no level. Never
 * printed -> not stale.
 */
export function isQrCardStale(
	current: VulnerabilityMarker | null,
	prints: readonly { printed_at: string; marker?: VulnerabilityMarker | null }[]
): boolean {
	const latest = prints.at(-1);
	if (!latest) return false;
	return current !== (latest.marker ?? null);
}
