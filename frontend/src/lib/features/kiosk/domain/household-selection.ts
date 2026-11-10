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
	/** Client-side marker only (CR-233): this arriving member's QR can be reissued; NOT a QR. */
	reprintable?: true;
};

type QrBearing = { qr_payload?: string; reprintable?: boolean; qr_issue_failed?: boolean };

/** FR-EQR-24: a member whose QR entry failed must never be printed. */
export function isQrIssueFailed(result: Pick<QrBearing, 'qr_issue_failed'>): boolean {
	return result.qr_issue_failed === true;
}

/** True when the member has (or can be given) a QR to print; never for `qr_issue_failed`. */
export function canPrintQr(result: QrBearing): boolean {
	return !isQrIssueFailed(result) && (Boolean(result.qr_payload) || result.reprintable === true);
}

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
			...(member.status === 'arriving' ? { reprintable: true as const } : {})
		}));
}

/** A reprint starts with every member that has a QR ticked; the visitor unticks the rest. */
export function initialReprintSelection(
	results: readonly ({ evacuee_id: string } & QrBearing)[]
): string[] {
	return results.filter(canPrintQr).map((result) => result.evacuee_id);
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
