import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createInMemoryRepository } from '$lib/db/in-memory-repository';

let memoryRepo = createInMemoryRepository();
vi.mock('$lib/db/repository', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/db/repository')>();
	return { ...actual, createRemoteRepository: () => memoryRepo };
});
vi.mock('$lib/db/shelter', () => ({ getShelterDb: () => 'shelter_sh001' }));

import { createJobApplicationRepositoryForTest } from './job-application.remote';
import { createShiftAssignmentRepositoryForTest } from './shift-assignment.remote';
import type { JobApplication } from '../domain/job-application.schema';
import type { ShiftAssignment } from '../domain/shift-assignment.schema';

const JOB = 'job:A';

function assignment(n: number, overrides: Partial<ShiftAssignment> = {}): ShiftAssignment {
	return {
		_id: `shift_assignment:${n}`,
		type: 'shift_assignment',
		schema_v: 5,
		shelter_code: 'SH001',
		created_at: `2026-08-01T12:00:0${n}.000Z`,
		updated_at: `2026-08-01T12:00:0${n}.000Z`,
		created_by: 'staff1',
		job_id: JOB,
		shift_id: 's1',
		volunteer_id: `volunteer:${n}`,
		date: '2026-08-10',
		shift: 'morning',
		station: 'ครัวกลาง',
		duty_window: { start_ts: '2026-08-10T01:00:00.000Z', end_ts: '2026-08-10T09:00:00.000Z' },
		status: 'assigned',
		check_in_method: 'qr',
		check_in_reason: null,
		check_out_method: 'qr',
		check_out_reason: null,
		...overrides
	} as ShiftAssignment;
}

function application(n: number, overrides: Partial<JobApplication> = {}): JobApplication {
	return {
		_id: `job_application:${String(n).padStart(3, '0')}`,
		type: 'job_application',
		schema_v: 2,
		shelter_code: 'SH001',
		created_at: '2026-08-01T00:00:00.000Z',
		updated_at: '2026-08-01T00:00:00.000Z',
		created_by: 'tester',
		job_id: JOB,
		shift_id: 's1',
		volunteer_id: `volunteer:${n}`,
		applicant: {
			first_name: 'สมชาย',
			last_name: 'ใจดี',
			phone: '0812345678',
			phone_hash: `hash-${n}`,
			email: null,
			skills: [],
			national_id: null
		},
		selected_shift: { shift_id: 's1', date: '2026-08-10', start_time: '08:00', end_time: '16:00' },
		tracking_token: `tok-${n}`,
		status: 'pending_review',
		...overrides
	} as JobApplication;
}

describe('assignment reads by job (DB _find)', () => {
	beforeEach(() => {
		memoryRepo = createInMemoryRepository();
	});

	it('listForJobShifts returns only the given shifts of this job, plus legacy rows without a shift', async () => {
		const legacy = assignment(4);
		delete (legacy as { shift_id?: string }).shift_id;
		for (const doc of [
			assignment(1, { shift_id: 's1' }),
			assignment(2, { shift_id: 's2' }),
			assignment(3, { shift_id: 's1', job_id: 'job:B' }),
			legacy
		]) {
			await memoryRepo.put(doc);
		}
		const repo = createShiftAssignmentRepositoryForTest('shelter_sh001');

		const rows = await repo.listForJobShifts(JOB, ['s1']);

		expect(rows.map((a) => a._id).sort()).toEqual(['shift_assignment:1', 'shift_assignment:4']);
		expect(await repo.listForJobShifts(JOB, [])).toEqual([]);
	});

	it('listForJob and listForJobVolunteers stay inside the job', async () => {
		for (const doc of [assignment(1), assignment(2), assignment(3, { job_id: 'job:B' })]) {
			await memoryRepo.put(doc);
		}
		const repo = createShiftAssignmentRepositoryForTest('shelter_sh001');

		expect((await repo.listForJob(JOB)).map((a) => a._id).sort()).toEqual([
			'shift_assignment:1',
			'shift_assignment:2'
		]);
		expect(
			(await repo.listForJobVolunteers(JOB, ['volunteer:2', 'volunteer:3'])).map((a) => a._id)
		).toEqual(['shift_assignment:2']);
	});

	it('getMany reads the named documents', async () => {
		for (const doc of [assignment(1), assignment(2), assignment(3)]) await memoryRepo.put(doc);
		const repo = createShiftAssignmentRepositoryForTest('shelter_sh001');

		const rows = await repo.getMany(['shift_assignment:1', 'shift_assignment:3']);

		expect(rows.map((a) => a._id).sort()).toEqual(['shift_assignment:1', 'shift_assignment:3']);
		expect(await repo.getMany([])).toEqual([]);
	});
});

describe('JobApplicationRemoteRepository.pageForJob (DB _find)', () => {
	beforeEach(() => {
		memoryRepo = createInMemoryRepository();
	});

	async function seed() {
		const docs = [
			application(1, { status: 'pending_review' }),
			application(2, { status: 'pending_review', shift_id: 's2' }),
			application(3, { status: 'confirmed' }),
			application(4, { status: 'rejected' }),
			application(5, { status: 'pending_review', job_id: 'job:B' })
		];
		docs[1].selected_shift.shift_id = 's2';
		for (const doc of docs) await memoryRepo.put(doc);
		return createJobApplicationRepositoryForTest('shelter_sh001');
	}

	it('filters by job and status in the selector', async () => {
		const repo = await seed();

		const pending = await repo.pageForJob({ jobId: JOB, statuses: ['pending_review'], limit: 10 });
		const declined = await repo.pageForJob({
			jobId: JOB,
			statuses: ['rejected', 'cancelled'],
			limit: 10
		});

		expect(pending.items.map((a) => a._id)).toEqual(['job_application:001', 'job_application:002']);
		expect(declined.items.map((a) => a._id)).toEqual(['job_application:004']);
	});

	it('filters by shift id, or by date when no shift id is given', async () => {
		const repo = await seed();

		const byShift = await repo.pageForJob({
			jobId: JOB,
			shift: { id: 's2', date: '2026-08-10' },
			limit: 10
		});
		const byDate = await repo.pageForJob({
			jobId: JOB,
			shift: { id: null, date: '2026-08-10' },
			limit: 10
		});
		const otherDate = await repo.pageForJob({
			jobId: JOB,
			shift: { id: null, date: '2026-08-11' },
			limit: 10
		});

		expect(byShift.items.map((a) => a._id)).toEqual(['job_application:002']);
		expect(byDate.items).toHaveLength(4);
		expect(otherDate.items).toEqual([]);
	});

	it('continues with the bookmark of the previous page', async () => {
		const repo = await seed();

		const first = await repo.pageForJob({ jobId: JOB, limit: 3 });
		const second = await repo.pageForJob({ jobId: JOB, limit: 3, bookmark: first.bookmark });

		expect(first.items).toHaveLength(3);
		expect(second.items.map((a) => a._id)).toEqual(['job_application:004']);
	});

	it('summaryForJob covers every application of the job', async () => {
		const repo = await seed();

		expect(await repo.summaryForJob(JOB)).toHaveLength(4);
	});
});
