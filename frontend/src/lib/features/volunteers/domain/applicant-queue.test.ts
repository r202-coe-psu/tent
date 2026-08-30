import { describe, it, expect } from 'vitest';
import { partitionApplicantQueue, APPLICATION_STATUS_META } from './applicant-queue';
import {
	jobApplicationStatusSchema,
	type JobApplication,
	type JobApplicationStatus
} from './job-application.schema';

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

describe('APPLICATION_STATUS_META', () => {
	it('covers every status in the schema enum', () => {
		for (const status of jobApplicationStatusSchema.options as JobApplicationStatus[]) {
			expect(APPLICATION_STATUS_META[status]?.label).toBeTruthy();
		}
	});
});
