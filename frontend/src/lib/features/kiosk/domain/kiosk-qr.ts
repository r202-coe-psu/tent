/**
 * What a scanned kiosk QR means. Two printed codes are accepted: the evacuee card
 * (`evacuee:{ULID}`) and the unassigned-registration ticket (a bare ULID, the registration id).
 */
export type KioskQr =
	| { kind: 'evacuee'; token: string }
	| { kind: 'registration'; registration_id: string }
	| { kind: 'invalid' };

// Crockford base32 ULID: first char 0-7 (48-bit timestamp), no I L O U.
const ULID = '[0-7][0-9A-HJKMNP-TV-Z]{25}';
const EVACUEE_QR = new RegExp(`^evacuee:(${ULID})$`, 'i');
const REGISTRATION_QR = new RegExp(`^${ULID}$`, 'i');

export function parseKioskQr(text: string): KioskQr {
	const trimmed = text.trim();
	const evacuee = EVACUEE_QR.exec(trimmed);
	if (evacuee) return { kind: 'evacuee', token: `evacuee:${evacuee[1].toUpperCase()}` };
	if (REGISTRATION_QR.test(trimmed)) {
		return { kind: 'registration', registration_id: trimmed.toUpperCase() };
	}
	return { kind: 'invalid' };
}
