import { describe, it, expect, beforeEach } from 'vitest';
import { SHELTER_DASHBOARD_VIEWS } from './views';

describe('SHELTER_DASHBOARD_VIEWS Map Functions', () => {
	let emitted: { key: unknown; value: unknown }[] = [];

	// Mock CouchDB emit
	const mockEmit = (key: unknown, value: unknown) => {
		emitted.push({ key, value });
	};

	beforeEach(() => {
		emitted = [];
	});

	const createMapFn = (mapStr: string) => {
		return new Function(
			'doc',
			'emit',
			`
            const fn = ${mapStr};
            fn(doc);
        `
		);
	};

	describe('occupancy', () => {
		const mapFn = createMapFn(SHELTER_DASHBOARD_VIEWS.views.occupancy.map);

		it('ignores non-evacuee docs', () => {
			mapFn({ type: 'other' }, mockEmit);
			expect(emitted).toHaveLength(0);
		});

		it('emits current_stay.status', () => {
			mapFn({ type: 'evacuee', current_stay: { status: 'registered' } }, mockEmit);
			expect(emitted).toEqual([{ key: 'registered', value: 1 }]);
		});
	});

	describe('demographics_by_age', () => {
		const mapFn = createMapFn(SHELTER_DASHBOARD_VIEWS.views.demographics_by_age.map);

		it('ignores evacuees who are not active in the shelter', () => {
			mapFn({ type: 'evacuee', current_stay: { status: 'pre_registered' } }, mockEmit);
			expect(emitted).toHaveLength(0);
		});

		it('emits a null key if no birth_year', () => {
			mapFn({ type: 'evacuee', current_stay: { status: 'active' } }, mockEmit);
			expect(emitted).toEqual([{ key: null, value: 1 }]);
		});

		it('emits the birth year as a deterministic key', () => {
			mapFn({ type: 'evacuee', current_stay: { status: 'active' }, birth_year: 2536 }, mockEmit);
			expect(emitted).toEqual([{ key: 2536, value: 1 }]);
		});

		it('counts room_confirmed as in the shelter (CR-170)', () => {
			mapFn(
				{ type: 'evacuee', current_stay: { status: 'room_confirmed' }, birth_year: 2540 },
				mockEmit
			);
			expect(emitted).toEqual([{ key: 2540, value: 1 }]);
		});

		it('ignores arriving and temporary_leave', () => {
			mapFn({ type: 'evacuee', current_stay: { status: 'arriving' } }, mockEmit);
			mapFn({ type: 'evacuee', current_stay: { status: 'temporary_leave' } }, mockEmit);
			expect(emitted).toHaveLength(0);
		});
	});

	describe('demographics_by_country', () => {
		const mapFn = createMapFn(SHELTER_DASHBOARD_VIEWS.views.demographics_by_country.map);

		it('ignores evacuees who are not active in the shelter', () => {
			mapFn({ type: 'evacuee', current_stay: { status: 'checked_out' } }, mockEmit);
			expect(emitted).toHaveLength(0);
		});

		it('emits UNKNOWN if no country', () => {
			mapFn({ type: 'evacuee', current_stay: { status: 'active' } }, mockEmit);
			expect(emitted).toEqual([{ key: 'UNKNOWN', value: 1 }]);
		});

		it('normalizes country names to uppercase and trims', () => {
			mapFn(
				{ type: 'evacuee', current_stay: { status: 'active' }, country: ' thailand ' },
				mockEmit
			);
			expect(emitted).toEqual([{ key: 'THAILAND', value: 1 }]);
		});

		it('counts room_confirmed as in the shelter (CR-170)', () => {
			mapFn(
				{ type: 'evacuee', current_stay: { status: 'room_confirmed' }, country: 'myanmar' },
				mockEmit
			);
			expect(emitted).toEqual([{ key: 'MYANMAR', value: 1 }]);
		});
	});

	describe('registrations_by_date_status', () => {
		const mapFn = createMapFn(SHELTER_DASHBOARD_VIEWS.views.registrations_by_date_status.map);

		it('ignores docs without occurred_at', () => {
			mapFn({ type: 'movement', action: 'check_in' }, mockEmit);
			expect(emitted).toHaveLength(0);
		});

		it('ignores non-movement docs', () => {
			mapFn({ type: 'evacuee', occurred_at: '2026-07-01T12:00:00Z', action: 'check_in' }, mockEmit);
			expect(emitted).toHaveLength(0);
		});

		it('emits checkin for check_in and transfer_in actions with +7 offset', () => {
			// UTC 2026-07-01 23:00 is 2026-07-02 06:00 in Thailand
			mapFn(
				{ type: 'movement', action: 'check_in', occurred_at: '2026-07-01T23:00:00Z' },
				mockEmit
			);
			expect(emitted).toEqual([{ key: ['2026-07-02', 'checkin'], value: 1 }]);
		});

		it('emits checkout for check_out and transfer_out actions', () => {
			mapFn(
				{ type: 'movement', action: 'transfer_out', occurred_at: '2026-07-01T12:00:00Z' },
				mockEmit
			);
			expect(emitted).toEqual([{ key: ['2026-07-01', 'checkout'], value: 1 }]);
		});
	});

	describe('bulk_return_pool_item_totals', () => {
		const view = SHELTER_DASHBOARD_VIEWS.views.bulk_return_pool_item_totals;
		const mapFn = createMapFn(view.map);
		const P1 = 'bulk_return_pool:01J00000000000000000000001';
		const P2 = 'bulk_return_pool:01J00000000000000000000002';
		const E1 = 'bulk_return_entry:01J00000000000000000000003';

		it('uses the built-in _sum reduce', () => {
			expect(view.reduce).toBe('_sum');
		});

		it('ignores other doc types', () => {
			mapFn({ type: 'bulk_return_pool', _id: P1 }, mockEmit);
			expect(emitted).toHaveLength(0);
		});

		it('emits [qty, 1] keyed by [pool, item, entry] for an entry', () => {
			mapFn(
				{ type: 'bulk_return_entry', _id: E1, pool_id: P1, item_id: 'item:cot', qty: '3' },
				mockEmit
			);
			expect(emitted).toEqual([{ key: [P1, 'item:cot', E1], value: [3, 1] }]);
		});

		it('emits a negative row for the source pool and a positive row for the target on a move', () => {
			mapFn(
				{
					type: 'bulk_return_entry_move',
					_id: `bulk_return_entry_move:01J00000000000000000000003:0001`,
					entry_id: E1,
					from_pool_id: P1,
					to_pool_id: P2,
					item_id: 'item:cot',
					qty: '3'
				},
				mockEmit
			);
			expect(emitted).toEqual([
				{ key: [P1, 'item:cot', E1], value: [-3, -1] },
				{ key: [P2, 'item:cot', E1], value: [3, 1] }
			]);
		});
	});
});
