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

/** Phone lookup preselects every eligible member; QR, card and ThaiD preselect the scanned member. */
export function initialSelection(
	source: 'phone' | 'qr' | 'smart-card' | 'thaid',
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

/** A reprint starts with every member that has a QR ticked; the visitor unticks the rest. */
export function initialReprintSelection(
	results: readonly { evacuee_id: string; qr_payload?: string }[]
): string[] {
	return results.filter((result) => result.qr_payload).map((result) => result.evacuee_id);
}

/** Ids the visitor may tick: members already reported stay locked. */
export function selectableIds(members: readonly SelectableHouseholdMember[]): string[] {
	return members.filter((member) => member.selectable).map((member) => member.evacuee_id);
}

/** True when there is something to tick and every selectable member is already ticked. */
export function isAllSelected(
	selected: readonly string[],
	members: readonly SelectableHouseholdMember[]
): boolean {
	const ids = selectableIds(members);
	return ids.length > 0 && ids.every((id) => selected.includes(id));
}

/** "Select all" tick every selectable member; pressed again with all ticked, it clears the lot. */
export function toggleAllSelection(
	selected: readonly string[],
	members: readonly SelectableHouseholdMember[]
): string[] {
	return isAllSelected(selected, members) ? [] : selectableIds(members);
}
