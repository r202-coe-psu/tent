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

	it('checkOut() sets status=completed and clears volunteer.checked_in', async () => {
		const { volunteers, assignments, job, volunteer } = await setup();
		const assignment = await assignments.dispatch(assignmentInput(job._id, volunteer._id), ctx);
		await assignments.checkIn(assignment._id, 'staff-1');

		const checkedOut = await assignments.checkOut(assignment._id);
		expect(checkedOut.status).toBe('completed');
		expect(checkedOut.check_out_at).not.toBeNull();

		const reloadedVolunteer = await volunteers.get(volunteer._id);
		expect(reloadedVolunteer?.checked_in).toBe(false);
		expect(reloadedVolunteer?.current_shelter_code).toBeNull();
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
