import { describe, expect, it } from 'vitest';
import {
	buildHouseholdPickupRows,
	isPreselected,
	isSelectedByDefault,
	notPreselectedReasons,
	picksAfterPartialFailure
} from './household-pickup';

const A = 'evacuee:01J0000000000000000000000A';
const B = 'evacuee:01J0000000000000000000000B';
const C = 'evacuee:01J0000000000000000000000C';
const AT = '2026-11-05T05:00:00.000Z';

const member = (_id: string, first_name: string, status = 'active') => ({
	_id,
	first_name,
	last_name: 'ใจดี',
	current_stay: { status }
});

const base = {
	members: [member(A, 'ก'), member(B, 'ข'), member(C, 'ค', 'checked_out')],
	logs: [],
	meal: 'lunch' as const,
	at: AT,
	collectorId: B,
	menu: undefined,
	menuAllergens: [],
	allergiesByEvacuee: {},
	allergyItems: [{ code: 'egg', label_th: 'ไข่', active: true }] as never
};

describe('buildHouseholdPickupRows', () => {
	it('lists in-shelter members, collector first, all pre-selected when nobody has eaten', () => {
		const rows = buildHouseholdPickupRows(base);
		expect(rows.map((r) => [r.evacueeId, r.isCollector, r.label])).toEqual([
			[B, true, 'ข ใจดี'],
			[A, false, 'ก ใจดี']
		]);
		expect(rows.every(isPreselected)).toBe(true);
	});

	it('does not pre-select a member who already received this meal and shows when', () => {
		const rows = buildHouseholdPickupRows({
			...base,
			logs: [
				{
					recipient_id: A,
					meal: 'lunch',
					status: 'fulfilled',
					is_returnable: false,
					distributed_at: '2026-11-05T04:30:00.000Z'
				}
			]
		});
		const a = rows.find((r) => r.evacueeId === A)!;
		expect(a.lastDistributedAt).toBe('2026-11-05T04:30:00.000Z');
		expect(isPreselected(a)).toBe(false);
	});

	it('flags an allergen conflict for the member who has it only', () => {
		const rows = buildHouseholdPickupRows({
			...base,
			menuAllergens: ['egg'],
			allergiesByEvacuee: { [A]: ['egg'] }
		});
		const a = rows.find((r) => r.evacueeId === A)!;
		const b = rows.find((r) => r.evacueeId === B)!;
		expect(a.allergenConflictLabel).toBe('ไข่');
		expect(isPreselected(a)).toBe(false);
		expect(b.allergenConflictLabel).toBeNull();
		expect(isPreselected(b)).toBe(true);
	});
});

describe('picksAfterPartialFailure', () => {
	it('unticks members that saved and lets failed ones fall back to their defaults', () => {
		const rows = buildHouseholdPickupRows(base);
		const picks = picksAfterPartialFailure(rows, new Set([A]), (id) => id);
		expect(picks).toEqual({ [B]: false });
	});

	it('leaves a failed write that actually landed unselected once logs refresh', () => {
		const landed = buildHouseholdPickupRows({
			...base,
			logs: [
				{
					recipient_id: A,
					meal: 'lunch',
					status: 'fulfilled',
					is_returnable: false,
					distributed_at: AT
				}
			] as never
		});
		const picks = picksAfterPartialFailure(landed, new Set([A]), (id) => id);
		const rowA = landed.find((r) => r.evacueeId === A)!;
		expect(picks[A] ?? isPreselected(rowA)).toBe(false);
	});
});

describe('notPreselectedReasons', () => {
	it('gives no reason for a member who is ticked by default', () => {
		const [collector] = buildHouseholdPickupRows(base);
		expect(notPreselectedReasons(collector)).toEqual([]);
	});

	it('says why each unticked member was left out', () => {
		const rows = buildHouseholdPickupRows({
			...base,
			logs: [
				{
					recipient_id: A,
					meal: 'lunch',
					status: 'fulfilled',
					is_returnable: false,
					distributed_at: '2026-11-05T04:30:00.000Z'
				}
			],
			menuAllergens: ['egg'],
			allergiesByEvacuee: { [A]: ['egg', 'เพนิซิลลิน'] },
			allergyItems: [{ code: 'egg', label_th: 'ไข่', label_en: 'Egg', active: true }] as never
		});
		const a = rows.find((r) => r.evacueeId === A)!;
		expect(notPreselectedReasons(a)).toEqual([
			'รับมื้อนี้ไปแล้วเมื่อ 11:30 น.',
			'เมนูนี้มี ไข่ ซึ่งผู้รับแพ้',
			'มีประวัติแพ้ที่ระบบเทียบกับเมนูให้ไม่ได้: เพนิซิลลิน'
		]);
	});
});

describe('isSelectedByDefault', () => {
	const allergic = buildHouseholdPickupRows({
		...base,
		menuAllergens: ['egg'],
		allergiesByEvacuee: { [A]: ['egg'] }
	}).find((r) => r.evacueeId === A)!;

	it('follows the pre-selection rule for members that did not fail', () => {
		expect(isSelectedByDefault(allergic, new Set())).toBe(false);
	});

	it('keeps a failed override member ticked for the retry', () => {
		expect(isSelectedByDefault(allergic, new Set([A]))).toBe(true);
	});

	it('unticks a failed member whose write landed after all', () => {
		const landed = { ...allergic, lastDistributedAt: AT };
		expect(isSelectedByDefault(landed, new Set([A]))).toBe(false);
	});
});
