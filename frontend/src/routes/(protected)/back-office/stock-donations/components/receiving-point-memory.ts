/**
 * The scan station's "จุดที่ประจำ" (CR-206 FR-MP-18), remembered per shelter on this device —
 * not on the user's account. UI-only convenience: every access is guarded, so unavailable
 * storage just means staff pick the point again.
 */

export function receivingPointKey(shelterCode: string): string {
	return `stock-donations:receiving-point:${shelterCode}`;
}

/** The point last picked at this shelter on this device, or `null`. */
export function readReceivingPoint(shelterCode: string): string | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		return localStorage.getItem(receivingPointKey(shelterCode)) || null;
	} catch {
		return null;
	}
}

/** Remember (or forget, with `null`) the point; silently skipped when storage is unavailable. */
export function writeReceivingPoint(shelterCode: string, pointId: string | null): void {
	if (typeof localStorage === 'undefined') return;
	try {
		if (pointId) localStorage.setItem(receivingPointKey(shelterCode), pointId);
		else localStorage.removeItem(receivingPointKey(shelterCode));
	} catch {
		/* ignore quota / private mode */
	}
}
