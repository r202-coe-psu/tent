import { describe, expect, it } from 'vitest';
import {
	evaluateHouseholdMealPickup,
	householdMealPickupBlocks,
	type HouseholdPickupLog
} from './household-meal-pickup';

const A = 'evacuee:01J0000000000000000000000A';
const B = 'evacuee:01J0000000000000000000000B';
const C = 'evacuee:01J0000000000000000000000C';

const member = (_id: string, status: string | null = 'active') => ({
	_id,
	current_stay: status === null ? null : { status }
});

// 12:00 Bangkok on 2026-11-05.
const AT = '2026-11-05T05:00:00.000Z';

const log = (
	recipient_id: string,
	overrides: Partial<HouseholdPickupLog> = {}
): HouseholdPickupLog => ({
	recipient_id,
	meal: 'lunch',
	status: 'fulfilled',
	is_returnable: false,
	distributed_at: '2026-11-05T04:30:00.000Z',
	...overrides
});

describe('evaluateHouseholdMealPickup', () => {
	it('marks every in-shelter member eligible when nobody has received this meal', () => {
		const result = evaluateHouseholdMealPickup({
			members: [member(A), member(B, 'room_confirmed')],
			logs: [],
			meal: 'lunch',
			at: AT
		});
		expect(result).toEqual([
			{ evacuee_id: A, status: 'eligible' },
			{ evacuee_id: B, status: 'eligible' }
		]);
	});

	it('lets members awaiting admission collect, and leaves out members who are away or gone', () => {
		const result = evaluateHouseholdMealPickup({
			members: [
				member(A),
				member(B, 'checked_out'),
				member(C, 'temporary_leave'),
				member('evacuee:01J0000000000000000000000D', 'arriving'),
				member('evacuee:01J0000000000000000000000E', null),
				member('evacuee:01J0000000000000000000000F', 'kiosk_registered'),
				member('evacuee:01J0000000000000000000000G', 'pre_registered')
			],
			logs: [],
			meal: 'lunch',
			at: AT
		});
		expect(result.map((r) => r.evacuee_id)).toEqual([
			A,
			'evacuee:01J0000000000000000000000D',
			'evacuee:01J0000000000000000000000F'
		]);
	});

	it('explains why each left-out member cannot collect', () => {
		expect(
			householdMealPickupBlocks([
				member(A),
				member(B, 'checked_out'),
				member(C, 'temporary_leave'),
				member('evacuee:01J0000000000000000000000D', 'pre_registered'),
				member('evacuee:01J0000000000000000000000E', null)
			])
		).toEqual([
			{ evacuee_id: B, reason: 'เช็คเอาต์ออกจากศูนย์แล้ว' },
			{ evacuee_id: C, reason: 'ออกจากศูนย์ชั่วคราว' },
			{
				evacuee_id: 'evacuee:01J0000000000000000000000D',
				reason: 'ลงทะเบียนล่วงหน้า ยังไม่มารายงานตัวที่ศูนย์'
			},
			{
				evacuee_id: 'evacuee:01J0000000000000000000000E',
				reason: 'ยังไม่มีข้อมูลการเข้าพักในศูนย์'
			}
		]);
	});

	it('reports the latest pickup time for a member who already received this meal today', () => {
		const result = evaluateHouseholdMealPickup({
			members: [member(A), member(B)],
			logs: [
				log(B, { distributed_at: '2026-11-05T04:10:00.000Z' }),
				log(B, { distributed_at: '2026-11-05T04:40:00.000Z' })
			],
			meal: 'lunch',
			at: AT
		});
		expect(result).toEqual([
			{ evacuee_id: A, status: 'eligible' },
			{
				evacuee_id: B,
				status: 'already_received',
				last_distributed_at: '2026-11-05T04:40:00.000Z'
			}
		]);
	});

	it('ignores voided logs, loans, other meals, other members and yesterday (Thailand day)', () => {
		const result = evaluateHouseholdMealPickup({
			members: [member(A)],
			logs: [
				log(A, { status: 'voided' }),
				log(A, { is_returnable: true, status: 'active' }),
				log(A, { meal: 'dinner' }),
				log(B),
				// 23:30 Bangkok on 2026-11-04.
				log(A, { distributed_at: '2026-11-04T16:30:00.000Z' })
			],
			meal: 'lunch',
			at: AT
		});
		expect(result).toEqual([{ evacuee_id: A, status: 'eligible' }]);
	});

	it('counts a pickup just after midnight Bangkok as today even though it is yesterday in UTC', () => {
		const result = evaluateHouseholdMealPickup({
			members: [member(A)],
			// 00:30 Bangkok on 2026-11-05.
			logs: [log(A, { meal: 'breakfast', distributed_at: '2026-11-04T17:30:00.000Z' })],
			meal: 'breakfast',
			at: AT
		});
		expect(result[0].status).toBe('already_received');
	});
});
