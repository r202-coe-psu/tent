import { describe, it, expect } from 'vitest';
import {
	countCheckedIn,
	createInventoryItem,
	createOccupant,
	createStockTxn,
	deriveQuantities,
	parseAccessibleShelters,
	shelterDbName,
	shelterRole,
	type Occupant
} from './shelter';

describe('shelterDbName / shelterRole', () => {
	it('maps ids to lowercase db names and role strings', () => {
		expect(shelterDbName('A')).toBe('shelter_a');
		expect(shelterRole('B', 'manager')).toBe('shelter_b_manager');
		expect(shelterRole('C', 'volunteer')).toBe('shelter_c_volunteer');
	});
});

describe('parseAccessibleShelters', () => {
	it('extracts shelter access from roles', () => {
		expect(parseAccessibleShelters(['shelter_a_volunteer'])).toEqual([
			{ id: 'A', role: 'volunteer' }
		]);
	});

	it('ignores unrelated non-admin roles', () => {
		expect(parseAccessibleShelters(['team:alpha'])).toEqual([]);
	});

	it('grants _admin every shelter as manager', () => {
		expect(parseAccessibleShelters(['_admin'])).toEqual([
			{ id: 'A', role: 'manager' },
			{ id: 'B', role: 'manager' },
			{ id: 'C', role: 'manager' }
		]);
	});

	it('returns multiple shelters in id order', () => {
		const access = parseAccessibleShelters(['shelter_c_volunteer', 'shelter_a_manager']);
		expect(access).toEqual([
			{ id: 'A', role: 'manager' },
			{ id: 'C', role: 'volunteer' }
		]);
	});

	it('lets manager outrank volunteer for the same shelter', () => {
		const access = parseAccessibleShelters(['shelter_a_volunteer', 'shelter_a_manager']);
		expect(access).toEqual([{ id: 'A', role: 'manager' }]);
	});
});

describe('countCheckedIn', () => {
	it('counts only occupants with status "in"', () => {
		const occ = (status: Occupant['status']): Occupant => ({
			_id: `occupant:${Math.random()}`,
			type: 'occupant',
			name: 'x',
			note: '',
			status,
			checkInAt: new Date().toISOString()
		});
		expect(countCheckedIn([occ('in'), occ('in'), occ('out')])).toBe(2);
	});
});

describe('deriveQuantities', () => {
	it('sums txn deltas per item and starts items at zero', () => {
		const water = createInventoryItem({ name: 'Water', unit: 'pcs' });
		const blanket = createInventoryItem({ name: 'Blanket', unit: 'pcs' });
		const txns = [
			createStockTxn({ itemId: water._id, delta: 100, reason: 'open', byUser: 'sys' }),
			createStockTxn({ itemId: water._id, delta: -30, reason: 'give', byUser: 'vol' })
		];
		const qty = deriveQuantities([water, blanket], txns);
		expect(qty.get(water._id)).toBe(70);
		expect(qty.get(blanket._id)).toBe(0);
	});
});

describe('factories', () => {
	it('creates a checked-in occupant', () => {
		const o = createOccupant({ name: 'Alice', note: '' });
		expect(o.type).toBe('occupant');
		expect(o.status).toBe('in');
		expect(o._id.startsWith('occupant:')).toBe(true);
	});

	it('rejects an empty occupant name', () => {
		expect(() => createOccupant({ name: '  ', note: '' })).toThrow();
	});
});
