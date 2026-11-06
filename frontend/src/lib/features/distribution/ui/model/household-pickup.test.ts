import { describe, expect, it } from 'vitest';
import { buildHouseholdPickupRows, isPreselected } from './household-pickup';

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
