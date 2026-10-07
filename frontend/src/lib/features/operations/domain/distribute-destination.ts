/**
 * Destination of a direct issue (CR-143 §E).
 *
 * A direct issue from the stock page has no `distribution_log` naming the
 * recipient, so the destination written to `lot.note` is the only trail an audit
 * has (FR-E1). The form offers the shelter's own places as one-tap chips (FR-E2).
 */

/** Longest destination the ledger note accepts (FR-E1). */
export const DISTRIBUTE_NOTE_MAX = 100;

/** The slice of a shelter storage point the chips need. */
export interface DestinationStoragePoint {
	name: string;
}

/** The slice of a shelter zone the chips need; a zone with no `status` counts as active. */
export interface DestinationZone {
	name: string;
	status?: string | null;
}

/**
 * Chip labels: the shelter's storage points, then its active zones, in form
 * order. Blank, duplicate (after trimming) and over-long names are left out — a
 * chip must always be savable as-is.
 */
export function listDestinationOptions(source: {
	storagePoints?: readonly DestinationStoragePoint[] | null;
	zones?: readonly DestinationZone[] | null;
}): string[] {
	const names = [
		...(source.storagePoints ?? []).map((p) => p.name),
		...(source.zones ?? []).filter((z) => (z.status ?? 'active') === 'active').map((z) => z.name)
	];
	const seen = new Set<string>();
	for (const raw of names) {
		const name = raw.trim();
		if (name !== '' && name.length <= DISTRIBUTE_NOTE_MAX) seen.add(name);
	}
	return [...seen];
}

/** `true` when the typed destination is not one of the chips — the "อื่นๆ" chip is then active. */
export function isCustomDestination(
	note: string | null | undefined,
	options: readonly string[]
): boolean {
	return !!note && !options.includes(note);
}
