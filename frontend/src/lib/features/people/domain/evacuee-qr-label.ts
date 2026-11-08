import { intakeStationsPassed } from './intake-pipeline';
import { labelZoneName, type Evacuee, type ZoneLabelSource } from './people';

export type EvacueeQrLabelInput = {
	/** The shelter's living zones, used to resolve the zone text; absent until loaded. */
	zones?: readonly ZoneLabelSource[] | null;
	/** Whether the evacuee has at least one screening record (ticks คัดกรอง). */
	hasScreening: boolean;
};

export type EvacueeQrLabel = {
	/** What the QR encodes: the evacuee document id. */
	qrPayload: string;
	label: {
		/** First name, then the last name on its own line (`\n`-separated). */
		name: string;
		zone: string | null;
		/** Emergency contact phone, digits only (the kiosk server's `toLabelIdentity` form); null if none. */
		emergencyPhone: string | null;
		/** Intake stations passed: this many checklist boxes are ticked. */
		checkedCount: 0 | 1 | 2 | 3;
	};
};

/**
 * The kiosk-style QR label content for an evacuee: id payload, name, zone, emergency phone and how
 * many intake boxes are ticked. The checklist copy is the label's fixed bilingual rows.
 */
export function buildEvacueeQrLabel(evacuee: Evacuee, input: EvacueeQrLabelInput): EvacueeQrLabel {
	return {
		qrPayload: evacuee._id,
		label: {
			name: [evacuee.first_name, evacuee.last_name ?? '']
				.map((part) => part.trim())
				.filter(Boolean)
				.join('\n'),
			zone: labelZoneName(evacuee.current_stay?.zone, input.zones),
			emergencyPhone: evacuee.emergency_contact?.phone?.replace(/[\s-]/g, '') || null,
			checkedCount: intakeStationsPassed(evacuee.current_stay, input.hasScreening)
		}
	};
}
