import { describe, expect, it } from 'vitest';
import {
	calculateDistributedQtyForTicketItem,
	calculateInHandQtyForTicketItem,
	isDuplicateMealDistributionLog,
	type DistributionLog,
	type TicketItem
} from './index';

describe('isDuplicateMealDistributionLog (Single Source of Truth)', () => {
	const baseLog: Pick<DistributionLog, 'status' | 'is_returnable' | 'meal' | 'distributed_at'> = {
		status: 'fulfilled',
		is_returnable: false,
		meal: 'lunch',
		distributed_at: '2026-09-20T05:00:00.000Z' // 12:00 PM Bangkok
	};

	it('flags duplicate when meal matches on the same Thailand calendar day', () => {
		const sameDay = '2026-09-20T06:30:00.000Z'; // 13:30 PM Bangkok
		expect(isDuplicateMealDistributionLog(baseLog, 'lunch', sameDay)).toBe(true);
	});

	it('does not flag duplicate when meal period is different', () => {
		const sameDay = '2026-09-20T06:30:00.000Z';
		expect(isDuplicateMealDistributionLog(baseLog, 'dinner', sameDay)).toBe(false);
		expect(isDuplicateMealDistributionLog(baseLog, 'breakfast', sameDay)).toBe(false);
	});

	it('does not flag duplicate on a different Thailand calendar day', () => {
		const nextDay = '2026-09-21T05:00:00.000Z';
		const prevDay = '2026-09-19T05:00:00.000Z';
		expect(isDuplicateMealDistributionLog(baseLog, 'lunch', nextDay)).toBe(false);
		expect(isDuplicateMealDistributionLog(baseLog, 'lunch', prevDay)).toBe(false);
	});

	it('ignores voided logs', () => {
		const voidedLog = { ...baseLog, status: 'voided' as const };
		expect(isDuplicateMealDistributionLog(voidedLog, 'lunch', '2026-09-20T05:00:00.000Z')).toBe(
			false
		);
	});

	it('ignores returnable supplies/loans', () => {
		const returnableLog = { ...baseLog, is_returnable: true };
		expect(isDuplicateMealDistributionLog(returnableLog, 'lunch', '2026-09-20T05:00:00.000Z')).toBe(
			false
		);
	});

	it('correctly handles Thailand UTC+7 midnight boundary', () => {
		// In UTC: 2026-09-19T17:00:00.000Z is 2026-09-20T00:00:00 in Thailand UTC+7
		const bkkMidnight = {
			...baseLog,
			distributed_at: '2026-09-19T17:00:00.000Z'
		};
		// Query on 2026-09-20 Bangkok daytime:
		expect(isDuplicateMealDistributionLog(bkkMidnight, 'lunch', '2026-09-20T04:00:00.000Z')).toBe(
			true
		);

		// 1 minute before midnight Bangkok (2026-09-19T16:59:00.000Z) is still 2026-09-19 in Bangkok
		const bkkPrevDay = {
			...baseLog,
			distributed_at: '2026-09-19T16:59:00.000Z'
		};
		expect(isDuplicateMealDistributionLog(bkkPrevDay, 'lunch', '2026-09-20T04:00:00.000Z')).toBe(
			false
		);
	});
});

describe('In-Hand Capacity Calculations', () => {
	const ticketId = 'requisition_ticket:01J00000000000000000000001';
	const otherTicketId = 'requisition_ticket:01J00000000000000000000002';
	const targetItem: TicketItem = {
		item_id: 'item:meal-box',
		item_name: 'ข้าวกะเพราไก่',
		type_class: 'CONSUMABLE',
		requested_qty: '100',
		allocated_qty: '100'
	};

	const mockLogs: DistributionLog[] = [
		{
			_id: 'distribution_log:01J00000000000000000000011',
			_rev: '1-rev',
			schema_v: 1,
			type: 'distribution_log',
			shelter_code: 'SH001',
			ticket_id: ticketId,
			item_id: 'item:meal-box',
			qty: '20',
			recipient_type: 'evacuee',
			recipient_id: 'evacuee:01J00000000000000000000001',
			meal: 'lunch',
			is_returnable: false,
			status: 'fulfilled',
			is_override: false,
			distributed_at: '2026-09-20T05:00:00.000Z',
			distributed_by: 'staff:test',
			created_at: '2026-09-20T05:00:00.000Z',
			created_by: 'staff:test',
			updated_at: '2026-09-20T05:00:00.000Z'
		},
		{
			_id: 'distribution_log:01J00000000000000000000012',
			_rev: '1-rev',
			schema_v: 1,
			type: 'distribution_log',
			shelter_code: 'SH001',
			ticket_id: ticketId,
			item_id: 'item:meal-box',
			qty: '15',
			recipient_type: 'evacuee',
			recipient_id: 'evacuee:01J00000000000000000000002',
			meal: 'lunch',
			is_returnable: false,
			status: 'fulfilled',
			is_override: false,
			distributed_at: '2026-09-20T05:10:00.000Z',
			distributed_by: 'staff:test',
			created_at: '2026-09-20T05:10:00.000Z',
			created_by: 'staff:test',
			updated_at: '2026-09-20T05:10:00.000Z'
		},
		// Voided log on same ticket & item (MUST be excluded)
		{
			_id: 'distribution_log:01J00000000000000000000013',
			_rev: '2-rev',
			schema_v: 1,
			type: 'distribution_log',
			shelter_code: 'SH001',
			ticket_id: ticketId,
			item_id: 'item:meal-box',
			qty: '50',
			recipient_type: 'evacuee',
			recipient_id: 'evacuee:01J00000000000000000000003',
			meal: 'lunch',
			is_returnable: false,
			status: 'voided',
			voided_at: '2026-09-20T05:20:00.000Z',
			voided_by: 'staff:test',
			is_override: false,
			distributed_at: '2026-09-20T05:15:00.000Z',
			distributed_by: 'staff:test',
			created_at: '2026-09-20T05:15:00.000Z',
			created_by: 'staff:test',
			updated_at: '2026-09-20T05:20:00.000Z'
		},
		// Different ticket log for same item (MUST be excluded)
		{
			_id: 'distribution_log:01J00000000000000000000014',
			_rev: '1-rev',
			schema_v: 1,
			type: 'distribution_log',
			shelter_code: 'SH001',
			ticket_id: otherTicketId,
			item_id: 'item:meal-box',
			qty: '40',
			recipient_type: 'evacuee',
			recipient_id: 'evacuee:01J00000000000000000000004',
			meal: 'lunch',
			is_returnable: false,
			status: 'fulfilled',
			is_override: false,
			distributed_at: '2026-09-20T05:00:00.000Z',
			distributed_by: 'staff:test',
			created_at: '2026-09-20T05:00:00.000Z',
			created_by: 'staff:test',
			updated_at: '2026-09-20T05:00:00.000Z'
		},
		// Different item on same ticket (MUST be excluded)
		{
			_id: 'distribution_log:01J00000000000000000000015',
			_rev: '1-rev',
			schema_v: 1,
			type: 'distribution_log',
			shelter_code: 'SH001',
			ticket_id: ticketId,
			item_id: 'item:water-bottle',
			qty: '10',
			recipient_type: 'evacuee',
			recipient_id: 'evacuee:01J00000000000000000000001',
			is_returnable: false,
			status: 'fulfilled',
			is_override: false,
			distributed_at: '2026-09-20T05:00:00.000Z',
			distributed_by: 'staff:test',
			created_at: '2026-09-20T05:00:00.000Z',
			created_by: 'staff:test',
			updated_at: '2026-09-20T05:00:00.000Z'
		}
	];

	it('correctly calculates distributed quantity for the exact ticket and item', () => {
		const distributed = calculateDistributedQtyForTicketItem(ticketId, 'item:meal-box', mockLogs);
		// 20 + 15 = 35 (50 voided is excluded, 40 other ticket is excluded, 10 other item is excluded)
		expect(distributed).toBe('35');
	});

	it('correctly calculates in-hand quantity (allocated - distributed)', () => {
		const inHand = calculateInHandQtyForTicketItem(ticketId, targetItem, mockLogs);
		// 100 - 35 = 65
		expect(inHand).toBe('65');
	});

	it('returns allocated_qty when no logs exist', () => {
		const inHand = calculateInHandQtyForTicketItem(ticketId, targetItem, []);
		expect(inHand).toBe('100');
	});
});
