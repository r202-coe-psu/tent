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
import {
	clearVolunteerRepositoryCache,
	createVolunteerRepositoryForTest
} from './volunteer.remote';
import { createShiftAssignmentRepositoryForTest } from './shift-assignment.remote';
import type { JobInput } from '../domain/job.schema';
import type { ShiftAssignmentInput } from '../domain/shift-assignment.schema';
import type { VolunteerInput } from '../domain/volunteer.schema';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'tester' };

const jobInput: JobInput = {
	title: 'ผู้ช่วยครัว',
	description: 'จัดเตรียมอาหาร',
	tier: 'operational',
	required_roles: [],
	skills_required: [],
	shifts: [
		{
			id: 's1',
			date: '2026-08-26',
			end_date: '2026-08-26',
			start_time: '08:00',
			end_time: '12:00',
			quota: 2
		}
	],
	auto_accept: false,
	is_urgent: false
};

const volunteerInput: VolunteerInput = {
	first_name: 'สมชาย',
	last_name: 'ใจดี',
	phone: '0812345678',
	skills: ['ขับรถ'],
	source: 'walk_in',
	national_id: null
};

function assignmentInput(jobId: string, volunteerId: string): ShiftAssignmentInput {
	return {
		job_id: jobId,
		shift_id: 's1',
		volunteer_id: volunteerId,
		date: '2026-08-27',
		shift: 'morning',
		station: 'ครัว',
		duty_window: { start_ts: '2026-08-27T08:00:00.000Z', end_ts: '2026-08-27T16:00:00.000Z' }
	};
}

describe('ShiftAssignmentRemoteRepository', () => {
	beforeEach(() => {
		memoryRepo = createInMemoryRepository();
		clearJobRepositoryCache();
		clearVolunteerRepositoryCache();
	});

	async function setup() {
		const jobs = createJobRepositoryForTest('shelter_sh001');
		const volunteers = createVolunteerRepositoryForTest('shelter_sh001');
		const assignments = createShiftAssignmentRepositoryForTest('shelter_sh001');
		const job = await jobs.create(jobInput, ctx);
		const volunteer = await volunteers.create(volunteerInput, ctx);
		return { jobs, volunteers, assignments, job, volunteer };
	}

	it('dispatch() creates the assignment and consumes one dispatched slot on the job', async () => {
		const { jobs, assignments, job, volunteer } = await setup();

		const assignment = await assignments.dispatch(assignmentInput(job._id, volunteer._id), ctx);
		expect(assignment.dispatch_status).toBe('dispatched');
		expect(assignment.status).toBe('assigned');

		const reloadedJob = await jobs.get(job._id);
		expect(reloadedJob).toMatchObject({
			slots_confirmed: 0,
			slots_dispatched: 1,
			slots_remaining: 1
		});
	});

	it('flex shift dispatches into standby status', async () => {
		const { assignments, job, volunteer } = await setup();
		const assignment = await assignments.dispatch(
			{ ...assignmentInput(job._id, volunteer._id), shift: 'flex' },
			ctx
		);
		expect(assignment.status).toBe('standby');
	});

	it('assign() books the slot outright — accepted, confirmed, nothing left dispatched', async () => {
		const { jobs, assignments, job, volunteer } = await setup();

		const assignment = await assignments.assign(assignmentInput(job._id, volunteer._id), ctx);
		expect(assignment.dispatch_status).toBe('accepted');
		expect(assignment.status).toBe('standby');

		const reloadedJob = await jobs.get(job._id);
		expect(reloadedJob).toMatchObject({
			slots_confirmed: 1,
			slots_dispatched: 0,
			slots_remaining: 1
		});
	});

	it('assign() fills the job and derives its status once the quota is gone', async () => {
		const { jobs, volunteers, assignments, job, volunteer } = await setup();
		const second = await volunteers.create({ ...volunteerInput, phone: '0899999999' }, ctx);

		await assignments.assign(assignmentInput(job._id, volunteer._id), ctx);
		await assignments.assign(assignmentInput(job._id, second._id), ctx);

		const reloadedJob = await jobs.get(job._id);
		expect(reloadedJob).toMatchObject({ slots_confirmed: 2, slots_remaining: 0 });
	});

	it('assign() repairs stale job counters from the live shift assignments', async () => {
		const { jobs, volunteers, assignments, job, volunteer } = await setup();
		await assignments.assign(assignmentInput(job._id, volunteer._id), ctx);

		// Reproduce the production mismatch: the shift has 1/2 people, but the
		// parent job was incorrectly left at 2/2 and reports no slot remaining.
		const staleJob = await jobs.get(job._id);
		await memoryRepo.put({
			...staleJob!,
			slots_confirmed: 2,
			slots_dispatched: 0,
			slots_remaining: 0,
			status: 'full'
		});

		const second = await volunteers.create({ ...volunteerInput, phone: '0899999999' }, ctx);
		await expect(
			assignments.assign(assignmentInput(job._id, second._id), ctx)
		).resolves.toMatchObject({
			volunteer_id: second._id
		});

		expect(await jobs.get(job._id)).toMatchObject({
			slots_confirmed: 2,
			slots_dispatched: 0,
			slots_remaining: 0,
			status: 'full'
		});
		expect((await assignments.list({ jobId: job._id })).length).toBe(2);
	});

	it('rejects an assignment whose shift_id is not a child of the job', async () => {
		const { assignments, job, volunteer } = await setup();
		await expect(
			assignments.assign({ ...assignmentInput(job._id, volunteer._id), shift_id: 's999' }, ctx)
		).rejects.toThrow('ไม่พบกะ s999');
	});

	it('rejects assigning the same volunteer to the same shift twice', async () => {
		const { assignments, job, volunteer } = await setup();
		await assignments.assign(assignmentInput(job._id, volunteer._id), ctx);
		await expect(assignments.assign(assignmentInput(job._id, volunteer._id), ctx)).rejects.toThrow(
			'ถูกมอบหมายในกะนี้แล้ว'
		);
	});

	it('rejects a duplicate legacy assignment by duty window when shift_id is absent', async () => {
		const { assignments, job, volunteer } = await setup();
		await memoryRepo.put({
			_id: 'shift_assignment:legacy',
			type: 'shift_assignment',
			schema_v: 3,
			shelter_code: 'SH001',
			created_at: '2026-08-27T00:00:00.000Z',
			updated_at: '2026-08-27T00:00:00.000Z',
			created_by: 'legacy',
			job_id: job._id,
			volunteer_id: volunteer._id,
			date: '2026-08-27',
			shift: 'morning',
			station: 'ครัว',
			duty_window: assignmentInput(job._id, volunteer._id).duty_window,
			status: 'assigned',
			dispatch_status: 'accepted',
			check_in_method: 'qr',
			check_in_reason: null,
			check_out_method: 'qr',
			check_out_reason: null
		});

		await expect(assignments.assign(assignmentInput(job._id, volunteer._id), ctx)).rejects.toThrow(
			'ถูกมอบหมายในกะนี้แล้ว'
		);
	});

	/** Shape the worker writes for public applications: only `check_out_by/method/reason` missing. */
	function workerDoc(
		id: string,
		jobId: string,
		volunteerId: string,
		overrides: Record<string, unknown> = {}
	) {
		return {
			_id: id,
			type: 'shift_assignment',
			schema_v: 4,
			shelter_code: 'SH001',
			created_at: '2026-08-27T00:00:00.000Z',
			updated_at: '2026-08-27T00:00:00.000Z',
			created_by: 'public_apply',
			job_id: jobId,
			shift_id: 's1',
			volunteer_id: volunteerId,
			date: '2026-08-27',
			shift: 'morning',
			station: 'ครัว',
			duty_window: assignmentInput(jobId, volunteerId).duty_window,
			check_in_at: null,
			check_out_at: null,
			check_in_by: null,
			status: 'assigned',
			dispatch_status: null,
			check_in_method: 'qr',
			check_in_reason: null,
			...overrides
		};
	}

	it('list() and get() normalize worker-written docs missing check_out_* (#1014)', async () => {
		const { assignments, job, volunteer } = await setup();
		await memoryRepo.put(workerDoc('shift_assignment:worker', job._id, volunteer._id));

		const listed = await assignments.list({ jobId: job._id });
		expect(listed.map((x) => x._id)).toEqual(['shift_assignment:worker']);
		expect(listed[0]).toMatchObject({
			check_in_method: 'qr',
			check_out_by: null,
			check_out_method: 'qr',
			check_out_reason: null
		});
		expect(await assignments.get('shift_assignment:worker')).toMatchObject({
			check_out_method: 'qr'
		});
	});

	it('list() does not overwrite check_out_* values that are present', async () => {
		const { assignments, job, volunteer } = await setup();
		await memoryRepo.put(
			workerDoc('shift_assignment:done', job._id, volunteer._id, {
				schema_v: 5,
				status: 'completed',
				check_out_by: 'staff-9',
				check_out_method: 'manual_override',
				check_out_reason: 'ลืมสแกน'
			})
		);
		expect((await assignments.list())[0]).toMatchObject({
			check_out_by: 'staff-9',
			check_out_method: 'manual_override',
			check_out_reason: 'ลืมสแกน'
		});
	});

	it('list() still drops a doc with an unknown check_out_method', async () => {
		const { assignments, job, volunteer } = await setup();
		await memoryRepo.put(
			workerDoc('shift_assignment:bad', job._id, volunteer._id, { check_out_method: 'telepathy' })
		);
		expect(await assignments.list()).toEqual([]);
	});

	it('a legacy worker row counts toward shift capacity (quota 2)', async () => {
		const { volunteers, assignments, job, volunteer } = await setup();
		const second = await volunteers.create({ ...volunteerInput, phone: '0899999999' }, ctx);
		const third = await volunteers.create({ ...volunteerInput, phone: '0877777777' }, ctx);
		await memoryRepo.put(workerDoc('shift_assignment:w1', job._id, volunteer._id));
		await memoryRepo.put(workerDoc('shift_assignment:w2', job._id, second._id));

		await expect(assignments.assign(assignmentInput(job._id, third._id), ctx)).rejects.toThrow(
			'กะนี้เต็มแล้ว (2/2 คน)'
		);
	});

	it('a legacy worker row blocks a duplicate dispatch of the same volunteer/shift', async () => {
		const { assignments, job, volunteer } = await setup();
		await memoryRepo.put(workerDoc('shift_assignment:w1', job._id, volunteer._id));

		await expect(
			assignments.dispatch(assignmentInput(job._id, volunteer._id), ctx)
		).rejects.toThrow('ถูกมอบหมายในกะนี้แล้ว');
	});

	it('checkIn()/checkOut() on a legacy worker row succeed and persist the full v5 shape', async () => {
		const { volunteers, assignments, job, volunteer } = await setup();
		await memoryRepo.put(workerDoc('shift_assignment:w1', job._id, volunteer._id));

		const checkedIn = await assignments.checkIn('shift_assignment:w1', 'staff-1');
		expect(checkedIn).toMatchObject({
			status: 'checked_in',
			check_in_by: 'staff-1',
			check_out_by: null,
			check_out_method: 'qr',
			check_out_reason: null
		});
		expect((await volunteers.get(volunteer._id))?.checked_in).toBe(true);

		// Check-out needs a checked-in row (#1090 guard): a legacy row the worker wrote, then
		// checked in before v5, still lacks the check-out fields.
		await memoryRepo.put(
			workerDoc('shift_assignment:w2', job._id, volunteer._id, {
				status: 'checked_in',
				check_in_at: '2026-08-27T01:00:00.000Z',
				check_in_by: 'staff-1'
			})
		);
		const checkedOut = await assignments.checkOut('shift_assignment:w2', 'staff-2');
		expect(checkedOut).toMatchObject({
			status: 'completed',
			check_in_method: 'qr',
			check_in_reason: null,
			check_out_by: 'staff-2',
			check_out_method: 'qr',
			check_out_reason: null
		});
		const stored = await memoryRepo.get<{ _id: string }>('shift_assignment:w2');
		expect(stored).toMatchObject({ check_out_by: 'staff-2', check_out_method: 'qr' });
	});

	it('assign() rolls the assignment back when the quota move fails', async () => {
		const { jobs, volunteers, assignments, job, volunteer } = await setup();
		const second = await volunteers.create({ ...volunteerInput, phone: '0899999999' }, ctx);
		const third = await volunteers.create({ ...volunteerInput, phone: '0888888888' }, ctx);

		// quota is 2 — the third assignment has no slot left to consume
		await assignments.assign(assignmentInput(job._id, volunteer._id), ctx);
		await assignments.assign(assignmentInput(job._id, second._id), ctx);
		await expect(assignments.assign(assignmentInput(job._id, third._id), ctx)).rejects.toThrow();

		expect(await assignments.list({ volunteerId: third._id })).toEqual([]);
		expect(await jobs.get(job._id)).toMatchObject({ slots_confirmed: 2, slots_remaining: 0 });
	});

	it('acceptDispatch() moves dispatch_status -> accepted and job dispatched -> confirmed', async () => {
		const { jobs, assignments, job, volunteer } = await setup();
		const assignment = await assignments.dispatch(assignmentInput(job._id, volunteer._id), ctx);

		const accepted = await assignments.acceptDispatch(assignment._id);
		expect(accepted.dispatch_status).toBe('accepted');

		const reloadedJob = await jobs.get(job._id);
		expect(reloadedJob).toMatchObject({
			slots_confirmed: 1,
			slots_dispatched: 0,
			slots_remaining: 1
		});
	});

	it('declineDispatch() cancels the assignment and gives the slot back to remaining', async () => {
		const { jobs, assignments, job, volunteer } = await setup();
		const assignment = await assignments.dispatch(assignmentInput(job._id, volunteer._id), ctx);

		const declined = await assignments.declineDispatch(assignment._id);
		expect(declined.dispatch_status).toBe('declined');
		expect(declined.status).toBe('cancelled');

		const reloadedJob = await jobs.get(job._id);
		expect(reloadedJob).toMatchObject({
			slots_confirmed: 0,
			slots_dispatched: 0,
			slots_remaining: 2
		});
	});

	it('acceptDispatch()/declineDispatch() reject an assignment that is not dispatch_status=dispatched', async () => {
		const { assignments, job, volunteer } = await setup();
		const assignment = await assignments.dispatch(assignmentInput(job._id, volunteer._id), ctx);
		await assignments.acceptDispatch(assignment._id);

		await expect(assignments.acceptDispatch(assignment._id)).rejects.toThrow(
			/ไม่ได้อยู่ในสถานะรอตอบรับ/
		);
		await expect(assignments.declineDispatch(assignment._id)).rejects.toThrow(
			/ไม่ได้อยู่ในสถานะรอตอบรับ/
		);
	});

	it('checkIn() sets status=checked_in and flips volunteer.checked_in', async () => {
		const { volunteers, assignments, job, volunteer } = await setup();
		const assignment = await assignments.dispatch(assignmentInput(job._id, volunteer._id), ctx);

		const checkedIn = await assignments.checkIn(assignment._id, 'staff-1');
		expect(checkedIn.status).toBe('checked_in');
		expect(checkedIn.check_in_method).toBe('qr');
		expect(checkedIn.check_in_by).toBe('staff-1');

		const reloadedVolunteer = await volunteers.get(volunteer._id);
		expect(reloadedVolunteer?.checked_in).toBe(true);
		expect(reloadedVolunteer?.current_shelter_code).toBe(assignment.shelter_code);
	});

	it('checkIn() requires a reason for manual_override', async () => {
		const { assignments, job, volunteer } = await setup();
		const assignment = await assignments.dispatch(assignmentInput(job._id, volunteer._id), ctx);

		await expect(assignments.checkIn(assignment._id, 'staff-1', 'manual_override')).rejects.toThrow(
			/Manual Override/
		);

		const withReason = await assignments.checkIn(
			assignment._id,
			'staff-1',
			'manual_override',
			'QR สแกนไม่ได้'
		);
		expect(withReason.check_in_method).toBe('manual_override');
		expect(withReason.check_in_reason).toBe('QR สแกนไม่ได้');
	});

	it('checkOut() sets status=completed, records check_out_by, and clears volunteer.checked_in', async () => {
		const { volunteers, assignments, job, volunteer } = await setup();
		const assignment = await assignments.dispatch(assignmentInput(job._id, volunteer._id), ctx);
		await assignments.checkIn(assignment._id, 'staff-1');

		const checkedOut = await assignments.checkOut(assignment._id, 'staff-2');
		expect(checkedOut.status).toBe('completed');
		expect(checkedOut.check_out_at).not.toBeNull();
		expect(checkedOut.check_out_method).toBe('qr');
		expect(checkedOut.check_out_by).toBe('staff-2');

		const reloadedVolunteer = await volunteers.get(volunteer._id);
		expect(reloadedVolunteer?.checked_in).toBe(false);
		expect(reloadedVolunteer?.current_shelter_code).toBeNull();
	});

	it('checkOut() keeps volunteer.checked_in when another assignment remains active', async () => {
		const { jobs, volunteers, assignments, job, volunteer } = await setup();
		const secondJob = await jobs.create({ ...jobInput, title: 'งานสนับสนุนอีกจุดหนึ่ง' }, ctx);
		const first = await assignments.assign(assignmentInput(job._id, volunteer._id), ctx);
		const second = await assignments.assign(assignmentInput(secondJob._id, volunteer._id), ctx);

		await assignments.checkIn(first._id, 'staff-1');
		await assignments.checkIn(second._id, 'staff-1');
		await assignments.checkOut(first._id, 'staff-2');

		const reloadedVolunteer = await volunteers.get(volunteer._id);
		expect(reloadedVolunteer?.checked_in).toBe(true);
		expect(reloadedVolunteer?.current_shelter_code).toBe(second.shelter_code);
	});

	it('checkOut() requires a reason for manual_override', async () => {
		const { assignments, job, volunteer } = await setup();
		const assignment = await assignments.dispatch(assignmentInput(job._id, volunteer._id), ctx);
		await assignments.checkIn(assignment._id, 'staff-1');

		await expect(
			assignments.checkOut(assignment._id, 'staff-2', 'manual_override')
		).rejects.toThrow(/Manual Override/);

		const withReason = await assignments.checkOut(
			assignment._id,
			'staff-2',
			'manual_override',
			'ลืมสแกนออกก่อนกลับ'
		);
		expect(withReason.check_out_method).toBe('manual_override');
		expect(withReason.check_out_reason).toBe('ลืมสแกนออกก่อนกลับ');
	});

	it('checkIn() refuses an assignment that is already checked in and keeps the first record', async () => {
		const { assignments, job, volunteer } = await setup();
		const assignment = await assignments.dispatch(assignmentInput(job._id, volunteer._id), ctx);
		const first = await assignments.checkIn(assignment._id, 'staff-1');

		await expect(assignments.checkIn(assignment._id, 'staff-2')).rejects.toThrow(
			'อาสาสมัครเช็คอินไปแล้ว'
		);

		const stored = await assignments.get(assignment._id);
		expect(stored?.check_in_by).toBe('staff-1');
		expect(stored?.check_in_at).toBe(first.check_in_at);
	});

	it('checkIn() refuses a completed assignment', async () => {
		const { assignments, job, volunteer } = await setup();
		const assignment = await assignments.dispatch(assignmentInput(job._id, volunteer._id), ctx);
		await assignments.checkIn(assignment._id, 'staff-1');
		await assignments.checkOut(assignment._id, 'staff-1');

		await expect(assignments.checkIn(assignment._id, 'staff-2')).rejects.toThrow(
			/ไม่อยู่ในสถานะที่เช็คอินได้/
		);
		expect((await assignments.get(assignment._id))?.status).toBe('completed');
	});

	it('checkOut() refuses a second check-out and keeps the first by/at/method/reason', async () => {
		const { assignments, job, volunteer } = await setup();
		const assignment = await assignments.dispatch(assignmentInput(job._id, volunteer._id), ctx);
		await assignments.checkIn(assignment._id, 'staff-1');
		const first = await assignments.checkOut(
			assignment._id,
			'staff-A',
			'manual_override',
			'ลืมสแกนออก'
		);

		await expect(assignments.checkOut(assignment._id, 'staff-B')).rejects.toThrow(
			'อาสาสมัครเช็คเอาต์ไปแล้ว'
		);

		const stored = await assignments.get(assignment._id);
		expect(stored?.check_out_by).toBe('staff-A');
		expect(stored?.check_out_at).toBe(first.check_out_at);
		expect(stored?.check_out_method).toBe('manual_override');
		expect(stored?.check_out_reason).toBe('ลืมสแกนออก');
	});

	it('checkOut() refuses an assignment that was never checked in and writes nothing', async () => {
		const { volunteers, assignments, job, volunteer } = await setup();
		const assignment = await assignments.dispatch(assignmentInput(job._id, volunteer._id), ctx);

		await expect(assignments.checkOut(assignment._id, 'staff-2')).rejects.toThrow(
			'ยังไม่ได้เช็คอิน'
		);

		const stored = await assignments.get(assignment._id);
		expect(stored?.status).toBe(assignment.status);
		expect(stored?.check_out_at).toBeNull();
		expect((await volunteers.get(volunteer._id))?.checked_in).toBe(false);
	});

	it('list() filters by volunteerId/jobId/date/status', async () => {
		const { assignments, job, volunteer } = await setup();
		await assignments.dispatch(assignmentInput(job._id, volunteer._id), ctx);

		expect((await assignments.list({ volunteerId: volunteer._id })).length).toBe(1);
		expect((await assignments.list({ jobId: job._id })).length).toBe(1);
		expect((await assignments.list({ date: '2026-08-27' })).length).toBe(1);
		expect((await assignments.list({ status: 'assigned' })).length).toBe(1);
		expect((await assignments.list({ status: 'completed' })).length).toBe(0);
	});
});
