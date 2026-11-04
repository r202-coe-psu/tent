import { extractScanCode } from '$lib/utils/scan-code';

const VOLUNTEER_ID_PREFIX = 'volunteer:';
const VOLUNTEER_CODE_RE = /^V-\d+$/i;
/** Role-card / digital-pass token prefix (`TKT-VOL-…`, incl. `TKT-VOL-HASH-…` payloads). */
const VOLUNTEER_TOKEN_PREFIX = 'TKT-VOL-';

/** What a scan identifies a volunteer by — the lookup each kind needs differs. */
export type VolunteerScanCode =
	{ kind: 'id'; id: string } | { kind: 'code'; code: string } | { kind: 'token'; token: string };

/**
 * Classify a scan as a volunteer credential, or `null` when it is not one (e.g. an evacuee
 * card), so a mixed scanner can route it before touching any repository. Accepts the doc
 * `_id` (`volunteer:…`), the printed `V-{NNN}` code, and the role-card token — bare or inside
 * the digital-pass URL the QR encodes. Phone numbers are deliberately not volunteer-only.
 */
export function parseVolunteerScanCode(raw: string): VolunteerScanCode | null {
	const clean = extractScanCode(raw);
	if (!clean) return null;
	if (clean.toLowerCase().startsWith(VOLUNTEER_ID_PREFIX)) {
		const rest = clean.slice(VOLUNTEER_ID_PREFIX.length);
		return rest ? { kind: 'id', id: `${VOLUNTEER_ID_PREFIX}${rest}` } : null;
	}
	if (VOLUNTEER_CODE_RE.test(clean)) return { kind: 'code', code: clean.toUpperCase() };
	if (clean.toUpperCase().startsWith(VOLUNTEER_TOKEN_PREFIX))
		return { kind: 'token', token: clean };
	return null;
}
