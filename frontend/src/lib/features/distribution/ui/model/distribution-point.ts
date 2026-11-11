import {
	thailandCalendarDay,
	ticketServiceDay,
	type RequisitionTicket
} from '../../domain/food-supplies';
import { formatServiceDay } from './service-day';
import { getMealPeriodLabel, getRequisitionTypeLabel } from './ticket-status';

/**
 * Optional distribution-point filter for the desk (feedback 2026-10-11). It only narrows what a
 * user looks at — every ticket of the shelter stays reachable through "ทุกจุด", so it does not
 * decide draft FR-DDS-07 (which tickets a point may see).
 */
export const ALL_POINTS = 'all';

type PointTicket = { destination_location: string };

/** Distinct `destination_location` values, sorted, for the point selector. */
export function distributionPointOptions(tickets: readonly PointTicket[]): string[] {
	return [...new Set(tickets.map((t) => t.destination_location.trim()).filter(Boolean))].sort(
		(a, b) => a.localeCompare(b, 'th')
	);
}

/** The user's pick while it is still offered, otherwise every point. */
export function resolveDistributionPoint(
	picked: string | null,
	tickets: readonly PointTicket[]
): string {
	if (picked && picked !== ALL_POINTS && distributionPointOptions(tickets).includes(picked)) {
		return picked;
	}
	return ALL_POINTS;
}

export function filterTicketsByPoint<T extends PointTicket>(
	tickets: readonly T[],
	point: string
): T[] {
	if (point === ALL_POINTS) return [...tickets];
	return tickets.filter((t) => t.destination_location.trim() === point);
}

type OptionTicket = Pick<
	RequisitionTicket,
	'ticket_no' | 'requisition_type' | 'meal' | 'created_at' | 'destination_location'
> & { items: readonly { item_name: string }[] };

/** A ticket in the desk's ticket selector: a short title plus labelled details, no separators. */
export interface TicketOption {
	/** Food: meal and service day. Supplies: the destination point. */
	title: string;
	details: { label: string; value: string }[];
}

export function ticketOption(
	ticket: OptionTicket,
	today: string = thailandCalendarDay()
): TicketOption {
	const summary = ticketCardSummary(ticket, today);
	const items = { label: 'รายการ', value: ticket.items.map((i) => i.item_name).join(', ') };
	const ticketNo = { label: 'เลขตั๋ว', value: ticket.ticket_no };
	if (summary.meal) {
		return {
			title: `${summary.meal} ${summary.day}`,
			details: [{ label: 'จุดแจก', value: summary.destination }, items, ticketNo]
		};
	}
	return { title: summary.destination, details: [items, ticketNo] };
}

/** Plain-text form of {@link ticketOption}, for select labels and type-ahead. */
export function ticketOptionLabel(
	ticket: OptionTicket,
	today: string = thailandCalendarDay()
): string {
	const { title, details } = ticketOption(ticket, today);
	return [title, ...details.map((d) => `${d.label} ${d.value}`)].join(' ');
}

/** What a ticket card shows instead of `ticket_no` (#1183); `meal` is null for supplies. */
export interface TicketCardSummary {
	type: string;
	meal: string | null;
	day: string;
	destination: string;
}

export function ticketCardSummary(
	ticket: Pick<
		RequisitionTicket,
		'requisition_type' | 'meal' | 'created_at' | 'destination_location'
	>,
	today: string = thailandCalendarDay()
): TicketCardSummary {
	return {
		type: getRequisitionTypeLabel(ticket.requisition_type),
		meal:
			ticket.requisition_type === 'food' && ticket.meal
				? `มื้อ${getMealPeriodLabel(ticket.meal)}`
				: null,
		day: formatServiceDay(ticketServiceDay(ticket), today),
		destination: ticket.destination_location.trim()
	};
}

export interface TicketItemLine {
	itemId: string;
	name: string;
	qty: string;
	unit: string;
}

/** One line per item: name, quantity and unit (`unitOf` returns '' while the catalog loads). */
export function ticketItemLines(
	items: readonly Pick<
		RequisitionTicket['items'][number],
		'item_id' | 'item_name' | 'allocated_qty'
	>[],
	unitOf: (itemId: string) => string
): TicketItemLine[] {
	return items.map((item) => ({
		itemId: item.item_id,
		name: item.item_name,
		qty: item.allocated_qty,
		unit: unitOf(item.item_id)
	}));
}
