import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import {
	applyPublicVolunteerApplication,
	preflightPublicVolunteerApplication
} from './public-application';

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
			id: 'shift-morning',
			date: '2026-09-20',
			start_time: '09:00',
			end_time: '12:00',
			quota: 2,
			slots_confirmed: 0,
			slots_remaining: 2
		},
		{
			id: 'shift-afternoon',
			date: '2026-09-20',
			start_time: '13:00',
			end_time: '16:00',
			quota: 2,
			slots_confirmed: 0,
			slots_remaining: 2
		}
	]
};

const volunteer = {
	_id: 'volunteer:existing',
	type: 'volunteer',
	volunteer_code: 'VOL-0001',
	phone_hash: '0812345678-hash',
	first_name: 'สมชาย',
	last_name: 'ใจดี',
	skills: ['cooking'],
	identity_verified: true
};

const input = {
	first_name: 'สมชาย',
	last_name: 'ใจดี',
	phone: '0812345678',
	email: '',
	skills: [],
	shift_id: 'shift-morning',
	shift_date: '2026-09-20',
	shelter_code: 'SH001'
};

function jobResponse(override: Record<string, unknown> = {}) {
	state.get.mockImplementation(async (_db: string, id: string) =>
		id === job._id
			? { status: 200, data: { ...structuredClone(job), ...override } }
			: { status: 404, data: null }
	);
}

function volunteersFound(docs: unknown[]) {
	state.find.mockImplementation(async (_db: string, selector: Record<string, unknown>) =>
		selector.type === 'volunteer'
			? { status: 200, data: { docs } }
			: { status: 200, data: { docs: [] } }
	);
}

beforeEach(() => {
	state.find.mockReset();
	state.get.mockReset();
	state.put.mockReset();
	state.admin.mockReset();
	state.master.mockReset();
	state.master.mockResolvedValue(null);
	jobResponse();
	volunteersFound([]);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('preflightPublicVolunteerApplication', () => {
	it('reports no_match for a phone with no volunteer profile', async () => {
		await expect(preflightPublicVolunteerApplication('job:target', input)).resolves.toMatchObject({
			match: 'no_match'
		});
	});

	it('describes the one matching profile, masked, with the skills it would gain', async () => {
		volunteersFound([volunteer]);

		const result = await preflightPublicVolunteerApplication('job:target', {
			...input,
			skills: ['cooking', 'first aid', 'First Aid']
		});

		expect(result).toEqual({
			match: 'matched_one',
			existing_profile: {
				volunteer_code: 'VOL-0001',
				display_name: 'ส*** ใ***',
				identity_status: 'verified',
				existing_skills: ['cooking'],
				new_skills: ['first aid'],
				new_controlled_skills: ['first aid']
			},
			message: expect.any(String)
		});
	});

	it('reports ambiguous_match when the phone hash hits more than one profile', async () => {
		volunteersFound([volunteer, { ...volunteer, _id: 'volunteer:other' }]);

		await expect(preflightPublicVolunteerApplication('job:target', input)).resolves.toMatchObject({
			match: 'ambiguous_match'
		});
	});

	it('never writes', async () => {
		volunteersFound([volunteer]);

		await preflightPublicVolunteerApplication('job:target', input);

		expect(state.put).not.toHaveBeenCalled();
	});

	it('rejects a job that is no longer open before matching the phone', async () => {
		jobResponse({ status: 'closed' });

		await expect(preflightPublicVolunteerApplication('job:target', input)).rejects.toMatchObject({
			code: 'JOB_NOT_OPEN',
			httpStatus: 409
		});
		expect(state.find).not.toHaveBeenCalled();
	});

	it('rejects a shift the job does not advertise', async () => {
		await expect(
			preflightPublicVolunteerApplication('job:target', {
				...input,
				shift_id: 'shift-forged',
				shift_date: '2026-09-21'
			})
		).rejects.toMatchObject({ code: 'SHIFT_NOT_FOUND', httpStatus: 422 });
	});

	it('uses shift_date to pick the shift when there is no shift id', async () => {
		await expect(
			preflightPublicVolunteerApplication('job:target', {
				...input,
				shift_id: undefined,
				shift_date: '2026-09-20',
				start_time: '13:00'
			})
		).resolves.toMatchObject({ match: 'no_match' });
	});

	it('answers JOB_NOT_FOUND for a job that does not exist', async () => {
		await expect(preflightPublicVolunteerApplication('job:missing', input)).rejects.toMatchObject({
			code: 'JOB_NOT_FOUND',
			httpStatus: 404
		});
	});

	it('answers JOB_NOT_FOUND for a job filed under another shelter', async () => {
		jobResponse({ shelter_code: 'SH002' });

		await expect(preflightPublicVolunteerApplication('job:target', input)).rejects.toMatchObject({
			code: 'JOB_NOT_FOUND',
			httpStatus: 404
		});
	});
});

describe('public_writer refused by CouchDB', () => {
	it.each([401, 403])(
		'answers WRITER_UNAVAILABLE, not JOB_NOT_READY, and logs the fix (HTTP %i)',
		async (status) => {
			const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
			state.get.mockResolvedValue({ status, data: { error: 'unauthorized' } });

			await expect(preflightPublicVolunteerApplication('job:target', input)).rejects.toMatchObject({
				code: 'WRITER_UNAVAILABLE',
				httpStatus: 503
			});
			await expect(applyPublicVolunteerApplication('job:target', input)).rejects.toMatchObject({
				code: 'WRITER_UNAVAILABLE',
				httpStatus: 503
			});
			expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('redeploy:access'));
		}
	);

	it('keeps JOB_NOT_READY for any other CouchDB failure', async () => {
		state.get.mockResolvedValue({ status: 500, data: null });

		await expect(preflightPublicVolunteerApplication('job:target', input)).rejects.toMatchObject({
			code: 'JOB_NOT_READY',
			httpStatus: 409
		});
	});
});
