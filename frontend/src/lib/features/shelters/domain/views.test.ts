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

		it('emits unknown if no birth_year', () => {
			mapFn({ type: 'evacuee' }, mockEmit);
			expect(emitted).toEqual([{ key: 'unknown', value: 1 }]);
		});

		it('calculates correct age buckets', () => {
			const currentYear = new Date().getFullYear();
			// 0-4 bucket
			mapFn({ type: 'evacuee', birth_year: currentYear + 543 - 3 }, mockEmit);
			expect(emitted[0]).toEqual({ key: '0-4', value: 1 });
			emitted = [];

			// 5-11 bucket
			mapFn({ type: 'evacuee', birth_year: currentYear + 543 - 8 }, mockEmit);
			expect(emitted[0]).toEqual({ key: '5-11', value: 1 });
			emitted = [];
			// 12-17 bucket
			mapFn({ type: 'evacuee', birth_year: currentYear + 543 - 15 }, mockEmit);
			expect(emitted[0]).toEqual({ key: '12-17', value: 1 });
			emitted = [];
			// 18-59 bucket
			mapFn({ type: 'evacuee', birth_year: currentYear + 543 - 30 }, mockEmit);
			expect(emitted[0]).toEqual({ key: '18-59', value: 1 });
			emitted = [];
			// 60+ bucket
			mapFn({ type: 'evacuee', birth_year: currentYear + 543 - 65 }, mockEmit);
			expect(emitted[0]).toEqual({ key: '60+', value: 1 });
		});
	});

	describe('demographics_by_country', () => {
		const mapFn = createMapFn(SHELTER_DASHBOARD_VIEWS.views.demographics_by_country.map);

		it('emits UNKNOWN if no country', () => {
			mapFn({ type: 'evacuee' }, mockEmit);
			expect(emitted).toEqual([{ key: 'UNKNOWN', value: 1 }]);
		});

		it('normalizes country names to uppercase and trims', () => {
			mapFn({ type: 'evacuee', country: ' thailand ' }, mockEmit);
			expect(emitted).toEqual([{ key: 'THAILAND', value: 1 }]);
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
			mapFn({ type: 'movement', action: 'check_in', occurred_at: '2026-07-01T23:00:00Z' }, mockEmit);
			expect(emitted).toEqual([{ key: ['2026-07-02', 'checkin'], value: 1 }]);
		});

		it('emits checkout for check_out and transfer_out actions', () => {
			mapFn({ type: 'movement', action: 'transfer_out', occurred_at: '2026-07-01T12:00:00Z' }, mockEmit);
			expect(emitted).toEqual([{ key: ['2026-07-01', 'checkout'], value: 1 }]);
		});
	});
});
