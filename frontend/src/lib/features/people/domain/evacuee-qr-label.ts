import { intakeStationsPassed } from './intake-pipeline';
import { formatPersonName, labelZoneName, type Evacuee, type ZoneLabelSource } from './people';

export type EvacueeQrLabelInput = {
	/** The shelter's living zones, used to resolve the zone text; absent until loaded. */
	zones?: readonly ZoneLabelSource[] | null;
	/** Whether the evacuee has at least one screening record (ticks คัดกรอง). */
	hasScreening: boolean;
	/** Localised checklist row copy, in station order: check-in, screening, lodging. */
	checklist: readonly string[];
};

export type EvacueeQrLabel = {
	/** What the QR encodes: the evacuee document id. */
	qrPayload: string;
	label: {
		name: string;
		zone: string | null;
		checklist: readonly string[];
		/** Intake stations passed: this many checklist boxes are ticked. */
		checkedCount: 0 | 1 | 2 | 3;
	};
};

/** The kiosk-style QR label content for an evacuee: id payload, name, zone and intake checklist. */
export function buildEvacueeQrLabel(evacuee: Evacuee, input: EvacueeQrLabelInput): EvacueeQrLabel {
	return {
		qrPayload: evacuee._id,
		label: {
			name: formatPersonName(evacuee),
			zone: labelZoneName(evacuee.current_stay?.zone, input.zones),
			checklist: input.checklist,
			checkedCount: intakeStationsPassed(evacuee.current_stay, input.hasScreening)
		}
	};
}
