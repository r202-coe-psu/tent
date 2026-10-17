import type { MealPeriod } from '../../domain/food-supplies';
import { getMealPeriodLabel } from './ticket-status';

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

/** Ticket selector label: number · meal (food) · point · items. */
export function ticketOptionLabel(ticket: {
	ticket_no: string;
	meal?: MealPeriod;
	destination_location: string;
	items: readonly { item_name: string }[];
}): string {
	const parts = [ticket.ticket_no];
	if (ticket.meal) parts.push(`มื้อ${getMealPeriodLabel(ticket.meal)}`);
	parts.push(ticket.destination_location);
	return `${parts.join(' · ')} (${ticket.items.map((i) => i.item_name).join(', ')})`;
}
