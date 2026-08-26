import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createInMemoryRepository } from '$lib/db/in-memory-repository';
import type { AuthorContext } from '$lib/db/model';

let memoryRepo = createInMemoryRepository();
vi.mock('$lib/db/repository', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/db/repository')>();
	return { ...actual, createRemoteRepository: () => memoryRepo };
});
vi.mock('$lib/db/shelter', () => ({ getShelterDb: () => 'shelter_sh001' }));

import { clearJobRepositoryCache, createJobRepositoryForTest } from './job.remote';
import { createJobApplicationRepositoryForTest } from './job-application.remote';
import type { JobInput } from '../domain/job.schema';
import type { JobApplicationInput } from '../domain/job-application.schema';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'tester' };

// F2 — `auto_accept: true` here so a non-controlled-skill application resolves
// straight to `confirmed` (the intended auto-accept path, F-AUTO restricts
// this to `tier: 'operational'`, which this job already is). A controlled
// skill still forces `pending_review` regardless (see the dedicated test
// below covering `auto_accept: false`).
const jobInput: JobInput = {
	title: 'ผู้ช่วยครัว',
	description: 'จัดเตรียมอาหาร',
	tier: 'operational',
	required_roles: [],
	skills_required: [],
	shifts: [{ id: 's1', date: '2026-08-26', start_time: '08:00', end_time: '12:00', quota: 2 }],
	auto_accept: true,
	is_urgent: false
};

/** Same fixture with the sub-shift resized — `quota` is derived from `shifts[]`. */
function withQuota(seats: number): JobInput {
	return { ...jobInput, shifts: [{ ...jobInput.shifts[0], quota: seats }] };
}

function applicationInput(jobId: string, skills: string[] = ['ขับรถ']): JobApplicationInput {
	return {
		job_id: jobId,
		volunteer_id: null,
		applicant: {
			first_name: 'สมชาย',
			last_name: 'ใจดี',
			phone: '0812345678',
			phone_hash: 'hash-1',
			email: null,
			skills
		},
		selected_shift: { date: '2026-08-27', start_time: '08:00', end_time: '12:00' },
		tracking_token: 'track-1'
	};
}

describe('JobApplicationRemoteRepository', () => {
	beforeEach(() => {
		memoryRepo = createInMemoryRepository();
		// `jobRepository()` (used internally by `create`/`review`) is a module
		// singleton — clear it so it rebinds to this test's fresh in-memory store
		// instead of a previous test's stale one.
		clearJobRepositoryCache();
	});

	it('non-controlled skill resolves to confirmed and consumes one job slot when the job auto-accepts', async () => {
		const jobs = createJobRepositoryForTest('shelter_sh001');
		const applications = createJobApplicationRepositoryForTest('shelter_sh001');
		const job = await jobs.create(jobInput, ctx);

		const application = await applications.create(applicationInput(job._id), ctx);
		expect(application.status).toBe('confirmed');

		const reloadedJob = await jobs.get(job._id);
		expect(reloadedJob).toMatchObject({
			slots_confirmed: 1,
			slots_dispatched: 0,
			slots_remaining: 1
		});
	});

	it('F2 — non-controlled skill resolves to pending_review (NOT confirmed) when the job does not auto-accept, and never touches job slots', async () => {
		const jobs = createJobRepositoryForTest('shelter_sh001');
		const applications = createJobApplicationRepositoryForTest('shelter_sh001');
		const job = await jobs.create({ ...jobInput, auto_accept: false }, ctx);

		const application = await applications.create(applicationInput(job._id), ctx);
		expect(application.status).toBe('pending_review');

		const reloadedJob = await jobs.get(job._id);
		expect(reloadedJob).toMatchObject({
			slots_confirmed: 0,
			slots_dispatched: 0,
			slots_remaining: 2
		});
	});

	it('controlled skill resolves to pending_review and does not touch job slots', async () => {
		const jobs = createJobRepositoryForTest('shelter_sh001');
		const applications = createJobApplicationRepositoryForTest('shelter_sh001');
		const job = await jobs.create(jobInput, ctx);

		const application = await applications.create(applicationInput(job._id, ['พยาบาล']), ctx);
		expect(application.status).toBe('pending_review');

		const reloadedJob = await jobs.get(job._id);
		expect(reloadedJob).toMatchObject({
			slots_confirmed: 0,
			slots_dispatched: 0,
			slots_remaining: 2
		});
	});

	it('removes the application doc when the job has no slots left to confirm', async () => {
		const jobs = createJobRepositoryForTest('shelter_sh001');
		const applications = createJobApplicationRepositoryForTest('shelter_sh001');
		const job = await jobs.create(withQuota(1), ctx);
		await applications.create(applicationInput(job._id), ctx); // consumes the only slot

		await expect(applications.create(applicationInput(job._id), ctx)).rejects.toThrow();

		const all = await applications.list({ jobId: job._id });
		expect(all).toHaveLength(1); // the failed second create left no orphan doc
	});

	it('review(confirmed) consumes a slot only after a pending_review application', async () => {
		const jobs = createJobRepositoryForTest('shelter_sh001');
		const applications = createJobApplicationRepositoryForTest('shelter_sh001');
		const job = await jobs.create(jobInput, ctx);
		const application = await applications.create(applicationInput(job._id, ['พยาบาล']), ctx);
		expect(application.status).toBe('pending_review');

		const reviewed = await applications.review(application._id, 'confirmed', 'manager-1', 'ok');
		expect(reviewed.status).toBe('confirmed');
		expect(reviewed.reviewed_by).toBe('manager-1');

		const reloadedJob = await jobs.get(job._id);
		expect(reloadedJob).toMatchObject({
			slots_confirmed: 1,
			slots_dispatched: 0,
			slots_remaining: 1
		});
	});

	it('review(rejected) never touches job slots', async () => {
		const jobs = createJobRepositoryForTest('shelter_sh001');
		const applications = createJobApplicationRepositoryForTest('shelter_sh001');
		const job = await jobs.create(jobInput, ctx);
		const application = await applications.create(applicationInput(job._id, ['พยาบาล']), ctx);

		const reviewed = await applications.review(application._id, 'rejected', 'manager-1');
		expect(reviewed.status).toBe('rejected');

		const reloadedJob = await jobs.get(job._id);
		expect(reloadedJob).toMatchObject({
			slots_confirmed: 0,
			slots_dispatched: 0,
			slots_remaining: 2
		});
	});

	it('review() reverts the application status when the job has no slots left', async () => {
		const jobs = createJobRepositoryForTest('shelter_sh001');
		const applications = createJobApplicationRepositoryForTest('shelter_sh001');
		const job = await jobs.create(withQuota(2), ctx);
		await applications.create(applicationInput(job._id), ctx); // auto-accepted, consumes 1 of 2
		const second = await applications.create(applicationInput(job._id, ['พยาบาล']), ctx);
		expect(second.status).toBe('pending_review'); // controlled skill — no slot consumed yet

		// someone else takes the last remaining slot before the review happens
		await jobs.dispatch(job._id, 1);

		await expect(applications.review(second._id, 'confirmed', 'manager-1')).rejects.toThrow();

		const reloaded = await applications.get(second._id);
		expect(reloaded?.status).toBe('pending_review');
	});

	it('create() refuses an application to a job that is no longer open (D5)', async () => {
		const jobs = createJobRepositoryForTest('shelter_sh001');
		const applications = createJobApplicationRepositoryForTest('shelter_sh001');
		const job = await jobs.create(jobInput, ctx);
		await jobs.update({ ...job, status: 'closed' });

		await expect(applications.create(applicationInput(job._id), ctx)).rejects.toThrow(
			/ไม่เปิดรับสมัคร/
		);
	});

	it('review() throws when the application is already resolved', async () => {
		const jobs = createJobRepositoryForTest('shelter_sh001');
		const applications = createJobApplicationRepositoryForTest('shelter_sh001');
		const job = await jobs.create(jobInput, ctx);
		const application = await applications.create(applicationInput(job._id, ['พยาบาล']), ctx);
		await applications.review(application._id, 'rejected', 'manager-1');

		await expect(applications.review(application._id, 'confirmed', 'manager-1')).rejects.toThrow(
			/ถูกพิจารณาไปแล้ว/
		);
	});

	it('cancel() withdraws a pending_review application without touching job slots', async () => {
		const jobs = createJobRepositoryForTest('shelter_sh001');
		const applications = createJobApplicationRepositoryForTest('shelter_sh001');
		const job = await jobs.create(jobInput, ctx);
		const application = await applications.create(applicationInput(job._id, ['พยาบาล']), ctx);

		const cancelled = await applications.cancel(application._id, 'staff-1');
		expect(cancelled.status).toBe('cancelled');
	});
});
