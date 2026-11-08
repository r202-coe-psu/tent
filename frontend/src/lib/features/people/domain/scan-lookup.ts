/**
 * Shared QR / barcode token normalization for staff scanners.
 * Path parsers (zoning / medical / `?evacuee_id=`) live in intake-pipeline;
 * this module adds couch `evacuee:` normalization and Mongo queue search candidates.
 */

import { parsePersonQr, type ParsedPersonQr } from '$lib/utils/evacuee-qr';
import { parseZoningQrCode } from './intake-pipeline';

/**
 * Extract a lookup token from scanner input.
 * Reuses zoning/medical path + `?evacuee_id=` parsers; bare tokens pass through.
 */
export function extractScanLookupToken(raw: string): string | null {
	return parseZoningQrCode(raw);
}

/**
 * Person QR (CR-233) carried by a scan, or `null` for anything else: a bare ULID registration
 * ticket (FR-EQR-31), a path/URL payload, free text, or a malformed `@` suffix (FR-EQR-5).
 * `evacuee_id` never contains `@` (FR-EQR-6).
 */
export function extractScanPersonQr(raw: string): ParsedPersonQr | null {
	return parsePersonQr(raw);
}

/** Couch doc id — always `evacuee:…` (case-normalized prefix). */
export function toCouchEvacueeId(token: string): string {
	const trimmed = token.trim();
	if (!trimmed) return trimmed;
	const lower = trimmed.toLowerCase();
	if (lower.startsWith('evacuee:')) {
		return `evacuee:${trimmed.slice('evacuee:'.length)}`;
	}
	return `evacuee:${trimmed}`;
}

/**
 * Queries to try against Mongo unassigned search after a Couch miss.
 * Unassigned tickets encode the registration `_id` (no `evacuee:` prefix);
 * also try the bare ULID when the scan carried `evacuee:`.
 */
export function mongoUnassignedSearchQueries(token: string): string[] {
	const trimmed = token.trim();
	if (!trimmed) return [];

	const out: string[] = [];
	const seen = new Set<string>();
	const push = (q: string) => {
		const t = q.trim();
		if (!t || seen.has(t)) return;
		seen.add(t);
		out.push(t);
	};

	push(trimmed);
	const lower = trimmed.toLowerCase();
	if (lower.startsWith('evacuee:')) {
		push(trimmed.slice('evacuee:'.length));
	}

	return out;
}

/** Prefer an exact registration-id match when the scan token equals a hit id. */
export function pickUnassignedSearchHit<T extends { id: string }>(
	results: T[],
	query: string
): T | null {
	if (results.length === 0) return null;
	const exact = results.find((r) => r.id === query);
	return exact ?? results[0] ?? null;
}
