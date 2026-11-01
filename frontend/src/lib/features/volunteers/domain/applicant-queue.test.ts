import { describe, it, expect } from 'vitest';
import {
	groupApplicationsByApplicant,
	isHeldForInactiveProfile,
	partitionApplicantQueue
} from './applicant-queue';
import type { JobApplication } from './job-application.schema';

function app(overrides: Partial<JobApplication> & { _id: string }): JobApplication {
	return {
		type: 'job_application',
		schema_v: 2,
		shelter_code: 'SH001',
		created_at: '2026-08-01T00:00:00.000Z',
		updated_at: '2026-08-01T00:00:00.000Z',
		created_by: 'tester',
		job_id: 'job:A',
		volunteer_id: null,
		applicant: {
			first_name: 'สมชาย',
			last_name: 'ใจดี',
			phone: '0812345678',
			phone_hash: 'hash-1',
			email: null,
			skills: [],
			national_id: null
		},
		selected_shift: { date: '2026-08-10', start_time: '08:00', end_time: '16:00' },
		tracking_token: 'tok-1',
		status: 'pending_review',
		...overrides
	} as JobApplication;
}

describe('partitionApplicantQueue', () => {
	it('keeps only the requested job', () => {
		const queue = partitionApplicantQueue(
			[app({ _id: 'a', job_id: 'job:A' }), app({ _id: 'b', job_id: 'job:B' })],
			'job:A'
		);
		expect(queue.pending.map((a) => a._id)).toEqual(['a']);
		expect(queue.reviewed).toEqual([]);
	});

	it('orders pending applications oldest first (first come, first served)', () => {
		const queue = partitionApplicantQueue(
			[
				app({ _id: 'new', created_at: '2026-08-03T00:00:00.000Z' }),
				app({ _id: 'old', created_at: '2026-08-01T00:00:00.000Z' }),
				app({ _id: 'mid', created_at: '2026-08-02T00:00:00.000Z' })
			],
			'job:A'
		);
		expect(queue.pending.map((a) => a._id)).toEqual(['old', 'mid', 'new']);
	});

	it('puts every decided status in `reviewed`, newest decision first', () => {
		const queue = partitionApplicantQueue(
			[
				app({ _id: 'ok', status: 'confirmed', reviewed_at: '2026-08-05T00:00:00.000Z' }),
				app({ _id: 'no', status: 'rejected', reviewed_at: '2026-08-07T00:00:00.000Z' }),
				app({ _id: 'gone', status: 'cancelled', updated_at: '2026-08-06T00:00:00.000Z' }),
				app({ _id: 'waiting' })
			],
			'job:A'
		);
		expect(queue.pending.map((a) => a._id)).toEqual(['waiting']);
		// `cancelled` has no `reviewed_at` — it sorts on `updated_at` instead of
		// falling to the bottom of the list.
		expect(queue.reviewed.map((a) => a._id)).toEqual(['no', 'gone', 'ok']);
	});

	it('does not mutate or alias the input array', () => {
		const input = [
			app({ _id: 'b', created_at: '2026-08-02T00:00:00.000Z' }),
			app({ _id: 'a', created_at: '2026-08-01T00:00:00.000Z' })
		];
		const queue = partitionApplicantQueue(input, 'job:A');
		expect(input.map((a) => a._id)).toEqual(['b', 'a']);
		expect(queue.pending).not.toBe(input);
	});

	it('handles an empty list', () => {
		expect(partitionApplicantQueue([], 'job:A')).toEqual({ pending: [], reviewed: [] });
	});
});

describe('groupApplicationsByApplicant', () => {
	const shift = (date: string, start: string) => ({
		date,
		start_time: start,
		end_time: '17:00'
	});

	it('puts one applicant’s shifts on one card, in date-then-time order', () => {
		const groups = groupApplicationsByApplicant([
			app({ _id: 'd2', volunteer_id: 'volunteer:a', selected_shift: shift('2026-08-11', '08:00') }),
			app({
				_id: 'd1-pm',
				volunteer_id: 'volunteer:a',
				selected_shift: shift('2026-08-10', '13:00')
			}),
			app({
				_id: 'd1-am',
				volunteer_id: 'volunteer:a',
				selected_shift: shift('2026-08-10', '08:00')
			})
		]);
		expect(groups).toHaveLength(1);
		expect(groups[0].applications.map((a) => a._id)).toEqual(['d1-am', 'd1-pm', 'd2']);
	});

	it('keeps the input order of each applicant’s first application (first come, first served)', () => {
		const groups = groupApplicationsByApplicant([
			app({ _id: 'b1', volunteer_id: 'volunteer:b' }),
			app({ _id: 'a1', volunteer_id: 'volunteer:a' }),
			app({ _id: 'b2', volunteer_id: 'volunteer:b', selected_shift: shift('2026-08-12', '08:00') })
		]);
		expect(groups.map((g) => g.key)).toEqual(['volunteer:b', 'volunteer:a']);
		expect(groups[0].applications.map((a) => a._id)).toEqual(['b1', 'b2']);
	});

	it('falls back to the phone hash for an application with no linked volunteer', () => {
		const other = {
			first_name: 'สมหญิง',
			last_name: 'ใจงาม',
			phone: '0899999999',
			phone_hash: 'hash-2',
			email: null,
			skills: [],
			national_id: null
		};
		const groups = groupApplicationsByApplicant([
			app({ _id: 'x1' }),
			app({ _id: 'y1', applicant: other }),
			app({ _id: 'x2', selected_shift: shift('2026-08-12', '08:00') })
		]);
		expect(groups.map((g) => g.applications.map((a) => a._id))).toEqual([['x1', 'x2'], ['y1']]);
	});

	it('does not mutate its input', () => {
		const input = [
			app({ _id: 'late', selected_shift: shift('2026-08-12', '08:00') }),
			app({ _id: 'early', selected_shift: shift('2026-08-10', '08:00') })
		];
		groupApplicationsByApplicant(input);
		expect(input.map((a) => a._id)).toEqual(['late', 'early']);
	});
});

describe('isHeldForInactiveProfile', () => {
	it('flags a pending application whose volunteer is inactive', () => {
		expect(isHeldForInactiveProfile({ status: 'pending_review' }, { status: 'inactive' })).toBe(
			true
		);
	});

	it('ignores active, missing, and already decided cases', () => {
		expect(isHeldForInactiveProfile({ status: 'pending_review' }, { status: 'active' })).toBe(
			false
		);
		expect(isHeldForInactiveProfile({ status: 'pending_review' }, null)).toBe(false);
		expect(isHeldForInactiveProfile({ status: 'confirmed' }, { status: 'inactive' })).toBe(false);
	});
});
