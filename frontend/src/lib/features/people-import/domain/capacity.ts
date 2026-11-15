import { countPresentOccupantsByZone, type Evacuee } from '$lib/features/people';
import type { ImportZone, RowValidation } from './import-row';

/**
 * Non-blocking capacity notes for a Backfill Import (#1399).
 *
 * Anyone marked `พักอยู่` is already physically in the shelter, so exceeding the shelter's or a
 * zone's capacity is reported as a WARNING in the preview, never an error — refusing the row would
 * not move the person out. Pure: the caller passes the rows it is about to import.
 */

export interface CapacityInput {
	/** Rows that will actually be imported (valid, not skipped as duplicates). */
	rows: readonly RowValidation[];
	zones: readonly ImportZone[];
	/** Everyone already registered in the shelter — their present stays count towards capacity. */
	existing: readonly Evacuee[];
	/** The shelter's own capacity; null/undefined when unknown. */
	shelterCapacity?: number | null;
}

/** Thai warning lines, one per exceeded zone plus one for the shelter as a whole. */
export function capacityWarnings({
	rows,
	zones,
	existing,
	shelterCapacity
}: CapacityInput): string[] {
	const incoming = new Map<string, number>();
	let incomingTotal = 0;
	for (const row of rows) {
		if (!row.ok || !row.payload) continue;
		for (const stay of [row.payload.headStay, ...row.payload.members.map((m) => m.stay)]) {
			if (stay.status !== 'active') continue;
			incomingTotal += 1;
			if (stay.zone) incoming.set(stay.zone, (incoming.get(stay.zone) ?? 0) + 1);
		}
	}

	const warnings: string[] = [];
	const presentByZone = countPresentOccupantsByZone(existing);
	for (const zone of zones) {
		const adding = incoming.get(zone.code) ?? 0;
		if (adding === 0 || !zone.capacity) continue;
		const total = (presentByZone.get(zone.code) ?? 0) + adding;
		if (total > zone.capacity) {
			warnings.push(
				`โซน "${zone.name}" จะมีผู้พัก ${total} คน เกินความจุ ${zone.capacity} คน (นำเข้า ${adding} คน)`
			);
		}
	}

	if (shelterCapacity && incomingTotal > 0) {
		const present = [...presentByZone.values()].reduce((sum, n) => sum + n, 0);
		const total = present + incomingTotal;
		if (total > shelterCapacity) {
			warnings.push(
				`ศูนย์จะมีผู้พัก ${total} คน เกินความจุศูนย์ ${shelterCapacity} คน (นำเข้า ${incomingTotal} คน)`
			);
		}
	}
	return warnings;
}
