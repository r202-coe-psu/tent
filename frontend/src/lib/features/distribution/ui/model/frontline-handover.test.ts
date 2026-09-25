import { describe, expect, it } from 'vitest';
import {
	canRecipientReceiveItem,
	checkDuplicateMealAdvisory,
	getItemCapacitySummary,
	getRecipientValidationErrorMessage,
	type FrontlineRecipientSelection
} from './frontline-handover';
import type { DistributionLog, TicketItem } from '../../domain/food-supplies';

describe('frontline-handover model helpers', () => {
	const evacueeRecipient: FrontlineRecipientSelection = {
		recipientType: 'evacuee',
		recipientId: 'evacuee:01J00000000000000000000001',
		householdId: 'household:01J00000000000000000000001',
		label: 'สมชาย ใจดี'
	};

	const outsideRecipient: FrontlineRecipientSelection = {
		recipientType: 'outside',
		recipientId: null,
		label: 'บุคคลภายนอก (ไม่ระบุตัวตน)'
	};

	describe('canRecipientReceiveItem', () => {
		it('allows evacuee to receive both consumable and returnable items', () => {
			expect(canRecipientReceiveItem(evacueeRecipient, false)).toBe(true);
			expect(canRecipientReceiveItem(evacueeRecipient, true)).toBe(true);
		});

		it('allows outside recipient to receive consumable items', () => {
			expect(canRecipientReceiveItem(outsideRecipient, false)).toBe(true);
		});

		it('strictly forbids outside recipient from receiving returnable loan items', () => {
			expect(canRecipientReceiveItem(outsideRecipient, true)).toBe(false);
		});

		it('forbids null recipient', () => {
			expect(canRecipientReceiveItem(null, false)).toBe(false);
			expect(canRecipientReceiveItem(null, true)).toBe(false);
		});
	});

	describe('getRecipientValidationErrorMessage', () => {
		it('returns null when evacuee receives returnable item', () => {
			expect(getRecipientValidationErrorMessage(evacueeRecipient, true)).toBeNull();
		});

		it('returns clear Thai error message when outside receives returnable item', () => {
			const msg = getRecipientValidationErrorMessage(outsideRecipient, true);
			expect(msg).toContain('สิ่งของประเภท');
			expect(msg).toContain('ต้องคืน');
			expect(msg).toContain('ไม่สามารถแจกให้บุคคลภายนอกได้');
		});

		it('returns error message when recipient is not selected', () => {
			const msg = getRecipientValidationErrorMessage(null, false);
			expect(msg).toContain('กรุณาเลือกผู้รับ');
		});
	});

	describe('getItemCapacitySummary', () => {
		const ticketId = 'requisition_ticket:01J00000000000000000000001';
		const item: TicketItem = {
			item_id: 'item:blanket',
			item_name: 'ผ้าห่มกันหนาว',
			type_class: 'CONSUMABLE',
			requested_qty: '50',
			allocated_qty: '50'
		};

		it('computes distributed and remaining in-hand capacity accurately', () => {
			const mockLogs: DistributionLog[] = [
				{
					_id: 'distribution_log:01J00000000000000000000011',
					_rev: '1-rev',
					schema_v: 1,
					type: 'distribution_log',
					shelter_code: 'SH001',
					ticket_id: ticketId,
					item_id: 'item:blanket',
					qty: '15',
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

			const summary = getItemCapacitySummary(ticketId, item, mockLogs);
			expect(summary.allocatedQty).toBe('50');
			expect(summary.distributedQty).toBe('15');
			expect(summary.inHandQty).toBe('35');
			expect(summary.isExhausted).toBe(false);
		});

		it('flags isExhausted when inHandQty is 0', () => {
			const mockLogs: DistributionLog[] = [
				{
					_id: 'distribution_log:01J00000000000000000000011',
					_rev: '1-rev',
					schema_v: 1,
					type: 'distribution_log',
					shelter_code: 'SH001',
					ticket_id: ticketId,
					item_id: 'item:blanket',
					qty: '50',
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

			const summary = getItemCapacitySummary(ticketId, item, mockLogs);
			expect(summary.inHandQty).toBe('0');
			expect(summary.isExhausted).toBe(true);
		});
	});

	describe('checkDuplicateMealAdvisory', () => {
		const priorLog: DistributionLog = {
			_id: 'distribution_log:01J00000000000000000000011',
			_rev: '1-rev',
			schema_v: 1,
			type: 'distribution_log',
			shelter_code: 'SH001',
			ticket_id: 'requisition_ticket:01J00000000000000000000001',
			item_id: 'item:meal-box',
			qty: '1',
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
		};

		it('detects duplicate meal from recipient logs', () => {
			const res = checkDuplicateMealAdvisory([priorLog], 'lunch', '2026-09-20T06:00:00.000Z');
			expect(res.isDuplicate).toBe(true);
			expect(res.priorLog).toBe(priorLog);
		});

		it('returns isDuplicate false when no matching meal exists', () => {
			const res = checkDuplicateMealAdvisory([priorLog], 'dinner', '2026-09-20T06:00:00.000Z');
			expect(res.isDuplicate).toBe(false);
			expect(res.priorLog).toBeNull();
		});

		it('returns isDuplicate false when logs are empty or targetMeal undefined', () => {
			expect(checkDuplicateMealAdvisory([], 'lunch').isDuplicate).toBe(false);
			expect(checkDuplicateMealAdvisory([priorLog], undefined).isDuplicate).toBe(false);
		});
	});
});
