/**
 * Bulk-return pool QR (#660): the printed label encodes the pool `_id` as-is. Pure; no Svelte.
 */

export const BULK_RETURN_POOL_QR_PREFIX = 'bulk_return_pool:';

const POOL_QR_RE = /^bulk_return_pool:([0-9A-HJKMNP-TV-Z]{26})$/i;

export function poolQrPayload(poolId: string): string {
	return poolId;
}

/**
 * Pool id from a raw scan (bare id or a URL whose last path segment is the id), or `null` when the
 * scan is not a pool QR. Prefix is normalised to lower case, the ULID to upper case.
 */
export function parsePoolScanCode(raw: string): string | null {
	const trimmed = raw.trim();
	const withoutQuery = trimmed.split(/[?#]/)[0] ?? trimmed;
	const segments = withoutQuery.split('/').filter(Boolean);
	const candidate = withoutQuery.includes('/') ? (segments[segments.length - 1] ?? '') : trimmed;
	const match = POOL_QR_RE.exec(candidate);
	if (!match) return null;
	return `${BULK_RETURN_POOL_QR_PREFIX}${match[1].toUpperCase()}`;
}
