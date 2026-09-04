import { describe, it, expect } from 'vitest';
import {
	jobApplicationSchema,
	isJobApplication,
	makeJobApplication,
	jobApplicationInputSchema,
	canTransitionJobApplication,
	JOB_APPLICATION_TRANSITIONS,
	type JobApplicationInput
} from './job-application.schema';

const ctx = { shelterCode: 'SH001', createdBy: 'tester' };

function validApplicant() {
	return {
		first_name: 'สมชาย',
		last_name: 'ใจดี',
		phone: '0812345678',
		phone_hash: 'hash-1',
		email: null,
		skills: ['ขับรถ'],
		national_id: null
	};
}

function validDoc() {
	return {
		_id: 'job_application:01AAAAAAAAAAAAAAAAAAAAAAAA',
		type: 'job_application' as const,
		schema_v: 2 as const,
		shelter_code: 'SH001',
		created_at: '2026-08-26T00:00:00.000Z',
		updated_at: '2026-08-26T00:00:00.000Z',
		created_by: 'tester',
		job_id: 'job:01AAAAAAAAAAAAAAAAAAAAAAAA',
		volunteer_id: null,
		applicant: validApplicant(),
		selected_shift: { date: '2026-08-27', start_time: '08:00', end_time: '16:00' },
		tracking_token: 'track-1',
		status: 'pending_review' as const
	};
}

const baseInput: JobApplicationInput = {
	job_id: 'job:01AAAAAAAAAAAAAAAAAAAAAAAA',
	volunteer_id: null,
	applicant: validApplicant(),
	selected_shift: { date: '2026-08-27', start_time: '08:00', end_time: '16:00' },
	tracking_token: 'track-1'
};

describe('jobApplicationSchema', () => {
	it('accepts a fully valid document', () => {
		expect(jobApplicationSchema.safeParse(validDoc()).success).toBe(true);
	});

	it('requires the job_application: _id prefix', () => {
		expect(jobApplicationSchema.safeParse({ ...validDoc(), _id: 'job:oops' }).success).toBe(false);
	});

	it('accepts legacy v2 and rejects unsupported schema versions', () => {
		expect(jobApplicationSchema.safeParse({ ...validDoc(), schema_v: 1 }).success).toBe(false);
	});

	it('requires job_id to start with job:', () => {
		expect(jobApplicationSchema.safeParse({ ...validDoc(), job_id: 'legacy' }).success).toBe(false);
	});

	it('accepts a null volunteer_id (application not yet linked to a profile)', () => {
		expect(jobApplicationSchema.safeParse({ ...validDoc(), volunteer_id: null }).success).toBe(
			true
		);
	});

	it('applicant.national_id is optional (F13) — accepts a document missing the key entirely', () => {
		const applicant = validApplicant() as Record<string, unknown>;
		delete applicant.national_id;
		expect(jobApplicationSchema.safeParse({ ...validDoc(), applicant }).success).toBe(true);
	});

	it('rejects an unknown status enum value', () => {
		expect(jobApplicationSchema.safeParse({ ...validDoc(), status: 'approved' }).success).toBe(
			false
		);
	});

	it('accepts the rejected status (kept per CR-094, not dropped like CR-092 proposed)', () => {
		expect(jobApplicationSchema.safeParse({ ...validDoc(), status: 'rejected' }).success).toBe(
			true
		);
	});

	it('rejects a missing tracking_token', () => {
		const doc = validDoc() as Record<string, unknown>;
		delete doc.tracking_token;
		expect(jobApplicationSchema.safeParse(doc).success).toBe(false);
	});

	it('rejects hostile input shapes', () => {
		expect(jobApplicationSchema.safeParse([]).success).toBe(false);
		expect(jobApplicationSchema.safeParse(null).success).toBe(false);
	});
});

describe('isJobApplication', () => {
	it('is true for a valid document', () => {
		expect(isJobApplication(validDoc())).toBe(true);
	});

	it('is false for garbage input without throwing', () => {
		expect(isJobApplication({ status: 'pending_review' })).toBe(false);
	});
});

describe('jobApplicationInputSchema', () => {
	it('accepts a valid input', () => {
		expect(jobApplicationInputSchema.safeParse(baseInput).success).toBe(true);
	});

	it('rejects a job_id that does not start with job:', () => {
		expect(jobApplicationInputSchema.safeParse({ ...baseInput, job_id: 'legacy' }).success).toBe(
			false
		);
	});
});

describe('makeJobApplication', () => {
	it('mints an application with the caller-supplied initial status', () => {
		const app = makeJobApplication(baseInput, ctx, 'pending_review');
		expect(app._id).toMatch(/^job_application:/);
		expect(app.schema_v).toBe(3);
		expect(app.status).toBe('pending_review');
		expect(app.review_notes).toBeNull();
		expect(app.reviewed_at).toBeNull();
		expect(app.reviewed_by).toBeNull();
	});

	it('can mint directly into confirmed (auto_accept path)', () => {
		const app = makeJobApplication(baseInput, ctx, 'confirmed');
		expect(app.status).toBe('confirmed');
	});

	it('produces a document that itself satisfies jobApplicationSchema', () => {
		const app = makeJobApplication(baseInput, ctx, 'pending_review');
		expect(jobApplicationSchema.safeParse(app).success).toBe(true);
	});

	it('rejects a malformed job_id at the input boundary', () => {
		expect(() =>
			makeJobApplication({ ...baseInput, job_id: 'legacy' }, ctx, 'pending_review')
		).toThrow();
	});
});

describe('JOB_APPLICATION_TRANSITIONS and canTransitionJobApplication (Story 3.3 / UX-DR6)', () => {
	it('allows valid transitions from pending_review to confirmed, rejected, and cancelled', () => {
		expect(canTransitionJobApplication('pending_review', 'confirmed')).toBe(true);
		expect(canTransitionJobApplication('pending_review', 'rejected')).toBe(true);
		expect(canTransitionJobApplication('pending_review', 'cancelled')).toBe(true);
	});

	it('disallows transition from pending_review to pending_review', () => {
		expect(canTransitionJobApplication('pending_review', 'pending_review')).toBe(false);
	});

	it('disallows transitions from terminal state confirmed', () => {
		expect(canTransitionJobApplication('confirmed', 'pending_review')).toBe(false);
		expect(canTransitionJobApplication('confirmed', 'rejected')).toBe(false);
		expect(canTransitionJobApplication('confirmed', 'cancelled')).toBe(false);
		expect(canTransitionJobApplication('confirmed', 'confirmed')).toBe(false);
	});

	it('disallows transitions from terminal state rejected', () => {
		expect(canTransitionJobApplication('rejected', 'pending_review')).toBe(false);
		expect(canTransitionJobApplication('rejected', 'confirmed')).toBe(false);
		expect(canTransitionJobApplication('rejected', 'cancelled')).toBe(false);
		expect(canTransitionJobApplication('rejected', 'rejected')).toBe(false);
	});

	it('disallows transitions from terminal state cancelled', () => {
		expect(canTransitionJobApplication('cancelled', 'pending_review')).toBe(false);
		expect(canTransitionJobApplication('cancelled', 'confirmed')).toBe(false);
		expect(canTransitionJobApplication('cancelled', 'rejected')).toBe(false);
		expect(canTransitionJobApplication('cancelled', 'cancelled')).toBe(false);
	});

	it('JOB_APPLICATION_TRANSITIONS matches the documented state machine graph', () => {
		expect(JOB_APPLICATION_TRANSITIONS).toEqual({
			pending_review: ['confirmed', 'rejected', 'cancelled'],
			confirmed: [],
			rejected: [],
			cancelled: []
		});
	});
});
