import { createRemoteRepository } from '$lib/db/repository';
import { getShelterDb } from '$lib/db/shelter';
import type { EvacueeQrPrintRef } from '$lib/utils/evacuee-qr';

type EvacueeQrDoc = { _id: string; prints?: unknown };

/** `evacuee:{ULID}` -> `evacuee_qr:{ULID}` (CR-233 FR-EQR-8). */
export function evacueeQrDocId(evacueeId: string): string {
	return `evacuee_qr:${evacueeId.slice('evacuee:'.length)}`;
}

function toPrintRefs(prints: unknown): EvacueeQrPrintRef[] {
	if (!Array.isArray(prints)) return [];
	return prints.flatMap((p): EvacueeQrPrintRef[] => {
		const entry = p as { printed_at?: unknown; hash?: unknown } | null;
		return typeof entry?.printed_at === 'string' && typeof entry.hash === 'string'
			? [{ printed_at: entry.printed_at, hash: entry.hash.toLowerCase() }]
			: [];
	});
}

/**
 * Read-only: the `prints[]` log of `evacuee_qr:{ULID}` in the active shelter DB, in append order.
 * A missing doc is an empty log. Network / auth errors propagate: the scan rule must never fall
 * back to "valid" when the log could not be read.
 */
export async function readEvacueeQrPrints(
	evacueeId: string,
	shelterCode?: string
): Promise<EvacueeQrPrintRef[]> {
	const repo = createRemoteRepository(getShelterDb(shelterCode));
	const doc = await repo.get<EvacueeQrDoc>(evacueeQrDocId(evacueeId));
	return toPrintRefs(doc?.prints);
}
