import { describe, it, expect } from 'vitest';
import {
	shiftFillRate,
	bucketFillRate,
	overallBookingRate,
	bucketCounts,
	jobShiftCapacities
} from './capacity';

describe('shiftFillRate', () => {
	it('computes confirmed / target', () => {
		expect(shiftFillRate({ target: 10, confirmed: 4 })).toBeCloseTo(0.4);
	});

	it('clamps at 1 when overbooked', () => {
		expect(shiftFillRate({ target: 4, confirmed: 6 })).toBe(1);
	});

	it('reads target <= 0 as 0', () => {
		expect(shiftFillRate({ target: 0, confirmed: 0 })).toBe(0);
	});

	it('treats a negative confirmed count as 0', () => {
		expect(shiftFillRate({ target: 10, confirmed: -2 })).toBe(0);
	});
});

describe('bucketFillRate boundaries', () => {
	it('is critical strictly below 50%', () => {
		expect(bucketFillRate(0.49)).toBe('critical');
		expect(bucketFillRate(0)).toBe('critical');
	});

	it('is near at exactly 50%', () => {
		expect(bucketFillRate(0.5)).toBe('near');
	});

	it('is near just under 100%', () => {
		expect(bucketFillRate(0.99)).toBe('near');
	});

	it('is met at exactly 100%', () => {
		expect(bucketFillRate(1)).toBe('met');
	});
});

describe('overallBookingRate', () => {
	it('aggregates across shift buckets', () => {
		const rate = overallBookingRate([
			{ target: 10, confirmed: 5 },
			{ target: 10, confirmed: 10 }
		]);
		expect(rate).toBeCloseTo(0.75);
	});

	it('is 0 for an empty input', () => {
		expect(overallBookingRate([])).toBe(0);
	});

	it('is 0 when every bucket has target 0', () => {
		expect(overallBookingRate([{ target: 0, confirmed: 0 }])).toBe(0);
	});
});

describe('bucketCounts', () => {
	it('tallies shift buckets into critical/near/met', () => {
		expect(
			bucketCounts([
				{ target: 10, confirmed: 2 }, // critical
				{ target: 10, confirmed: 5 }, // near (exactly 50%)
				{ target: 10, confirmed: 9 }, // near
				{ target: 10, confirmed: 10 } // met
			])
		).toEqual({ critical: 1, near: 2, met: 1 });
	});

	it('is all zero for an empty input', () => {
		expect(bucketCounts([])).toEqual({ critical: 0, near: 0, met: 0 });
	});
});

describe('jobShiftCapacities', () => {
	const job = (shifts: { id: string; quota: number }[], confirmed: number) => ({
		_id: 'job:X',
		shifts,
		slots_confirmed: confirmed
	});

	it('produces one bucket per sub-shift, keyed by job and shift', () => {
		const out = jobShiftCapacities(
			job(
				[
					{ id: 'a', quota: 3 },
					{ id: 'b', quota: 2 }
				],
				0
			)
		);
		expect(out.map((c) => c.key)).toEqual(['job:X#a', 'job:X#b']);
		expect(out.map((c) => c.target)).toEqual([3, 2]);
	});

	it('fills earlier shifts first', () => {
		const out = jobShiftCapacities(
			job(
				[
					{ id: 'a', quota: 3 },
					{ id: 'b', quota: 2 }
				],
				4
			)
		);
		expect(out.map((c) => c.confirmed)).toEqual([3, 1]);
	});

	it('never over-fills a shift or goes negative', () => {
		expect(jobShiftCapacities(job([{ id: 'a', quota: 2 }], 99)).map((c) => c.confirmed)).toEqual([
			2
		]);
		expect(jobShiftCapacities(job([{ id: 'a', quota: 2 }], -5)).map((c) => c.confirmed)).toEqual([
			0
		]);
	});

	it('returns nothing for a job with no shifts', () => {
		expect(jobShiftCapacities(job([], 3))).toEqual([]);
	});
});
