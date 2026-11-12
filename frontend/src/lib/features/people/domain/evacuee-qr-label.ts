import {
	vulnerabilityMarker,
	type MarkerScreening,
	type VulnerabilityMarker
} from '$lib/utils/vulnerability-marker';
import { intakeStationsPassed } from './intake-pipeline';
import { labelZoneName, personNameParts, type Evacuee, type ZoneLabelSource } from './people';

export type EvacueeQrLabelInput = {
	/** The shelter's living zones, used to resolve the zone text; absent until loaded. */
	zones?: readonly ZoneLabelSource[] | null;
	/** Whether the evacuee has at least one screening record (ticks คัดกรอง). */
	hasScreening: boolean;
	/**
	 * The evacuee's screenings, for the vulnerability marker (#1301). Omit when none are loaded: the
	 * marker then follows `vulnerable_groups` alone.
	 */
	screenings?: readonly MarkerScreening[];
	/**
	 * The server-issued payload (CR-233). Omit for the on-open preview: the label then carries a
	 * QR placeholder that is not a usable Person QR (FR-EQR-21a).
	 */
	qrPayload?: string;
};

/** Encoded in the preview QR: not an `evacuee:` payload, so no scanner treats it as a person. */
export const EVACUEE_QR_PLACEHOLDER_PAYLOAD = 'PREVIEW-QR-NOT-ISSUED';

export type EvacueeQrLabel = {
	/** What the QR encodes: the issued payload, or the placeholder for a preview. */
	qrPayload: string;
	label: {
		/** First name, then the last name on its own line (`\n`-separated). */
		name: string;
		zone: string | null;
		/** Emergency contact phone, digits only (the kiosk server's `toLabelIdentity` form); null if none. */
		emergencyPhone: string | null;
		/** Intake stations passed: this many checklist boxes are ticked. */
		checkedCount: 0 | 1 | 2 | 3;
		/**
		 * Vulnerability marker (#1301). In a preview this is only what the card would carry (FR-EQR-21a);
		 * the printed card uses the marker the server recorded when issuing.
		 */
		marker: VulnerabilityMarker | null;
	};
};

/**
 * The kiosk-style QR label content for an evacuee: payload (issued, or a preview placeholder), name,
 * zone, emergency phone and how many intake boxes are ticked. The checklist copy is the label's
 * fixed bilingual rows.
 */
export function buildEvacueeQrLabel(evacuee: Evacuee, input: EvacueeQrLabelInput): EvacueeQrLabel {
	return {
		qrPayload: input.qrPayload ?? EVACUEE_QR_PLACEHOLDER_PAYLOAD,
		label: {
			name: personNameParts(evacuee).join('\n'),
			zone: labelZoneName(evacuee.current_stay?.zone, input.zones),
			emergencyPhone: evacuee.emergency_contact?.phone?.replace(/[\s-]/g, '') || null,
			checkedCount: intakeStationsPassed(evacuee.current_stay, input.hasScreening),
			marker: vulnerabilityMarker(evacuee, input.screenings ?? [])
		}
	};
}
