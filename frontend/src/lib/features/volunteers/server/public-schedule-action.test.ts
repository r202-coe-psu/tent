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

import { applyPublicScheduleAction, readPublicVolunteerSchedule } from './public-schedule-action';

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
