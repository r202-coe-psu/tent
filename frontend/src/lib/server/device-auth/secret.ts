import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Shared device-secret primitives for scanners and printers (server-only). */

/** `<prefix>` followed by 32 random bytes as 64 hex chars. */
export function generateDeviceSecret(prefix: string): string {
	return `${prefix}${randomBytes(32).toString('hex')}`;
}

/** SHA-256 hex digest — the only form of a secret that is persisted. */
export function hashDeviceSecret(secret: string): string {
	return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/** Constant-time compare of a presented secret against a stored SHA-256 hex digest. */
export function verifyDeviceSecret(secret: string, storedHex: string): boolean {
	const supplied = createHash('sha256').update(secret, 'utf8').digest();
	const stored = Buffer.from(storedHex, 'hex');
	return stored.length === supplied.length && timingSafeEqual(supplied, stored);
}
