import { describe, expect, it } from 'vitest';
import { buildAmendmentHistoryRows } from './ticket-amendment-history';
import type { TicketAmendment } from '../../domain/food-supplies';

describe('buildAmendmentHistoryRows', () => {
	const items = [
		{ item_id: 'item_master:rice', item_name: 'ข้าวสาร' },
		{ item_id: 'item_master:tent', item_name: 'เต็นท์ครอบครัว' }
	];

	it('returns an empty array when there are no amendments', () => {
		expect(buildAmendmentHistoryRows(undefined, items)).toEqual([]);
		expect(buildAmendmentHistoryRows([], items)).toEqual([]);
	});

	it('maps a single amendment to a display row', () => {
		const amendment: TicketAmendment = {
			amendment_id: '01J00000000000000000000001',
			item_id: 'item_master:rice',
			added_qty: '5',
			amended_at: '2026-09-26T07:00:00.000Z',
			amended_by: 'staff_1',
			reason: 'ผู้เข้าพักเพิ่มกะทันหัน'
		};

		const rows = buildAmendmentHistoryRows([amendment], items);

		expect(rows).toEqual([
			{
				amendmentId: '01J00000000000000000000001',
				itemId: 'item_master:rice',
				itemName: 'ข้าวสาร',
				addedQty: '5',
				amendedAt: '2026-09-26T07:00:00.000Z',
				amendedBy: 'staff_1',
				reason: 'ผู้เข้าพักเพิ่มกะทันหัน'
			}
		]);
	});

	it('sorts multiple amendments newest-first by amended_at', () => {
		const earlier: TicketAmendment = {
			amendment_id: '01J00000000000000000000001',
			item_id: 'item_master:rice',
			added_qty: '5',
			amended_at: '2026-09-26T07:00:00.000Z',
			amended_by: 'staff_1'
		};
		const later: TicketAmendment = {
			amendment_id: '01J00000000000000000000002',
			item_id: 'item_master:rice',
			added_qty: '3',
			amended_at: '2026-09-26T09:00:00.000Z',
			amended_by: 'staff_2'
		};

		const rows = buildAmendmentHistoryRows([earlier, later], items);

		expect(rows.map((r) => r.amendmentId)).toEqual([later.amendment_id, earlier.amendment_id]);
	});

	it('resolves item names independently across different items', () => {
		const riceAmendment: TicketAmendment = {
			amendment_id: '01J00000000000000000000001',
			item_id: 'item_master:rice',
			added_qty: '5',
			amended_at: '2026-09-26T07:00:00.000Z',
			amended_by: 'staff_1'
		};
		const tentAmendment: TicketAmendment = {
			amendment_id: '01J00000000000000000000002',
			item_id: 'item_master:tent',
			added_qty: '1',
			amended_at: '2026-09-26T07:05:00.000Z',
			amended_by: 'staff_1'
		};

		const rows = buildAmendmentHistoryRows([riceAmendment, tentAmendment], items);

		expect(rows.find((r) => r.amendmentId === riceAmendment.amendment_id)?.itemName).toBe(
			'ข้าวสาร'
		);
		expect(rows.find((r) => r.amendmentId === tentAmendment.amendment_id)?.itemName).toBe(
			'เต็นท์ครอบครัว'
		);
	});

	it('falls back to the raw item_id when the item is no longer on the ticket', () => {
		const amendment: TicketAmendment = {
			amendment_id: '01J00000000000000000000001',
			item_id: 'item_master:unknown',
			added_qty: '2',
			amended_at: '2026-09-26T07:00:00.000Z',
			amended_by: 'staff_1'
		};

		const rows = buildAmendmentHistoryRows([amendment], items);

		expect(rows[0].itemName).toBe('item_master:unknown');
	});

	it('permits a missing optional reason for legacy amendment data', () => {
		const amendment: TicketAmendment = {
			amendment_id: '01J00000000000000000000001',
			item_id: 'item_master:rice',
			added_qty: '5',
			amended_at: '2026-09-26T07:00:00.000Z',
			amended_by: 'staff_1'
		};

		const rows = buildAmendmentHistoryRows([amendment], items);

		expect(rows[0].reason).toBeUndefined();
	});
});
