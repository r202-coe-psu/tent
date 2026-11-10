/**
 * Print-time Person QR issuing for staff (CR-233 FR-EQR-21/21b/21c). Call ONLY from a print click
 * handler, never on open, and never cache the result across clicks: every call rotates the QR.
 */
import { parsePersonQr } from '$lib/utils/evacuee-qr';
import type { VulnerabilityMarker } from '$lib/utils/vulnerability-marker';
import { issueEvacueeQrs, type StaffEvacueeQrSource } from '../data/evacuee-qr.api';

/** Contract limit per request (api-contract §2.8). */
export const EVACUEE_QR_ISSUE_MAX_IDS = 30;

export type IssuedQrPayloads = {
	/** evacuee id -> issued payload, only for `status === 'issued'` items. */
	payloads: ReadonlyMap<string, string>;
	/** evacuee id -> the marker the server recorded for that print (#1301), same ids as `payloads`. */
	markers: ReadonlyMap<string, VulnerabilityMarker | null>;
	/** ids that were not issued (other status, missing or unusable item): must not be printed. */
	failedIds: readonly string[];
};

/**
 * Issue one fresh payload per distinct id. Network / HTTP errors reject; per-item failures land in
 * `failedIds`.
 */
export async function issueQrPayloads(
	input: { shelterCode: string; source: StaffEvacueeQrSource; evacueeIds: readonly string[] },
	deps: { issue: typeof issueEvacueeQrs } = { issue: issueEvacueeQrs }
): Promise<IssuedQrPayloads> {
	const ids = [...new Set(input.evacueeIds)];
	const payloads = new Map<string, string>();
	const markers = new Map<string, VulnerabilityMarker | null>();
	for (let i = 0; i < ids.length; i += EVACUEE_QR_ISSUE_MAX_IDS) {
		const chunk = ids.slice(i, i + EVACUEE_QR_ISSUE_MAX_IDS);
		const items = await deps.issue({
			shelter_code: input.shelterCode,
			source: input.source,
			evacuee_ids: chunk
		});
		for (const item of items) {
			if (item.status !== 'issued' || !item.qr_payload) continue;
			// Sanity only (no hashing): the payload must be a Person QR of the same evacuee.
			if (parsePersonQr(item.qr_payload)?.evacuee_id !== item.evacuee_id) continue;
			if (!chunk.includes(item.evacuee_id)) continue;
			payloads.set(item.evacuee_id, item.qr_payload);
			markers.set(item.evacuee_id, item.marker ?? null);
		}
	}
	return { payloads, markers, failedIds: ids.filter((id) => !payloads.has(id)) };
}
