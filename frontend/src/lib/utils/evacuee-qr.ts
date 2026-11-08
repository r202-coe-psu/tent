/**
 * Person QR (CR-233): `evacuee:{ULID}` (legacy, no `@`) or `evacuee:{ULID}@{hash6}`.
 *
 * Pure + synchronous — NO hashing here (FR-EQR-28/29): the scanned `hash6` is compared with the
 * `prints[].hash` the server stored. Usable on http LAN where `crypto.subtle` is unavailable.
 */

export const EVACUEE_QR_SOURCES = [
	'kiosk_checkin',
	'kiosk_reprint',
	'profile',
	'family_batch'
] as const;
export type EvacueeQrSource = (typeof EVACUEE_QR_SOURCES)[number];

/** Subset of an `evacuee_qr.prints[]` entry the scan rule needs. */
export type EvacueeQrPrintRef = { printed_at: string; hash: string };

// Crockford base32 ULID: first char 0-7, no I L O U.
const ULID = '[0-7][0-9A-HJKMNP-TV-Z]{25}';
const PERSON_QR = new RegExp(`^evacuee:(${ULID})(?:@([0-9a-f]{6}))?$`, 'i');
const HAS_AT = /^evacuee:[^@]*@/i;

export type ParsedPersonQr = {
	/** `evacuee:{ULID}` — never contains `@` (FR-EQR-6). */
	evacuee_id: string;
	/** lowercase hex6, or `null` for a legacy payload without `@`. */
	hash6: string | null;
};

/**
 * Parse a Person QR. Returns `null` when the text is not a Person QR — including a payload with `@`
 * whose suffix is not `[0-9a-f]{6}` (FR-EQR-5: malformed, not "expired").
 */
export function parsePersonQr(text: string): ParsedPersonQr | null {
	const m = PERSON_QR.exec(text.trim());
	if (!m) return null;
	return { evacuee_id: `evacuee:${m[1].toUpperCase()}`, hash6: m[2] ? m[2].toLowerCase() : null };
}

/** True for any text that starts like a Person QR (`evacuee:`), valid or malformed. */
export function looksLikePersonQr(text: string): boolean {
	return /^evacuee:/i.test(text.trim()) || HAS_AT.test(text.trim());
}

export type PersonQrVerdict =
	| { status: 'valid' }
	| { status: 'expired'; issued_at: string | null; current_printed_at: string }
	| { status: 'invalid' };

/** The 5-row scan rule of FR-EQR-27. `prints` is the stored log in append order (may be empty). */
export function evaluatePersonQr(
	hash6: string | null,
	prints: readonly EvacueeQrPrintRef[]
): PersonQrVerdict {
	const last = prints[prints.length - 1];
	if (hash6 === null) {
		return last
			? { status: 'expired', issued_at: null, current_printed_at: last.printed_at }
			: { status: 'valid' };
	}
	if (!last) return { status: 'invalid' };
	const wanted = hash6.toLowerCase();
	if (last.hash === wanted) return { status: 'valid' };
	const older = prints.find((p) => p.hash === wanted);
	if (older) {
		return { status: 'expired', issued_at: older.printed_at, current_printed_at: last.printed_at };
	}
	return { status: 'invalid' };
}

function formatBangkok(iso: string): string {
	return new Intl.DateTimeFormat('th-TH', {
		timeZone: 'Asia/Bangkok',
		dateStyle: 'medium',
		timeStyle: 'short'
	}).format(new Date(iso));
}

/** FR-EQR-33/34/35 copy — dates only, no personal data. */
export function personQrVerdictMessage(
	verdict: Exclude<PersonQrVerdict, { status: 'valid' }>
): string {
	if (verdict.status === 'invalid') return 'QR ไม่ถูกต้อง';
	const current = formatBangkok(verdict.current_printed_at);
	if (verdict.issued_at === null) {
		return `QR นี้ออกก่อนเปลี่ยนระบบ มีใบใหม่วันที่ ${current} กรุณาใช้ QR ใบล่าสุดหรือติดต่อเจ้าหน้าที่`;
	}
	return `QR นี้ออกวันที่ ${formatBangkok(verdict.issued_at)} มีใบใหม่วันที่ ${current} กรุณาใช้ QR ใบล่าสุดหรือติดต่อเจ้าหน้าที่`;
}
