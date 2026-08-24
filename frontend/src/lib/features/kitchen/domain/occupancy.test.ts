import { describe, it, expect } from 'vitest';
import { deriveHeadcountFromOccupancy, type OccupantView } from './occupancy';

const occ = (o: Partial<OccupantView> & { status: string }): OccupantView => ({
	current_stay: { status: o.status },
	religion: o.religion,
	special_needs: o.special_needs
});

describe('deriveHeadcountFromOccupancy (CR-022 mapping, CR-035 status rename)', () => {
	it('counts only active (in-shelter) evacuees as total', () => {
		const h = deriveHeadcountFromOccupancy([
			occ({ status: 'active' }),
			occ({ status: 'active' }),
			occ({ status: 'pre_registered' }),
			occ({ status: 'checked_out' }),
			occ({ status: 'transferred' })
		]);
		expect(h.total).toBe(2);
	});

	it('ignores the legacy checked_in status (pre-CR-035 value no longer counts)', () => {
		const h = deriveHeadcountFromOccupancy([occ({ status: 'checked_in' })]);
		expect(h.total).toBe(0);
	});

	it('excludes temporary_leave / deceased / cancelled from headcount', () => {
		const h = deriveHeadcountFromOccupancy([
			occ({ status: 'temporary_leave' }),
			occ({ status: 'deceased' }),
			occ({ status: 'cancelled' })
		]);
		expect(h.total).toBe(0);
	});

	it('counts exactly one of the seven stay statuses (active)', () => {
		// Mirrors people/domain/people.ts stayStatusSchema verbatim — kept as a
		// local literal list (not imported) so this domain module stays
		// people-agnostic.
		const ALL_STAY_STATUSES = [
			'pre_registered',
			'active',
			'temporary_leave',
			'transferred',
			'checked_out',
			'deceased',
			'cancelled'
		] as const;
		const h = deriveHeadcountFromOccupancy(ALL_STAY_STATUSES.map((status) => occ({ status })));
		expect(h.total).toBe(1);
	});

	it('derives halal from religion=muslim among the present', () => {
		const h = deriveHeadcountFromOccupancy([
			occ({ status: 'active', religion: 'muslim' }),
			occ({ status: 'active', religion: 'buddhist' }),
			occ({ status: 'checked_out', religion: 'muslim' }) // not present → excluded
		]);
		expect(h.total).toBe(2);
		expect(h.halal).toBe(1);
	});

	it('maps infant + soft_food from special_needs', () => {
		const h = deriveHeadcountFromOccupancy([
			occ({ status: 'active', special_needs: ['infant'] }),
			occ({ status: 'active', special_needs: ['bedridden'] }),
			occ({ status: 'active', special_needs: ['chronic_illness'] }),
			occ({ status: 'active', special_needs: ['elderly'] }),
			occ({ status: 'active', special_needs: ['disabled'] }) // not a soft_food need
		]);
		expect(h.infant).toBe(1);
		expect(h.soft_food).toBe(3);
	});

	it('sub-counts are orthogonal — a muslim infant counts in both', () => {
		const h = deriveHeadcountFromOccupancy([
			occ({ status: 'active', religion: 'muslim', special_needs: ['infant'] })
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
		const h = deriveHeadcountFromOccupancy([occ({ status: 'active' })]);
		expect(h).toEqual({ total: 1, halal: 0, soft_food: 0, infant: 0 });
	});
});
