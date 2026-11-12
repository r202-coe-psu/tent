import { describe, expect, it } from 'vitest';
import {
	ALL_POINTS,
	distributionPointOptions,
	filterTicketsByPoint,
	resolveDistributionPoint,
	ticketCardSummary,
	ticketItemLines,
	ticketOption,
	ticketOptionLabel
} from './distribution-point';

const gym1 = { id: 'a', destination_location: 'อาคารยิมเนเซียม 1' };
const gym2 = { id: 'b', destination_location: 'อาคารยิมเนเซียม 2' };
const gym1Again = { id: 'c', destination_location: ' อาคารยิมเนเซียม 1 ' };
const tickets = [gym2, gym1, gym1Again];

describe('distributionPointOptions', () => {
	it('lists each trimmed destination once, sorted', () => {
		expect(distributionPointOptions(tickets)).toEqual(['อาคารยิมเนเซียม 1', 'อาคารยิมเนเซียม 2']);
	});
});

describe('resolveDistributionPoint', () => {
	it('keeps a pick that is still offered', () => {
		expect(resolveDistributionPoint('อาคารยิมเนเซียม 2', tickets)).toBe('อาคารยิมเนเซียม 2');
	});

	it('falls back to every point for no pick or a stale one', () => {
		expect(resolveDistributionPoint(null, tickets)).toBe(ALL_POINTS);
		expect(resolveDistributionPoint('โรงอาหาร', tickets)).toBe(ALL_POINTS);
	});
});

describe('filterTicketsByPoint', () => {
	it('keeps tickets of the chosen point, ignoring surrounding spaces', () => {
		expect(filterTicketsByPoint(tickets, 'อาคารยิมเนเซียม 1').map((t) => t.id)).toEqual(['a', 'c']);
	});

	it('returns every ticket for all points', () => {
		expect(filterTicketsByPoint(tickets, ALL_POINTS)).toHaveLength(3);
	});
});

describe('ticketOption', () => {
	const items = [{ item_name: 'ข้าวกล่องทั่วไป' }, { item_name: 'ข้าวกล่องฮาลาล' }];
	const today = '2026-11-06';

	it('titles a food ticket by meal and day, with labelled point, items and number', () => {
		const food = {
			ticket_no: 'TKT-FOOD-1',
			requisition_type: 'food' as const,
			meal: 'lunch' as const,
			created_at: '2026-11-06T03:00:00.000Z',
			destination_location: 'อาคารยิมเนเซียม 1',
			items
		};
		expect(ticketOption(food, today)).toEqual({
			title: 'มื้อกลางวัน วันนี้ (6 พ.ย.)',
			details: [
				{ label: 'จุดแจก', value: 'อาคารยิมเนเซียม 1' },
				{ label: 'รายการ', value: 'ข้าวกล่องทั่วไป, ข้าวกล่องฮาลาล' },
				{ label: 'เลขตั๋ว', value: 'TKT-FOOD-1' }
			]
		});
		expect(ticketOptionLabel(food, today)).toBe(
			'มื้อกลางวัน วันนี้ (6 พ.ย.) จุดแจก อาคารยิมเนเซียม 1 รายการ ข้าวกล่องทั่วไป, ข้าวกล่องฮาลาล เลขตั๋ว TKT-FOOD-1'
		);
	});

	it('titles a supplies ticket by its point', () => {
		expect(
			ticketOption(
				{
					ticket_no: 'TKT-SUP-1',
					requisition_type: 'supplies',
					created_at: '2026-11-06T03:00:00.000Z',
					destination_location: 'อาคารยิมเนเซียม 2',
					items: [{ item_name: 'มุ้ง' }]
				},
				today
			)
		).toEqual({
			title: 'อาคารยิมเนเซียม 2',
			details: [
				{ label: 'รายการ', value: 'มุ้ง' },
				{ label: 'เลขตั๋ว', value: 'TKT-SUP-1' }
			]
		});
	});
});

describe('ticketCardSummary', () => {
	const today = '2026-11-06';

	it('splits a food ticket into type, meal, day and point', () => {
		expect(
			ticketCardSummary(
				{
					requisition_type: 'food',
					meal: 'lunch',
					created_at: '2026-11-06T03:00:00.000Z',
					destination_location: 'จุด A'
				},
				today
			)
		).toEqual({ type: 'อาหาร', meal: 'มื้อกลางวัน', day: 'วันนี้ (6 พ.ย.)', destination: 'จุด A' });
	});

	it('places the day on the Thailand calendar, not UTC', () => {
		expect(
			ticketCardSummary(
				{
					requisition_type: 'food',
					meal: 'breakfast',
					created_at: '2026-11-06T18:00:00.000Z',
					destination_location: 'จุด A'
				},
				today
			).day
		).toBe('พรุ่งนี้ (7 พ.ย.)');
	});

	it('reads the service day from service_date when the ticket has one', () => {
		expect(
			ticketCardSummary(
				{
					requisition_type: 'food',
					meal: 'breakfast',
					created_at: '2026-11-06T13:00:00.000Z',
					service_date: '2026-11-07',
					destination_location: 'จุด A'
				},
				today
			).day
		).toBe('พรุ่งนี้ (7 พ.ย.)');
	});

	it('has no meal for a supplies ticket, even one carrying a stray meal', () => {
		expect(
			ticketCardSummary(
				{
					requisition_type: 'supplies',
					meal: 'lunch',
					created_at: '2026-11-05T03:00:00.000Z',
					destination_location: ' จุด B '
				},
				today
			)
		).toEqual({ type: 'พัสดุ', meal: null, day: 'เมื่อวาน (5 พ.ย.)', destination: 'จุด B' });
	});
});

describe('ticketItemLines', () => {
	it('gives each item its quantity and unit, blank while the unit is unknown', () => {
		const units: Record<string, string> = { rice: 'กล่อง' };
		expect(
			ticketItemLines(
				[
					{ item_id: 'rice', item_name: 'ข้าวกล่อง', allocated_qty: '40' },
					{ item_id: 'net', item_name: 'มุ้ง', allocated_qty: '3' }
				],
				(id) => units[id] ?? ''
			)
		).toEqual([
			{ itemId: 'rice', name: 'ข้าวกล่อง', qty: '40', unit: 'กล่อง' },
			{ itemId: 'net', name: 'มุ้ง', qty: '3', unit: '' }
		]);
	});
});
