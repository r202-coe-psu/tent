import { describe, expect, it } from 'vitest';
import { ticketServiceDay } from '../../domain/food-supplies';
import {
	ALL_SERVICE_DAYS,
	filterTicketsByServiceDay,
	formatServiceDay,
	resolveServiceDay,
	serviceDayOptions
} from './service-day';

const TODAY = '2026-10-07';
// 23:30 on 6 Oct and 00:10 on 7 Oct in Bangkok (UTC+7).
const lateYesterday = { id: 'a', created_at: '2026-10-06T16:30:00.000Z' };
const earlyToday = { id: 'b', created_at: '2026-10-06T17:10:00.000Z' };
const laterToday = { id: 'c', created_at: '2026-10-07T05:00:00.000Z' };

describe('ticketServiceDay (FR-MQW-03 A)', () => {
	it('uses the Thailand calendar day of created_at', () => {
		expect(ticketServiceDay(lateYesterday)).toBe('2026-10-06');
		expect(ticketServiceDay(earlyToday)).toBe('2026-10-07');
	});
});

describe('serviceDayOptions', () => {
	it('lists distinct days newest first and ends with the all-days option', () => {
		const options = serviceDayOptions([lateYesterday, earlyToday, laterToday], TODAY);
		expect(options.map((o) => o.value)).toEqual(['2026-10-07', '2026-10-06', ALL_SERVICE_DAYS]);
		expect(options[0].label).toMatch(/^วันนี้/);
		expect(options[1].label).toMatch(/^เมื่อวาน/);
	});

	it('labels days away from today with the date only', () => {
		expect(formatServiceDay('2026-10-08', TODAY)).toMatch(/^พรุ่งนี้/);
		expect(formatServiceDay('2026-10-01', TODAY)).not.toMatch(/วันนี้|เมื่อวาน|พรุ่งนี้/);
	});
});

describe('resolveServiceDay', () => {
	const tickets = [lateYesterday, earlyToday];

	it('defaults to today when a ticket is for today', () => {
		expect(resolveServiceDay(null, tickets, TODAY)).toBe(TODAY);
	});

	it('falls back to every day when no ticket is for today', () => {
		expect(resolveServiceDay(null, [lateYesterday], TODAY)).toBe(ALL_SERVICE_DAYS);
	});

	it('keeps a pick that is still offered and drops a stale one', () => {
		expect(resolveServiceDay('2026-10-06', tickets, TODAY)).toBe('2026-10-06');
		expect(resolveServiceDay(ALL_SERVICE_DAYS, tickets, TODAY)).toBe(ALL_SERVICE_DAYS);
		expect(resolveServiceDay('2026-10-01', tickets, TODAY)).toBe(TODAY);
	});
});

describe('filterTicketsByServiceDay', () => {
	const tickets = [lateYesterday, earlyToday, laterToday];

	it('keeps tickets of the chosen day only', () => {
		expect(filterTicketsByServiceDay(tickets, TODAY).map((t) => t.id)).toEqual(['b', 'c']);
		expect(filterTicketsByServiceDay(tickets, '2026-10-06').map((t) => t.id)).toEqual(['a']);
	});

	it('returns every ticket for the all-days option', () => {
		expect(filterTicketsByServiceDay(tickets, ALL_SERVICE_DAYS)).toHaveLength(3);
	});
});
