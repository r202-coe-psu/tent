import { describe, expect, it } from 'vitest';
import { ticketServiceDay } from '../../domain/food-supplies';
import {
	ALL_SERVICE_DAYS,
	filterTicketsByServiceDay,
	formatServiceDay,
	resolveServiceDay
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

describe('formatServiceDay', () => {
	it('names today, yesterday and tomorrow, and shows other days by date only', () => {
		expect(formatServiceDay(TODAY, TODAY)).toMatch(/^วันนี้/);
		expect(formatServiceDay('2026-10-06', TODAY)).toMatch(/^เมื่อวาน/);
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

	it('keeps the picked day, even one with no ticket (CR-241 R5)', () => {
		expect(resolveServiceDay('2026-10-06', tickets, TODAY)).toBe('2026-10-06');
		expect(resolveServiceDay(ALL_SERVICE_DAYS, tickets, TODAY)).toBe(ALL_SERVICE_DAYS);
		expect(resolveServiceDay('2026-11-30', tickets, TODAY)).toBe('2026-11-30');
		expect(filterTicketsByServiceDay(tickets, '2026-11-30')).toEqual([]);
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

describe('service_date (draft-food-ticket-service-date)', () => {
	// Opened at 20:00 tonight for tomorrow's breakfast.
	const forTomorrow = {
		id: 'd',
		created_at: '2026-10-07T13:00:00.000Z',
		service_date: '2026-10-08'
	};

	it('files a ticket opened ahead under its service day, not its creation day', () => {
		expect(ticketServiceDay(forTomorrow)).toBe('2026-10-08');
		expect(filterTicketsByServiceDay([forTomorrow, laterToday], TODAY).map((t) => t.id)).toEqual([
			'c'
		]);
		expect(
			filterTicketsByServiceDay([forTomorrow, laterToday], '2026-10-08').map((t) => t.id)
		).toEqual(['d']);
	});
});
