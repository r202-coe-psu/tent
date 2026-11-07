import {
	thailandCalendarDay,
	ticketServiceDay,
	type RequisitionTicket
} from '../../domain/food-supplies';

type ServiceDayTicket = Pick<RequisitionTicket, 'created_at' | 'service_date'>;

/** Day-filter sentinel meaning "every service day". */
export const ALL_SERVICE_DAYS = 'all';

export interface ServiceDayOption {
	value: string;
	label: string;
}

function addDays(day: string, delta: number): string {
	const d = new Date(`${day}T00:00:00.000Z`);
	d.setUTCDate(d.getUTCDate() + delta);
	return d.toISOString().slice(0, 10);
}

/** Thai label for a `YYYY-MM-DD` service day, relative to `today` where it helps. */
export function formatServiceDay(day: string, today: string): string {
	const date = new Date(`${day}T00:00:00.000Z`).toLocaleDateString('th-TH', {
		day: 'numeric',
		month: 'short',
		timeZone: 'UTC'
	});
	if (day === today) return `วันนี้ (${date})`;
	if (day === addDays(today, -1)) return `เมื่อวาน (${date})`;
	if (day === addDays(today, 1)) return `พรุ่งนี้ (${date})`;
	return date;
}

/** Distinct service days of the tickets, newest first, plus the "all days" option at the end. */
export function serviceDayOptions(
	tickets: readonly ServiceDayTicket[],
	today: string = thailandCalendarDay()
): ServiceDayOption[] {
	const days = [...new Set(tickets.map(ticketServiceDay))].sort().reverse();
	return [
		...days.map((day) => ({ value: day, label: formatServiceDay(day, today) })),
		{ value: ALL_SERVICE_DAYS, label: 'ทุกวัน' }
	];
}

/**
 * The day filter to apply: the user's pick while it is still offered, otherwise today when any
 * ticket is for today, otherwise every day (so open tickets from earlier days never vanish).
 */
export function resolveServiceDay(
	picked: string | null,
	tickets: readonly ServiceDayTicket[],
	today: string = thailandCalendarDay()
): string {
	const days = new Set(tickets.map(ticketServiceDay));
	if (picked === ALL_SERVICE_DAYS || (picked && days.has(picked))) return picked;
	return days.has(today) ? today : ALL_SERVICE_DAYS;
}

export function filterTicketsByServiceDay<T extends ServiceDayTicket>(
	tickets: readonly T[],
	day: string
): T[] {
	if (day === ALL_SERVICE_DAYS) return [...tickets];
	return tickets.filter((ticket) => ticketServiceDay(ticket) === day);
}
