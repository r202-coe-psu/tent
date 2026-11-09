/**
 * What a scanned kiosk QR means. Two printed codes are accepted: the evacuee card
 * (`evacuee:{ULID}` or `evacuee:{ULID}@{hash6}`) and the unassigned-registration ticket (a bare ULID, the registration id).
 */
export type KioskQr =
	| { kind: 'evacuee'; token: string; hash6: string | null }
	| { kind: 'registration'; registration_id: string }
	| { kind: 'invalid' };

// Crockford base32 ULID: first char 0-7 (48-bit timestamp), no I L O U.
const ULID = '[0-7][0-9A-HJKMNP-TV-Z]{25}';
// `evacuee:{ULID}` or `evacuee:{ULID}@{hex6}` (CR-233). Any other `@` suffix is malformed.
const EVACUEE_QR = new RegExp(`^evacuee:(${ULID})(?:@([0-9a-f]{6}))?$`, 'i');
const REGISTRATION_QR = new RegExp(`^${ULID}$`, 'i');

export function parseKioskQr(text: string): KioskQr {
	const trimmed = text.trim();
	const evacuee = EVACUEE_QR.exec(trimmed);
	if (evacuee) {
		return {
			kind: 'evacuee',
			token: `evacuee:${evacuee[1].toUpperCase()}`,
			hash6: evacuee[2] ? evacuee[2].toLowerCase() : null
		};
	}
	if (REGISTRATION_QR.test(trimmed)) {
		return { kind: 'registration', registration_id: trimmed.toUpperCase() };
	}
	return { kind: 'invalid' };
}
