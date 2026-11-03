import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
	docs: new Map<string, Record<string, unknown>>(),
	find: vi.fn(),
	get: vi.fn(),
	put: vi.fn(),
	admin: vi.fn()
}));

vi.mock('$lib/db/hash', () => ({
	sha256Hex: vi.fn(async (value: string) => `${value}-hash`)
}));

vi.mock('$lib/server/couch-public-writer', () => ({
	findAsPublicWriter: state.find,
	getAsPublicWriter: state.get,
	putAsPublicWriter: state.put
}));

vi.mock('$lib/server/couch-admin', () => ({ adminRaw: state.admin }));

import {
	applyPublicScheduleAction,
	readPublicVolunteerSchedule,
	releaseJobQuota
} from './public-schedule-action';

const volunteer = {
	_id: 'volunteer:01TEST',
	_rev: '1-a',
	type: 'volunteer',
	phone_hash: '0812345678-hash',
	checked_in: false,
	current_shelter_code: null
};

const assignment = {
	_id: 'shift_assignment:01TEST',
	_rev: '1-b',
	type: 'shift_assignment',
	volunteer_id: volunteer._id,
	job_id: 'job:01TEST',
	shift_id: 'shift:01TEST',
	date: '2026-09-09',
	shift: 'morning',
	station: 'จุดรับลงทะเบียน',
	duty_window: {
		start_ts: '2026-09-09T01:00:00.000Z',
		end_ts: '2026-09-09T09:00:00.000Z'
	},
	status: 'assigned',
	dispatch_status: null,
	check_in_at: null,
	check_out_at: null,
	check_in_method: 'qr',
	check_in_reason: null,
	check_out_method: 'qr',
	check_out_reason: null
};

const job = { _id: 'job:01TEST', type: 'job', title: 'งานรับลงทะเบียน' };

beforeEach(() => {
	state.docs.clear();
	state.docs.set(volunteer._id, structuredClone(volunteer));
	state.docs.set(assignment._id, structuredClone(assignment));
	state.docs.set(job._id, structuredClone(job));
	state.find.mockReset();
	state.get.mockReset();
	state.put.mockReset();
	state.admin.mockReset();
	state.admin.mockResolvedValue({
		status: 200,
		data: { rows: [{ doc: { type: 'shelter', code: 'SH001', name: 'ศูนย์ทดสอบ' } }] }
	});
	state.find.mockImplementation(async (_db: string, selector: Record<string, unknown>) => {
		if (selector.type === 'volunteer')
			return { status: 200, data: { docs: [state.docs.get(volunteer._id)] } };
		if (selector.type === 'shift_assignment') {
			if (selector.status === 'checked_in') {
				return {
					status: 200,
					data: {
						docs: [...state.docs.values()].filter(
							(doc) => doc.type === 'shift_assignment' && doc.status === 'checked_in'
						)
					}
				};
			}
			return { status: 200, data: { docs: [state.docs.get(assignment._id)] } };
		}
		return { status: 200, data: { docs: [] } };
	});
	state.get.mockImplementation(async (_db: string, id: string) => ({
		status: state.docs.has(id) ? 200 : 404,
		data: state.docs.get(id) ?? null
	}));
	state.put.mockImplementation(async (_db: string, id: string, doc: Record<string, unknown>) => {
		state.docs.set(id, { ...doc, _rev: '2-updated' });
		return { status: 201, data: { ok: true, id, rev: '2-updated' } };
	});
});

afterEach(() => vi.useRealTimers());

describe('public schedule CouchDB path', () => {
	it('requires the bearer ticket token before allowing withdrawal', async () => {
		await expect(
			applyPublicScheduleAction(
				{ phone: '0812345678', portal_id: volunteer._id },
				assignment._id,
				'withdraw'
			)
		).rejects.toMatchObject({ code: 'INVALID_CREDENTIAL', httpStatus: 401 });
		expect(state.docs.get(assignment._id)).toMatchObject({ status: 'assigned' });
		expect(state.find).not.toHaveBeenCalled();
	});

	it('writes check-in directly to the assignment and volunteer documents', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-09-09T02:00:00.000Z'));
		const result = await applyPublicScheduleAction(
			{ phone: '0812345678', portal_id: volunteer._id },
			assignment._id,
			'check_in'
		);

		expect(result.success).toBe(true);
		expect(result.status).toBe('checked_in');
		expect(state.docs.get(assignment._id)).toMatchObject({
			status: 'checked_in',
			check_in_by: 'volunteer_portal',
			check_in_method: 'portal'
		});
		expect(state.docs.get(volunteer._id)).toMatchObject({
			checked_in: true,
			current_shelter_code: 'SH001'
		});
	});

	it('rejects public check-in outside the duty window', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-09-08T02:00:00.000Z'));

		await expect(
			applyPublicScheduleAction({ phone: '0812345678' }, assignment._id, 'check_in')
		).rejects.toMatchObject({ code: 'SHIFT_NOT_READY_FOR_CHECK_IN' });
		expect(state.docs.get(assignment._id)).toMatchObject({ status: 'assigned' });
		expect(state.put).not.toHaveBeenCalled();
	});

	it('keeps volunteer attendance active when another assignment is still checked in', async () => {
		const otherAssignment = {
			...structuredClone(assignment),
			_id: 'shift_assignment:01OTHER',
			shelter_code: 'SH002',
			status: 'checked_in'
		};
		state.docs.set(assignment._id, { ...assignment, status: 'checked_in' });
		state.docs.set(otherAssignment._id, otherAssignment);

		const result = await applyPublicScheduleAction(
			{ phone: '0812345678' },
			assignment._id,
			'check_out'
		);

		expect(result.status).toBe('completed');
		expect(state.docs.get(volunteer._id)).toMatchObject({
			checked_in: true,
			current_shelter_code: 'SH002'
		});
	});

	it('reads the updated assignment from CouchDB for the portal schedule', async () => {
		state.docs.set(assignment._id, {
			...assignment,
			status: 'checked_in',
			check_in_at: '2026-09-09T08:01:00.000Z'
		});

		const result = await readPublicVolunteerSchedule({ phone: '0812345678' });

		expect(result.shifts).toHaveLength(1);
		expect(result.shifts[0]).toMatchObject({
			assignment_id: assignment._id,
			job_title: 'งานรับลงทะเบียน',
			status: 'checked_in',
			check_in_at: '2026-09-09T08:01:00.000Z'
		});
	});
});

describe('releaseJobQuota ledger (CR-220)', () => {
	const NOW = '2026-10-27T03:00:00.000Z';
	const owner = { _id: 'job_application:a1', job_id: 'job:01TEST', shift_id: 'shift:s1' };
	const seedJob = (extra: Record<string, unknown> = {}) =>
		state.docs.set(job._id, {
			...job,
			schema_v: 3,
			status: 'full',
			slots_confirmed: 2,
			slots_remaining: 0,
			shifts: [{ shift_id: 'shift:s1', slots_confirmed: 2, slots_remaining: 0 }],
			...extra
		});
	const stored = () => state.docs.get(job._id) as Record<string, unknown>;

	it('with a key: releases once and records the key in the same write (AC-4)', async () => {
		seedJob();
		await releaseJobQuota('shelter_sh001', owner, NOW, owner._id);
		await releaseJobQuota('shelter_sh001', owner, NOW, owner._id);

		expect(stored()).toMatchObject({
			slots_confirmed: 1,
			slots_remaining: 1,
			status: 'open',
			schema_v: 4,
			released_application_ids: [owner._id],
			shifts: [{ shift_id: 'shift:s1', slots_confirmed: 1, slots_remaining: 1 }]
		});
		// The first call wrote the job, the second only read it.
		expect(state.put).toHaveBeenCalledTimes(1);
	});

	it('with a key already in the ledger: success without a write (AC-4)', async () => {
		seedJob({ released_application_ids: [owner._id], schema_v: 4 });
		await releaseJobQuota('shelter_sh001', owner, NOW, owner._id);
		expect(state.put).not.toHaveBeenCalled();
		expect(stored()).toMatchObject({ slots_confirmed: 2, slots_remaining: 0 });
	});

	it('keeps the other ids and adds a new one', async () => {
		seedJob({ released_application_ids: ['job_application:other'], schema_v: 4 });
		await releaseJobQuota('shelter_sh001', owner, NOW, owner._id);
		expect(stored().released_application_ids).toEqual(['job_application:other', owner._id]);
		expect(stored()).toMatchObject({ slots_confirmed: 1 });
	});

	it('a 409 re-reads the job: a key a rival just recorded is not released again (AC-4)', async () => {
		seedJob();
		state.put.mockImplementationOnce(async () => {
			// A rival release of the same key lands first.
			seedJob({
				slots_confirmed: 1,
				slots_remaining: 1,
				released_application_ids: [owner._id],
				schema_v: 4
			});
			return { status: 409, data: null };
		});
		await releaseJobQuota('shelter_sh001', owner, NOW, owner._id);
		expect(state.put).toHaveBeenCalledTimes(1);
		expect(stored()).toMatchObject({ slots_confirmed: 1, slots_remaining: 1 });
	});

	it('without a key: behaves as before and leaves the ledger and schema_v alone (AC-4)', async () => {
		seedJob();
		await releaseJobQuota('shelter_sh001', owner, NOW);
		await releaseJobQuota('shelter_sh001', owner, NOW);
		expect(stored()).toMatchObject({ slots_confirmed: 0, slots_remaining: 2, schema_v: 3 });
		expect(stored().released_application_ids).toBeUndefined();
	});

	it('frees no seat when the counter is already 0, but still records the key', async () => {
		seedJob({
			slots_confirmed: 0,
			slots_remaining: 2,
			shifts: [{ shift_id: 'shift:s1', slots_confirmed: 0, slots_remaining: 2 }]
		});
		await releaseJobQuota('shelter_sh001', owner, NOW, owner._id);
		expect(stored()).toMatchObject({
			slots_confirmed: 0,
			slots_remaining: 2,
			released_application_ids: [owner._id],
			shifts: [{ shift_id: 'shift:s1', slots_confirmed: 0, slots_remaining: 2 }]
		});
	});

	it.each(['closed', 'paused'])(
		'leaves a %s job as it is while freeing the seat',
		async (status) => {
			seedJob({ status });
			await releaseJobQuota('shelter_sh001', owner, NOW, owner._id);
			expect(stored()).toMatchObject({ status, slots_confirmed: 1, slots_remaining: 1 });
		}
	);
});
