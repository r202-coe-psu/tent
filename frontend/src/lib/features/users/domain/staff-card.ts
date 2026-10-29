import { extractScanCode } from '$lib/utils/scan-code';

export const STAFF_TOKEN_PREFIX = 'TKT-STF-';
export const STAFF_TOKEN_HASH_PREFIX = 'TKT-STF-HASH-';
export const STAFF_TOKEN_RANDOM_BYTES = 16;

export function formatStaffToken(bytes: Uint8Array): string {
	if (bytes.length !== STAFF_TOKEN_RANDOM_BYTES) {
		throw new RangeError(
			`staff token needs ${STAFF_TOKEN_RANDOM_BYTES} bytes, got ${bytes.length}`
		);
	}
	const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
	return STAFF_TOKEN_PREFIX + hex.toUpperCase();
}

export function isValidStaffTokenHash(v: unknown): v is string {
	return typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
}

/** The card QR carries the hash, never the plaintext token: the hash itself is the bearer. */
export function staffCardPayloadFromHash(hash: string): string {
	return STAFF_TOKEN_HASH_PREFIX + hash;
}

export function parseStaffCardPayload(raw: string): { hash: string } | null {
	const code = extractScanCode(raw);
	if (!code.toUpperCase().startsWith(STAFF_TOKEN_HASH_PREFIX)) return null;
	const hash = code.slice(STAFF_TOKEN_HASH_PREFIX.length).toLowerCase();
	return isValidStaffTokenHash(hash) ? { hash } : null;
}

const STAFF_RECIPIENT_PREFIX = 'user:';

export function staffRecipientId(name: string): string {
	return STAFF_RECIPIENT_PREFIX + name;
}

export function userNameFromStaffRecipientId(id: string): string | null {
	if (!id.startsWith(STAFF_RECIPIENT_PREFIX)) return null;
	return id.slice(STAFF_RECIPIENT_PREFIX.length) || null;
}
