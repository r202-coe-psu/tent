import { describe, it, expect } from 'vitest';
import {
	shiftFillRate,
	bucketFillRate,
	overallBookingRate,
	bucketCounts,
	jobShiftCapacities,
	jobShiftQuotaSplits,
	isCapacityTrackedJobStatus
} from './capacity';
import type { ShiftAssignment } from './shift-assignment.schema';

describe('isCapacityTrackedJobStatus', () => {
	it('tracks capacity for open and full jobs', () => {
		expect(isCapacityTrackedJobStatus('open')).toBe(true);
		expect(isCapacityTrackedJobStatus('full')).toBe(true);
	});

	it('excludes paused, draft and terminal jobs from capacity tracking', () => {
		for (const status of ['paused', 'draft', 'closed', 'cancelled'] as const) {
			expect(isCapacityTrackedJobStatus(status)).toBe(false);
		}
	});
});

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

	it('uses exact active assignments per shift instead of allocating the job total', () => {
		const shifts = [
			{
				id: 'a',
				date: '2026-09-01',
				end_date: '2026-09-01',
				start_time: '08:00',
				end_time: '12:00',
				quota: 2
			},
			{
				id: 'b',
				date: '2026-09-01',
				end_date: '2026-09-01',
				start_time: '13:00',
				end_time: '17:00',
				quota: 2
			}
		];
		const assignment = (id: string, volunteer_id: string, status = 'assigned') => ({
			_id: id,
			type: 'shift_assignment' as const,
			schema_v: 4 as const,
			shelter_code: 'SH001',
			created_at: '',
			updated_at: '',
			created_by: 'tester',
			job_id: 'job:X',
			shift_id: 'a',
			volunteer_id,
			date: '2026-09-01',
			shift: 'morning' as const,
			station: 'ครัว',
			duty_window: { start_ts: '2026-09-01T01:00:00.000Z', end_ts: '2026-09-01T05:00:00.000Z' },
			status: status as 'assigned',
			dispatch_status: 'accepted' as const,
			check_in_method: 'qr' as const,
			check_in_reason: null
		});
		const out = jobShiftCapacities({ ...job(shifts, 2), shifts }, [
			assignment('a1', 'volunteer:1'),
			assignment('a2', 'volunteer:1'),
			assignment('a3', 'volunteer:2', 'completed')
		]);
		expect(out.map((c) => c.confirmed)).toEqual([1, 0]);
	});

	it('matches an exact shift_id even when shift snapshot fields are unavailable', () => {
		const out = jobShiftCapacities(
			{
				...job([{ id: 'a', quota: 2 }], 0),
				shifts: [{ id: 'a', quota: 2 }]
			},
			[
				{
					job_id: 'job:X',
					shift_id: 'a',
					volunteer_id: 'volunteer:1',
					status: 'assigned'
				} as ShiftAssignment
			]
		);
		expect(out[0]?.confirmed).toBe(1);
	});
});

describe('jobShiftQuotaSplits', () => {
	const job = (slots_confirmed: number, slots_dispatched: number) => ({
		_id: 'job:1',
		shifts: [
			{ id: 's1', quota: 3 },
			{ id: 's2', quota: 2 }
		],
		slots_confirmed,
		slots_dispatched
	});

	it('splits confirmed then dispatched greedily, earliest shift first', () => {
		expect(jobShiftQuotaSplits(job(2, 2))).toEqual([
			{ key: 'job:1#s1', target: 3, confirmed: 2, dispatched: 1, remaining: 0 },
			{ key: 'job:1#s2', target: 2, confirmed: 0, dispatched: 1, remaining: 1 }
		]);
	});

	it('reconciles with the job document totals', () => {
		const splits = jobShiftQuotaSplits(job(3, 1));
		expect(splits.reduce((n, s) => n + s.confirmed, 0)).toBe(3);
		expect(splits.reduce((n, s) => n + s.dispatched, 0)).toBe(1);
		expect(splits.reduce((n, s) => n + s.remaining, 0)).toBe(1);
	});

	it('reports a fully unclaimed job as all remaining', () => {
		expect(jobShiftQuotaSplits(job(0, 0)).map((s) => s.remaining)).toEqual([3, 2]);
	});

	it('never emits a negative bucket when the job doc carries junk', () => {
		const splits = jobShiftQuotaSplits(job(-5, 99));
		expect(splits.every((s) => s.confirmed >= 0 && s.dispatched >= 0 && s.remaining >= 0)).toBe(
			true
		);
	});
});
