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
			slots_confirmed: 0,
			slots_remaining: 2
		}
	]
};

const baseInput = {
	first_name: 'สมชาย',
	last_name: 'ใจดี',
	phone: '0812345678',
	email: '',
	skills: [],
	shift_id: 'shift-target',
	shelter_code: 'SH001'
};

function mockFindFor(volunteerDocs: Record<string, unknown>[]) {
	state.find.mockImplementation(async (_db: string, selector: Record<string, unknown>) => {
		if (selector.type === 'volunteer' && 'phone_hash' in selector) {
			return { status: 200, data: { docs: volunteerDocs } };
		}
		if (selector.type === 'volunteer') return { status: 200, data: { docs: [] } };
		if (selector.type === 'job_application') return { status: 200, data: { docs: [] } };
		if (selector.type === 'shift_assignment') return { status: 200, data: { docs: [] } };
		return { status: 200, data: { docs: [] } };
	});
}

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
	state.put.mockResolvedValue({ status: 201, data: { ok: true } });
});

describe('per-volunteer tracking token (role card / on-site check-in redesign)', () => {
	it('mints a fresh tracking_token_hash and returns volunteer_token for a brand-new volunteer', async () => {
		mockFindFor([]);

		const result = await applyPublicVolunteerApplication('job:target', baseInput);

		expect(result.volunteer_token).toBeDefined();
		expect(result.volunteer_token).toMatch(/^TKT-VOL-/);

		const volunteerPutCall = state.put.mock.calls.find(
			(call) => typeof call[1] === 'string' && call[1].startsWith('volunteer:')
		);
		expect(volunteerPutCall).toBeDefined();
		const volunteerDoc = volunteerPutCall![2] as Record<string, unknown>;
		expect(volunteerDoc.tracking_token_hash).toBe(`${result.volunteer_token}-hash`);
	});

	it('does not mint a new token and omits volunteer_token for a volunteer that already has one', async () => {
		const existingVolunteer = {
			_id: 'volunteer:existing',
			type: 'volunteer',
			phone_hash: '0812345678-hash',
			first_name: 'สมชาย',
			last_name: 'ใจดี',
			skills: [],
			identity_verified: true,
			tracking_token_hash: 'already-minted-hash'
		};
		mockFindFor([existingVolunteer]);

		const result = await applyPublicVolunteerApplication('job:target', baseInput);

		expect(result.volunteer_token).toBeUndefined();

		const volunteerPutCall = state.put.mock.calls.find((call) => call[1] === existingVolunteer._id);
		expect(volunteerPutCall).toBeDefined();
		const volunteerDoc = volunteerPutCall![2] as Record<string, unknown>;
		expect(volunteerDoc.tracking_token_hash).toBe('already-minted-hash');
	});
});
