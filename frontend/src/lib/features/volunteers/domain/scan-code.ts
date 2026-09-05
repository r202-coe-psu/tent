/**
 * scan-code.ts — normalize a raw QR/manual scan before matching it against a volunteer.

 */
export function extractScanCode(raw: string): string {
	const trimmed = raw.trim();
	const withoutQuery = trimmed.split(/[?#]/)[0] ?? trimmed;
	if (!withoutQuery.includes('/')) return trimmed;
	const segments = withoutQuery.split('/').filter(Boolean);
	return segments[segments.length - 1] || trimmed;
}
