import {
	thailandCalendarDay,
	ticketServiceDay,
	type RequisitionTicket
} from '../../domain/food-supplies';

type ServiceDayTicket = Pick<RequisitionTicket, 'created_at' | 'service_date'>;

/** Day-filter sentinel meaning "every service day". */
export const ALL_SERVICE_DAYS = 'all';

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

/**
 * The day filter to apply (CR-241 R5): the user's pick, even a day with no ticket; otherwise today
 * when any ticket is for today, otherwise every day (so open tickets from earlier days never vanish).
 */
export function resolveServiceDay(
	picked: string | null,
	tickets: readonly ServiceDayTicket[],
	today: string = thailandCalendarDay()
): string {
	if (picked) return picked;
	return tickets.some((ticket) => ticketServiceDay(ticket) === today) ? today : ALL_SERVICE_DAYS;
}

export function filterTicketsByServiceDay<T extends ServiceDayTicket>(
	tickets: readonly T[],
	day: string
): T[] {
	if (day === ALL_SERVICE_DAYS) return [...tickets];
	return tickets.filter((ticket) => ticketServiceDay(ticket) === day);
}
