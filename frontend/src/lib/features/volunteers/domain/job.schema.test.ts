import { describe, it, expect } from 'vitest';
import { jobSchema, isJob, makeJob, jobInputSchema, type JobInput } from './job.schema';

const ctx = { shelterCode: 'SH001', createdBy: 'tester' };

function validJobDoc() {
	return {
		_id: 'job:01AAAAAAAAAAAAAAAAAAAAAAAA',
		type: 'job' as const,
		schema_v: 2 as const,
		shelter_code: 'SH001',
		created_at: '2026-08-26T00:00:00.000Z',
		updated_at: '2026-08-26T00:00:00.000Z',
		created_by: 'tester',
		title: 'ผู้ช่วยครัว',
		description: 'จัดเตรียมอาหาร',
		tier: 'operational' as const,
		required_roles: [],
		skills_required: ['ครัว'],
		quota: 10,
		slots_confirmed: 4,
		slots_dispatched: 1,
		slots_remaining: 5,
		shift_template: { shift_name: 'morning', start_time: '08:00', end_time: '16:00' },
		auto_accept: false,
		status: 'open' as const,
		is_urgent: false
	};
}

const baseInput: JobInput = {
	title: 'ผู้ช่วยครัว',
	description: 'จัดเตรียมอาหาร',
	tier: 'operational',
	required_roles: [],
	skills_required: [],
	quota: 5,
	shift_template: { shift_name: 'morning', start_time: '08:00', end_time: '16:00' },
	auto_accept: false,
	is_urgent: false
};

describe('jobSchema', () => {
	it('accepts a fully valid document', () => {
		expect(jobSchema.safeParse(validJobDoc()).success).toBe(true);
	});

	it('requires the job: _id prefix', () => {
		expect(jobSchema.safeParse({ ...validJobDoc(), _id: 'other:123' }).success).toBe(false);
	});

	it('requires schema_v to be the literal 2', () => {
		expect(jobSchema.safeParse({ ...validJobDoc(), schema_v: 1 }).success).toBe(false);
	});

	it('rejects a non-positive quota', () => {
		expect(jobSchema.safeParse({ ...validJobDoc(), quota: 0 }).success).toBe(false);
		expect(jobSchema.safeParse({ ...validJobDoc(), quota: -1 }).success).toBe(false);
	});

	it('rejects a negative slot bucket', () => {
		expect(jobSchema.safeParse({ ...validJobDoc(), slots_confirmed: -1 }).success).toBe(false);
	});

	describe('F-AUTO refine — auto_accept only on operational tier', () => {
		it('accepts auto_accept: true on an operational job', () => {
			expect(
				jobSchema.safeParse({
					...validJobDoc(),
					tier: 'operational',
					auto_accept: true,
					slots_confirmed: 0,
					slots_dispatched: 0,
					slots_remaining: 10
				}).success
			).toBe(true);
		});

		it('rejects auto_accept: true on a staff-capable job', () => {
			const result = jobSchema.safeParse({
				...validJobDoc(),
				tier: 'staff-capable',
				auto_accept: true
			});
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues.some((i) => i.path.includes('auto_accept'))).toBe(true);
			}
		});

		it('accepts auto_accept: false on a staff-capable job', () => {
			expect(
				jobSchema.safeParse({ ...validJobDoc(), tier: 'staff-capable', auto_accept: false }).success
			).toBe(true);
		});
	});

	describe('F8 quota invariant refine', () => {
		it('accepts when confirmed + dispatched + remaining === quota', () => {
			expect(
				jobSchema.safeParse({
					...validJobDoc(),
					quota: 10,
					slots_confirmed: 4,
					slots_dispatched: 1,
					slots_remaining: 5
				}).success
			).toBe(true);
		});

		it('rejects when the buckets do not sum to quota', () => {
			const result = jobSchema.safeParse({
				...validJobDoc(),
				quota: 5,
				slots_confirmed: 4,
				slots_dispatched: 4,
				slots_remaining: 4
			});
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues.some((i) => i.path.includes('slots_remaining'))).toBe(true);
			}
		});

		it('rejects an over-count that happens to look plausible at a glance', () => {
			expect(
				jobSchema.safeParse({
					...validJobDoc(),
					quota: 10,
					slots_confirmed: 10,
					slots_dispatched: 1,
					slots_remaining: 0
				}).success
			).toBe(false);
		});
	});

	it('rejects an unknown status enum value', () => {
		expect(jobSchema.safeParse({ ...validJobDoc(), status: 'urgent' }).success).toBe(false);
	});

	it('rejects hostile input shapes', () => {
		expect(jobSchema.safeParse([]).success).toBe(false);
		expect(jobSchema.safeParse(null).success).toBe(false);
		expect(jobSchema.safeParse(42).success).toBe(false);
	});
});

describe('isJob', () => {
	it('is true for a valid document', () => {
		expect(isJob(validJobDoc())).toBe(true);
	});

	it('is false for a document violating the quota invariant (F8) — this was a real bug (always returned true before)', () => {
		expect(
			isJob({
				...validJobDoc(),
				quota: 5,
				slots_confirmed: 4,
				slots_dispatched: 4,
				slots_remaining: 4
			})
		).toBe(false);
	});

	it('is false for garbage input without throwing', () => {
		expect(isJob('nope')).toBe(false);
	});
});

describe('jobInputSchema', () => {
	it('accepts a valid input', () => {
		expect(jobInputSchema.safeParse(baseInput).success).toBe(true);
	});

	it('rejects auto_accept: true with tier staff-capable', () => {
		expect(
			jobInputSchema.safeParse({ ...baseInput, tier: 'staff-capable', auto_accept: true }).success
		).toBe(false);
	});

	it('rejects a blank title', () => {
		expect(jobInputSchema.safeParse({ ...baseInput, title: '  ' }).success).toBe(false);
	});
});

describe('makeJob', () => {
	it('mints an open job with the full quota unclaimed (schema.md §2.17 default)', () => {
		const job = makeJob(baseInput, ctx);
		expect(job._id).toMatch(/^job:/);
		expect(job.schema_v).toBe(2);
		expect(job.status).toBe('open');
		expect(job.slots_confirmed).toBe(0);
		expect(job.slots_dispatched).toBe(0);
		expect(job.slots_remaining).toBe(baseInput.quota);
	});

	it('produces a document that itself satisfies jobSchema (including the quota invariant)', () => {
		const job = makeJob(baseInput, ctx);
		expect(jobSchema.safeParse(job).success).toBe(true);
	});

	it('rejects auto_accept: true with tier staff-capable at the input boundary', () => {
		expect(() =>
			makeJob({ ...baseInput, tier: 'staff-capable', auto_accept: true }, ctx)
		).toThrow();
	});
});
