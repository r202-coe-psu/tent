import { describe, expect, it } from 'vitest';
import {
	ALL_POINTS,
	distributionPointOptions,
	filterTicketsByPoint,
	resolveDistributionPoint,
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

describe('ticketOptionLabel', () => {
	const items = [{ item_name: 'ข้าวกล่องทั่วไป' }, { item_name: 'ข้าวกล่องฮาลาล' }];

	it('shows the meal for food tickets', () => {
		expect(
			ticketOptionLabel({
				ticket_no: 'TKT-FOOD-1',
				meal: 'lunch',
				destination_location: 'อาคารยิมเนเซียม 1',
				items
			})
		).toBe('TKT-FOOD-1 · มื้อกลางวัน · อาคารยิมเนเซียม 1 (ข้าวกล่องทั่วไป, ข้าวกล่องฮาลาล)');
	});

	it('omits the meal for supplies tickets', () => {
		expect(
			ticketOptionLabel({
				ticket_no: 'TKT-SUP-1',
				destination_location: 'อาคารยิมเนเซียม 2',
				items: [{ item_name: 'มุ้ง' }]
			})
		).toBe('TKT-SUP-1 · อาคารยิมเนเซียม 2 (มุ้ง)');
	});
});
