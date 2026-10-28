import type { RequisitionTicketStatus, RequisitionType } from '../../domain/food-supplies';

export const STATION_TABS = ['receive', 'food', 'supplies', 'returns', 'reconciliation'] as const;
export type StationTab = (typeof STATION_TABS)[number];

/** One desk mode per ticket type, so food and supplies work never share a screen. */
export type DeskMode = Extract<RequisitionType, 'food' | 'supplies'>;

export const DEFAULT_DESK_MODE: DeskMode = 'food';

export const DESK_MODES: Record<DeskMode, { label: string; steps: readonly StationTab[] }> = {
	food: { label: 'อาหาร', steps: ['receive', 'food', 'reconciliation'] },
	supplies: { label: 'สิ่งของ', steps: ['receive', 'supplies', 'returns', 'reconciliation'] }
};

export const DESK_MODE_IDS = Object.keys(DESK_MODES) as DeskMode[];

export const STEP_TITLES: Record<StationTab, { title: string; subtitle: string }> = {
	receive: { title: 'รับของถึงจุดแจก', subtitle: 'Confirm Cargo Arrival' },
	food: { title: 'แจกอาหารปรุงสุก', subtitle: 'Ready Meal Handover' },
	supplies: { title: 'จ่ายพัสดุ & ยืม-คืน', subtitle: 'Supplies & Loans' },
	returns: { title: 'รับคืนสิ่งของ', subtitle: 'Loan Return Counter' },
	reconciliation: { title: 'ปิดรอบ & คืนของ', subtitle: 'Shift Close & Returns' }
};

export function isDeskMode(value: unknown): value is DeskMode {
	return typeof value === 'string' && Object.hasOwn(DESK_MODES, value);
}

/** Numbered step title within a mode, e.g. "3. รับคืนสิ่งของ"; unnumbered if the mode lacks it. */
export function stepLabel(mode: DeskMode, tab: StationTab): string {
	const position = DESK_MODES[mode].steps.indexOf(tab);
	const { title } = STEP_TITLES[tab];
	return position < 0 ? title : `${position + 1}. ${title}`;
}

export function ticketsForMode<T extends { requisition_type: string }>(
	tickets: readonly T[],
	mode: DeskMode
): T[] {
	return tickets.filter((t) => t.requisition_type === mode);
}

/** `?mode=` wins over the remembered mode; anything unrecognised falls through to the default. */
export function resolveInitialMode(urlParam: unknown, stored: unknown): DeskMode {
	if (isDeskMode(urlParam)) return urlParam;
	if (isDeskMode(stored)) return stored;
	return DEFAULT_DESK_MODE;
}

/** Keep the open step when the new mode has it, otherwise start that mode at step 1. */
export function stepAfterModeSwitch(current: StationTab, mode: DeskMode): StationTab {
	const { steps } = DESK_MODES[mode];
	return steps.includes(current) ? current : steps[0];
}

/** Post-distribution tickets waiting on a direct frontline close-out action. */
export function needsCloseOutAction(ticket: { status: RequisitionTicketStatus }): boolean {
	return ticket.status === 'SHIFT_CLOSED' || ticket.status === 'RETURN_COMPLETED';
}

/** Work the desk must act on in a mode: cargo to receive plus close-outs to finish. */
export function modePendingCount(
	tickets: readonly { requisition_type: string; status: RequisitionTicketStatus }[],
	mode: DeskMode
): number {
	return ticketsForMode(tickets, mode).filter(
		(t) => t.status === 'IN_TRANSIT' || needsCloseOutAction(t)
	).length;
}
