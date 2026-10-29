import { describe, expect, it } from 'vitest';
import type { RequisitionTicketStatus } from '../../domain/food-supplies';
import {
	DESK_MODES,
	isDeskMode,
	modePendingCount,
	needsCloseOutAction,
	resolveInitialMode,
	stepAfterModeSwitch,
	stepLabel,
	ticketsForMode
} from './desk-mode';

const ticket = (requisition_type: 'food' | 'supplies', status: RequisitionTicketStatus) => ({
	requisition_type,
	status
});

describe('desk mode steps', () => {
	it('numbers each mode from 1 in its own order', () => {
		expect(DESK_MODES.food.steps.map((tab) => stepLabel('food', tab))).toEqual([
			'1. รับของถึงจุดแจก',
			'2. แจกอาหารปรุงสุก',
			'3. ปิดรอบ & คืนของ'
		]);
		expect(DESK_MODES.supplies.steps.map((tab) => stepLabel('supplies', tab))).toEqual([
			'1. รับของถึงจุดแจก',
			'2. จ่ายพัสดุ & ยืม-คืน',
			'3. รับคืนสิ่งของ',
			'4. ปิดรอบ & คืนของ'
		]);
	});

	it('leaves a step the mode does not have unnumbered', () => {
		expect(stepLabel('food', 'returns')).toBe('รับคืนสิ่งของ');
	});
});

describe('ticketsForMode', () => {
	it('keeps only tickets of the mode ticket type', () => {
		const tickets = [ticket('food', 'IN_TRANSIT'), ticket('supplies', 'IN_TRANSIT')];
		expect(ticketsForMode(tickets, 'food')).toEqual([tickets[0]]);
		expect(ticketsForMode(tickets, 'supplies')).toEqual([tickets[1]]);
	});
});

describe('resolveInitialMode', () => {
	it('prefers the URL over the remembered mode', () => {
		expect(resolveInitialMode('supplies', 'food')).toBe('supplies');
	});

	it('falls back to the remembered mode, then to food', () => {
		expect(resolveInitialMode(null, 'supplies')).toBe('supplies');
		expect(resolveInitialMode(null, null)).toBe('food');
	});

	it('ignores invalid values, including inherited object keys', () => {
		expect(resolveInitialMode('drinks', 'supplies')).toBe('supplies');
		expect(resolveInitialMode('toString', 'nope')).toBe('food');
		expect(isDeskMode('constructor')).toBe(false);
	});
});

describe('stepAfterModeSwitch', () => {
	it('keeps a step both modes share', () => {
		expect(stepAfterModeSwitch('reconciliation', 'supplies')).toBe('reconciliation');
		expect(stepAfterModeSwitch('receive', 'food')).toBe('receive');
	});

	it('starts at step 1 when the new mode lacks the step', () => {
		expect(stepAfterModeSwitch('food', 'supplies')).toBe('receive');
		expect(stepAfterModeSwitch('returns', 'food')).toBe('receive');
	});
});

describe('modePendingCount', () => {
	it('counts in-transit and close-out tickets of the mode only', () => {
		const tickets = [
			ticket('supplies', 'IN_TRANSIT'),
			ticket('supplies', 'SHIFT_CLOSED'),
			ticket('supplies', 'RETURN_COMPLETED'),
			ticket('supplies', 'DISTRIBUTING'),
			ticket('supplies', 'RETURN_PENDING_RECEIPT'),
			ticket('supplies', 'COMPLETED'),
			ticket('food', 'IN_TRANSIT')
		];
		expect(modePendingCount(tickets, 'supplies')).toBe(3);
		expect(modePendingCount(tickets, 'food')).toBe(1);
	});

	it('is zero with no tickets', () => {
		expect(modePendingCount([], 'food')).toBe(0);
	});
});

describe('needsCloseOutAction', () => {
	it('is true only after shift close or a verified return', () => {
		expect(needsCloseOutAction({ status: 'SHIFT_CLOSED' })).toBe(true);
		expect(needsCloseOutAction({ status: 'RETURN_COMPLETED' })).toBe(true);
		expect(needsCloseOutAction({ status: 'DISTRIBUTING' })).toBe(false);
	});
});
