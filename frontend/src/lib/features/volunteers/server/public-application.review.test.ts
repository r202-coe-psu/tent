import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
	find: vi.fn(),
	get: vi.fn(),
	put: vi.fn(),
	admin: vi.fn(),
	master: vi.fn()
}));

vi.mock('$lib/db/hash', () => ({
	sha256Hex: vi.fn(async (value: string) => `${value}-hash`)
}));

vi.mock('$lib/db/ulid', () => ({ ulid: vi.fn(() => '01TESTULID') }));

vi.mock('$lib/server/couch-public-writer', () => ({
	findAsPublicWriter: state.find,
	getAsPublicWriter: state.get,
	putAsPublicWriter: state.put,
	rollbackAsPublicWriter: vi.fn()
}));

vi.mock('$lib/server/couch-admin', () => ({ adminRaw: state.admin }));
vi.mock('$lib/server/master-data-server', () => ({ readEffectiveMasterDoc: state.master }));
vi.mock('$lib/server/shelter-access-design', () => ({ shelterDbName: () => 'shelter_sh001' }));

import { applyPublicVolunteerApplication } from './public-application';

const job = {
	_id: 'job:target',
	type: 'job' as const,
	schema_v: 3,
	shelter_code: 'SH001',
	title: 'งานคัดแยกของบริจาค',
	status: 'open',
	tier: 'operational',
	auto_accept: true,
	quota: 2,
	slots_confirmed: 0,
	slots_dispatched: 0,
	slots_remaining: 2,
	shifts: [
		{
			id: 'shift-target',
			date: '2026-09-20',
			end_date: '2026-09-20',
			start_time: '09:00',
			end_time: '12:00',
			quota: 2,
			slots_confirmed: 1,
			slots_remaining: 1
		}
	]
};

const volunteer = {
	_id: 'volunteer:existing',
	type: 'volunteer',
	phone_hash: '0812345678-hash',
	first_name: 'สมชาย',
	last_name: 'ใจดี',
	skills: [],
	identity_verified: true
};

const input = {
	first_name: 'สมชาย',
	last_name: 'ใจดี',
	phone: '0812345678',
	email: '',
	skills: [],
	shift_id: 'shift-target',
	shelter_code: 'SH001'
};

beforeEach(() => {
	state.find.mockReset();
	state.get.mockReset();
	state.put.mockReset();
	state.admin.mockReset();
	state.master.mockReset();
	state.master.mockResolvedValue(null);
	state.get.mockImplementation(async (_db: string, id: string) =>
		id === job._id ? { status: 200, data: structuredClone(job) } : { status: 404, data: null }
	);
	state.find.mockImplementation(async (_db: string, selector: Record<string, unknown>) => {
		if (selector.type === 'volunteer') return { status: 200, data: { docs: [volunteer] } };
		if (selector.type === 'job_application') return { status: 200, data: { docs: [] } };
		if (selector.type === 'shift_assignment') return { status: 200, data: { docs: [] } };
		return { status: 200, data: { docs: [] } };
	});
	state.put.mockResolvedValue({ status: 201, data: { ok: true } });
});

describe('public application review safeguards', () => {
	it('rejects an overlapping active assignment before writing the application', async () => {
		state.find.mockImplementation(async (_db: string, selector: Record<string, unknown>) => {
			if (selector.type === 'volunteer') return { status: 200, data: { docs: [volunteer] } };
			if (selector.type === 'job_application') return { status: 200, data: { docs: [] } };
			if (selector.type === 'shift_assignment') {
				return {
					status: 200,
					data: {
						docs: [
							{
								_id: 'shift_assignment:existing',
								type: 'shift_assignment',
								volunteer_id: volunteer._id,
								status: 'checked_in',
								duty_window: {
									start_ts: '2026-09-20T01:00:00.000Z',
									end_ts: '2026-09-20T05:00:00.000Z'
								}
							}
						]
					}
				};
			}
			return { status: 200, data: { docs: [] } };
		});

		await expect(applyPublicVolunteerApplication('job:target', input)).rejects.toMatchObject({
			code: 'TIME_CONFLICT',
			httpStatus: 409
		});
		expect(state.put).not.toHaveBeenCalled();
	});

	it('rejects a selected shift when the aggregate job quota is already full', async () => {
		state.get.mockImplementation(async (_db: string, id: string) =>
			id === job._id
				? {
						status: 200,
						data: { ...structuredClone(job), slots_remaining: 0, status: 'open' }
					}
				: { status: 404, data: null }
		);

		await expect(applyPublicVolunteerApplication('job:target', input)).rejects.toMatchObject({
			code: 'JOB_FULL',
			httpStatus: 409
		});
		expect(state.put).not.toHaveBeenCalled();
	});
});
