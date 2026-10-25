import { describe, expect, it } from 'vitest';
import {
	canRecipientReceiveItem,
	checkAllergenAdvisory,
	checkDuplicateMealAdvisory,
	formatAllergyCodes,
	checkMenuMatchAdvisory,
	formatMenuTags,
	getItemCapacitySummary,
	getRecipientValidationErrorMessage,
	isIdentifiedRecipient,
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

	const volunteerRecipient: FrontlineRecipientSelection = {
		recipientType: 'volunteer',
		recipientId: 'volunteer:01J00000000000000000000001',
		label: 'สมหญิง อาสา',
		volunteerCode: 'V-001'
	};

	describe('isIdentifiedRecipient', () => {
		it('names evacuees and volunteers but not outside people', () => {
			expect(isIdentifiedRecipient(evacueeRecipient)).toBe(true);
			expect(isIdentifiedRecipient(volunteerRecipient)).toBe(true);
			expect(isIdentifiedRecipient(outsideRecipient)).toBe(false);
			expect(isIdentifiedRecipient(null)).toBe(false);
		});
	});

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

		it('lets a volunteer receive consumables and borrow returnable items (FR-LON-01)', () => {
			expect(canRecipientReceiveItem(volunteerRecipient, false)).toBe(true);
			expect(canRecipientReceiveItem(volunteerRecipient, true)).toBe(true);
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

		it('returns null when a volunteer borrows a returnable item (FR-LON-01)', () => {
			expect(getRecipientValidationErrorMessage(volunteerRecipient, false)).toBeNull();
			expect(getRecipientValidationErrorMessage(volunteerRecipient, true)).toBeNull();
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
			expect(res.visits).toBe(1);
			expect(res.boxes).toBe('1');
			expect(res.lastDistributedAt).toBe(priorLog.distributed_at);
		});

		it('returns isDuplicate false when no matching meal exists', () => {
			const res = checkDuplicateMealAdvisory([priorLog], 'dinner', '2026-09-20T06:00:00.000Z');
			expect(res.isDuplicate).toBe(false);
			expect(res.visits).toBe(0);
			expect(res.boxes).toBe('0');
			expect(res.lastDistributedAt).toBeUndefined();
			expect(res.distributedAt).toEqual([]);
		});

		it('detects a volunteer repeat meal the same way', () => {
			const volunteerLog: DistributionLog = {
				...priorLog,
				recipient_type: 'volunteer',
				recipient_id: volunteerRecipient.recipientId
			};
			const res = checkDuplicateMealAdvisory([volunteerLog], 'lunch', '2026-09-20T06:00:00.000Z');
			expect(res.isDuplicate).toBe(true);
		});

		it('counts visits and sums boxes across three handovers', () => {
			const logs = [
				{ ...priorLog, _id: 'a', qty: '2' },
				{ ...priorLog, _id: 'b', qty: '1' },
				{ ...priorLog, _id: 'c', qty: '3' }
			];
			const res = checkDuplicateMealAdvisory(logs, 'lunch', '2026-09-20T06:00:00.000Z');
			expect(res.visits).toBe(3);
			expect(res.boxes).toBe('6');
		});

		it('picks the latest time and lists times oldest first for out-of-order input', () => {
			const logs = [
				{ ...priorLog, _id: 'a', distributed_at: '2026-09-20T05:30:00.000Z' },
				{ ...priorLog, _id: 'b', distributed_at: '2026-09-20T03:00:00.000Z' },
				{ ...priorLog, _id: 'c', distributed_at: '2026-09-20T04:00:00.000Z' }
			];
			const res = checkDuplicateMealAdvisory(logs, 'lunch', '2026-09-20T06:00:00.000Z');
			expect(res.lastDistributedAt).toBe('2026-09-20T05:30:00.000Z');
			expect(res.distributedAt).toEqual([
				'2026-09-20T03:00:00.000Z',
				'2026-09-20T04:00:00.000Z',
				'2026-09-20T05:30:00.000Z'
			]);
		});

		it('excludes voided, loan, other-meal and other-day logs from the summary', () => {
			const logs = [
				{ ...priorLog, _id: 'ok', qty: '2' },
				{ ...priorLog, _id: 'v', status: 'voided' as const, qty: '9' },
				{ ...priorLog, _id: 'l', is_returnable: true, qty: '9' },
				{ ...priorLog, _id: 'm', meal: 'dinner' as const, qty: '9' },
				{ ...priorLog, _id: 'd', distributed_at: '2026-09-19T05:00:00.000Z', qty: '9' }
			];
			const res = checkDuplicateMealAdvisory(logs, 'lunch', '2026-09-20T06:00:00.000Z');
			expect(res.visits).toBe(1);
			expect(res.boxes).toBe('2');
		});

		it('returns isDuplicate false when logs are empty or targetMeal undefined', () => {
			expect(checkDuplicateMealAdvisory([], 'lunch').isDuplicate).toBe(false);
			expect(checkDuplicateMealAdvisory([priorLog], undefined).isDuplicate).toBe(false);
		});
	});

	describe('checkMenuMatchAdvisory', () => {
		const halalMenu = { dietary: ['HALAL'], age_group: 'ALL' };
		const generalMenu = { dietary: [], age_group: 'ALL' };

		it('flags a tagged menu for an evacuee without a shared tag', () => {
			expect(checkMenuMatchAdvisory({ ...evacueeRecipient, menuTags: [] }, halalMenu)).toEqual({
				isMismatch: true,
				menuTags: ['HALAL']
			});
		});

		it('passes an evacuee that shares a tag with the menu', () => {
			const muslim = { ...evacueeRecipient, menuTags: ['HALAL' as const] };
			expect(checkMenuMatchAdvisory(muslim, halalMenu).isMismatch).toBe(false);
		});

		it('flags tagged menus but not general ones for outside recipients', () => {
			expect(checkMenuMatchAdvisory(outsideRecipient, halalMenu).isMismatch).toBe(true);
			expect(checkMenuMatchAdvisory(outsideRecipient, generalMenu).isMismatch).toBe(false);
		});

		it('treats a volunteer as untagged: general menus pass, tagged menus flag', () => {
			expect(checkMenuMatchAdvisory(volunteerRecipient, generalMenu).isMismatch).toBe(false);
			expect(checkMenuMatchAdvisory(volunteerRecipient, halalMenu).isMismatch).toBe(true);
		});

		it('stays silent without a recipient or a known menu', () => {
			expect(checkMenuMatchAdvisory(null, halalMenu).isMismatch).toBe(false);
			expect(checkMenuMatchAdvisory(evacueeRecipient, undefined).isMismatch).toBe(false);
		});

		it('formats tags as Thai labels', () => {
			expect(formatMenuTags(['HALAL', 'ELDERLY'])).toBe('ฮาลาล, ผู้สูงอายุ');
		});
	});
	describe('checkAllergenAdvisory (#607)', () => {
		const allergyItems = [
			{
				code: 'seafood',
				label_th: 'อาหารทะเล',
				label_en: 'Seafood',
				is_default: false,
				status: 'active' as const
			},
			{
				code: 'egg',
				label_th: 'ไข่',
				label_en: 'Egg',
				is_default: false,
				status: 'active' as const
			},
			{
				code: 'wheat',
				label_th: 'แป้งสาลี',
				label_en: 'Wheat',
				is_default: false,
				status: 'active' as const
			}
		];

		it('flags the codes the recipient is allergic to (นางบีแพ้ไข่ — ข้าวผัดกุ้ง)', () => {
			const result = checkAllergenAdvisory(
				evacueeRecipient,
				['egg'],
				['seafood', 'egg'],
				allergyItems
			);
			expect(result.conflicts).toEqual(['egg']);
			expect(formatAllergyCodes(result.conflicts, allergyItems)).toBe('ไข่');
		});

		it('passes a menu without the recipient allergens (ข้าวมันไก่)', () => {
			const result = checkAllergenAdvisory(evacueeRecipient, ['egg'], ['wheat'], allergyItems);
			expect(result.conflicts).toEqual([]);
			expect(result.menuUnspecified).toBe(false);
		});

		it('maps legacy labels on both sides to codes before matching', () => {
			const result = checkAllergenAdvisory(
				evacueeRecipient,
				['ไข่'],
				['อาหารทะเล', 'ไข่'],
				allergyItems
			);
			expect(result.conflicts).toEqual(['egg']);
		});

		it('shows free-text allergies without matching them', () => {
			const result = checkAllergenAdvisory(
				evacueeRecipient,
				['เพนิซิลลิน'],
				['เพนิซิลลิน'],
				allergyItems
			);
			expect(result.recipientFreeText).toEqual(['เพนิซิลลิน']);
			expect(result.conflicts).toEqual([]);
		});

		it('notes a menu with no allergens listed when the recipient has allergies', () => {
			expect(
				checkAllergenAdvisory(evacueeRecipient, ['egg'], [], allergyItems).menuUnspecified
			).toBe(true);
			expect(checkAllergenAdvisory(evacueeRecipient, [], [], allergyItems).menuUnspecified).toBe(
				false
			);
		});

		it('skips volunteers and outside recipients', () => {
			for (const recipient of [volunteerRecipient, outsideRecipient, null]) {
				expect(checkAllergenAdvisory(recipient, ['egg'], ['egg'], allergyItems).conflicts).toEqual(
					[]
				);
			}
		});
	});
});
