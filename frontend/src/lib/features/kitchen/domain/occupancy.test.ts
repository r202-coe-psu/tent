import { describe, it, expect } from 'vitest';
import { deriveHeadcountFromOccupancy, type OccupantView } from './occupancy';

const occ = (o: Partial<OccupantView> & { status: string }): OccupantView => ({
	current_stay: { status: o.status },
	religion: o.religion,
	special_needs: o.special_needs
});

describe('deriveHeadcountFromOccupancy (CR-022)', () => {
	it('counts only checked_in evacuees as total', () => {
		const h = deriveHeadcountFromOccupancy([
			occ({ status: 'checked_in' }),
			occ({ status: 'checked_in' }),
			occ({ status: 'registered' }),
			occ({ status: 'checked_out' }),
			occ({ status: 'transferred' })
		]);
		expect(h.total).toBe(2);
	});

	it('derives halal from religion=muslim among the present', () => {
		const h = deriveHeadcountFromOccupancy([
			occ({ status: 'checked_in', religion: 'muslim' }),
			occ({ status: 'checked_in', religion: 'buddhist' }),
			occ({ status: 'checked_out', religion: 'muslim' }) // not present → excluded
		]);
		expect(h.total).toBe(2);
		expect(h.halal).toBe(1);
	});

	it('maps infant + soft_food from special_needs', () => {
		const h = deriveHeadcountFromOccupancy([
			occ({ status: 'checked_in', special_needs: ['infant'] }),
			occ({ status: 'checked_in', special_needs: ['bedridden'] }),
			occ({ status: 'checked_in', special_needs: ['chronic_illness'] }),
			occ({ status: 'checked_in', special_needs: ['elderly'] }),
			occ({ status: 'checked_in', special_needs: ['disabled'] }) // not a soft_food need
		]);
		expect(h.infant).toBe(1);
		expect(h.soft_food).toBe(3);
	});

	it('sub-counts are orthogonal — a muslim infant counts in both', () => {
		const h = deriveHeadcountFromOccupancy([
			occ({ status: 'checked_in', religion: 'muslim', special_needs: ['infant'] })
		]);
		expect(h.total).toBe(1);
		expect(h.halal).toBe(1);
		expect(h.infant).toBe(1);
	});

	it('handles empty and missing fields', () => {
		expect(deriveHeadcountFromOccupancy([])).toEqual({
			total: 0,
			halal: 0,
			soft_food: 0,
			infant: 0
		});
		const h = deriveHeadcountFromOccupancy([occ({ status: 'checked_in' })]);
		expect(h).toEqual({ total: 1, halal: 0, soft_food: 0, infant: 0 });
	});
});
