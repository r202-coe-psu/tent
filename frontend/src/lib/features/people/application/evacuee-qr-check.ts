/**
 * Staff-side Person QR scan rule (CR-233 FR-EQR-27..29, 34): read the stored `prints[]` log and
 * evaluate it with the pure rule. No hashing: the scanned hash6 is compared with stored hashes.
 */
import {
	evaluatePersonQr,
	personQrVerdictMessage,
	type EvacueeQrPrintRef,
	type ParsedPersonQr,
	type PersonQrVerdict
} from '$lib/utils/evacuee-qr';
import { readEvacueeQrPrints } from '../data/evacuee-qr.remote';

export type EvacueeQrPrintsReader = (evacueeId: string) => Promise<readonly EvacueeQrPrintRef[]>;

/**
 * Verdict for a scanned Person QR. The reader's errors (offline, auth) propagate on purpose:
 * callers show their existing error/disconnected handling, never a "valid" fallback.
 */
export async function checkPersonQr(
	parsed: ParsedPersonQr,
	readPrints: EvacueeQrPrintsReader = readEvacueeQrPrints
): Promise<PersonQrVerdict> {
	return evaluatePersonQr(parsed.hash6, await readPrints(parsed.evacuee_id));
}

/** FR-EQR-33/34: shared copy plus the staff hint to search by name. Dates only (FR-EQR-35). */
export function staffPersonQrRejectionMessage(
	verdict: Exclude<PersonQrVerdict, { status: 'valid' }>
): string {
	return `${personQrVerdictMessage(verdict)} — ลองค้นหาด้วยชื่อแทน`;
}
