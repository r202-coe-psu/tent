import { isAlreadyCheckedInStatus } from './check-in-status';

type SelectableHouseholdMember = {
	evacuee_id: string;
	is_primary: boolean;
	selectable: boolean;
	status: string;
};

type ExistingReportResult = {
	evacuee_id: string;
	status: 'already_checked_in';
	stay_status: string;
	qr_payload?: string;
};

/** Phone lookup preselects every eligible member; QR and card preselect the scanned member. */
export function initialSelection(
	source: 'phone' | 'qr' | 'smart-card',
	selectable: readonly SelectableHouseholdMember[]
): string[] {
	const eligible = selectable.filter((member) => member.selectable);
	if (source === 'phone') return eligible.map((member) => member.evacuee_id);
	return eligible.filter((member) => member.is_primary).map((member) => member.evacuee_id);
}

/** Return all prior reports; only members still arriving can have their QR reprinted. */
export function toExistingReportResults(
	members: readonly SelectableHouseholdMember[]
): ExistingReportResult[] {
	return members
		.filter((member) => isAlreadyCheckedInStatus(member.status))
		.map((member) => ({
			evacuee_id: member.evacuee_id,
			status: 'already_checked_in',
			stay_status: member.status,
			...(member.status === 'arriving' ? { qr_payload: member.evacuee_id } : {})
		}));
}
