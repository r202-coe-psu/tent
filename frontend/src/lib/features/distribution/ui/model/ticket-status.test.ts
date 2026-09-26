import { describe, expect, it } from 'vitest';
import {
	REQUISITION_TICKET_STATUSES,
	TICKET_STATUS_LABELS,
	TICKET_STATUS_BADGE_CLASSES,
	getTicketStatusLabel,
	getTicketStatusBadgeClass,
	getRequisitionTypeLabel,
	getMealPeriodLabel,
	getReconciliationStatusRank,
	compareByReconciliationProgress,
	REQUISITION_TYPE_LABELS,
	MEAL_PERIOD_LABELS
} from './ticket-status';
import type { RequisitionTicketStatus } from '../../domain/food-supplies';

describe('Ticket Status Model & Labels (Slice 5.1 §16, §44)', () => {
	it('defines all 9 canonical statuses', () => {
		expect(REQUISITION_TICKET_STATUSES).toHaveLength(9);
		expect(REQUISITION_TICKET_STATUSES).toEqual([
			'PENDING_PICK',
			'READY_FOR_DISPATCH',
			'IN_TRANSIT',
			'DISTRIBUTING',
			'SHIFT_CLOSED',
			'RETURN_PENDING_RECEIPT',
			'RETURN_COMPLETED',
			'COMPLETED',
			'CANCELLED'
		]);
	});

	it('maps all 9 canonical statuses to exact Thai copy', () => {
		const expectedLabels: Record<RequisitionTicketStatus, string> = {
			PENDING_PICK: 'รอจัดของ',
			READY_FOR_DISPATCH: 'พร้อมส่งออก',
			IN_TRANSIT: 'กำลังนำส่ง',
			DISTRIBUTING: 'กำลังแจกจ่าย',
			SHIFT_CLOSED: 'ปิดรอบแจกแล้ว',
			RETURN_PENDING_RECEIPT: 'รอคลังตรวจรับคืน',
			RETURN_COMPLETED: 'ตรวจรับคืนแล้ว',
			COMPLETED: 'เสร็จสมบูรณ์',
			CANCELLED: 'ยกเลิก'
		};

		for (const status of REQUISITION_TICKET_STATUSES) {
			expect(TICKET_STATUS_LABELS[status]).toBe(expectedLabels[status]);
			expect(getTicketStatusLabel(status)).toBe(expectedLabels[status]);
		}
	});

	it('defines Civic Light Design System badge style tokens for all 9 statuses', () => {
		for (const status of REQUISITION_TICKET_STATUSES) {
			const badgeClass = getTicketStatusBadgeClass(status);
			expect(badgeClass).toBeDefined();
			// Complete 360-degree perimeter border per Civic Light rules
			expect(badgeClass).toContain('border');
			expect(TICKET_STATUS_BADGE_CLASSES[status]).toBe(badgeClass);
		}
	});

	it('provides Thai labels for flow 2 requisition types', () => {
		expect(REQUISITION_TYPE_LABELS.food).toBe('อาหาร');
		expect(REQUISITION_TYPE_LABELS.supplies).toBe('พัสดุ');
		expect(getRequisitionTypeLabel('food')).toBe('อาหาร');
		expect(getRequisitionTypeLabel('supplies')).toBe('พัสดุ');
	});

	it('provides Thai labels for all meal periods', () => {
		expect(MEAL_PERIOD_LABELS.breakfast).toBe('เช้า');
		expect(MEAL_PERIOD_LABELS.lunch).toBe('กลางวัน');
		expect(MEAL_PERIOD_LABELS.dinner).toBe('เย็น');
		expect(MEAL_PERIOD_LABELS.snack).toBe('อาหารว่าง');
		expect(getMealPeriodLabel('breakfast')).toBe('เช้า');
		expect(getMealPeriodLabel('lunch')).toBe('กลางวัน');
		expect(getMealPeriodLabel('dinner')).toBe('เย็น');
		expect(getMealPeriodLabel('snack')).toBe('อาหารว่าง');
	});

	describe('reconciliation selector workflow-progress ordering', () => {
		it('ranks each reconciliation-eligible status strictly below the next workflow stage', () => {
			expect(getReconciliationStatusRank('DISTRIBUTING')).toBeLessThan(
				getReconciliationStatusRank('SHIFT_CLOSED')
			);
			expect(getReconciliationStatusRank('SHIFT_CLOSED')).toBeLessThan(
				getReconciliationStatusRank('RETURN_PENDING_RECEIPT')
			);
			expect(getReconciliationStatusRank('RETURN_PENDING_RECEIPT')).toBeLessThan(
				getReconciliationStatusRank('RETURN_COMPLETED')
			);
			expect(getReconciliationStatusRank('RETURN_COMPLETED')).toBeLessThan(
				getReconciliationStatusRank('COMPLETED')
			);
		});

		it('ranks every unfinished status strictly before COMPLETED', () => {
			for (const status of [
				'DISTRIBUTING',
				'SHIFT_CLOSED',
				'RETURN_PENDING_RECEIPT',
				'RETURN_COMPLETED'
			] as const) {
				expect(getReconciliationStatusRank(status)).toBeLessThan(
					getReconciliationStatusRank('COMPLETED')
				);
			}
		});

		it('sorts a shuffled ticket list into the exact workflow-progress order with COMPLETED last', () => {
			const shuffled = [
				{ _id: 'a', status: 'COMPLETED' as RequisitionTicketStatus },
				{ _id: 'b', status: 'RETURN_PENDING_RECEIPT' as RequisitionTicketStatus },
				{ _id: 'c', status: 'DISTRIBUTING' as RequisitionTicketStatus },
				{ _id: 'd', status: 'RETURN_COMPLETED' as RequisitionTicketStatus },
				{ _id: 'e', status: 'SHIFT_CLOSED' as RequisitionTicketStatus }
			];

			const sorted = [...shuffled].sort(compareByReconciliationProgress);

			expect(sorted.map((t) => t.status)).toEqual([
				'DISTRIBUTING',
				'SHIFT_CLOSED',
				'RETURN_PENDING_RECEIPT',
				'RETURN_COMPLETED',
				'COMPLETED'
			]);
		});

		it('preserves the original relative order for tickets sharing the same status (stable sort)', () => {
			const shuffled = [
				{ _id: 'first-completed', status: 'COMPLETED' as RequisitionTicketStatus },
				{ _id: 'active', status: 'DISTRIBUTING' as RequisitionTicketStatus },
				{ _id: 'second-completed', status: 'COMPLETED' as RequisitionTicketStatus }
			];

			const sorted = [...shuffled].sort(compareByReconciliationProgress);

			expect(sorted.map((t) => t._id)).toEqual(['active', 'first-completed', 'second-completed']);
		});
	});
});
