/** Normalize a raw QR/manual scan: trim, and take the last path segment of a URL payload. */
export function extractScanCode(raw: string): string {
	const trimmed = raw.trim();
	const withoutQuery = trimmed.split(/[?#]/)[0] ?? trimmed;
	if (!withoutQuery.includes('/')) return trimmed;
	const segments = withoutQuery.split('/').filter(Boolean);
	return segments[segments.length - 1] || trimmed;
}
