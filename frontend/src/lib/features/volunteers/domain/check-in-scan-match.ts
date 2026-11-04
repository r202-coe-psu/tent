/**
 * Decides whether a scanned volunteer credential is the person staff are about to check in.
 * Pure — the check-in dialog resolves the scan to a volunteer first and only ever writes on
 * `match`, so a QR belonging to someone else can never check the wrong person in.
 */
import type { Volunteer } from './volunteer.schema';

export type ScannedVolunteer = Pick<
	Volunteer,
	'_id' | 'volunteer_code' | 'first_name' | 'last_name'
>;

export type CheckInScanMatch =
	| { kind: 'match' }
	| { kind: 'mismatch'; scannedName: string; scannedCode: string }
	| { kind: 'unknown' };

/** `scanned` is `null` when the QR is not a volunteer credential or matches no volunteer. */
export function matchCheckInScan(
	expectedVolunteerId: string,
	scanned: ScannedVolunteer | null
): CheckInScanMatch {
	if (!scanned) return { kind: 'unknown' };
	if (scanned._id === expectedVolunteerId) return { kind: 'match' };
	return {
		kind: 'mismatch',
		scannedName: `${scanned.first_name} ${scanned.last_name}`.trim(),
		scannedCode: scanned.volunteer_code
	};
}
