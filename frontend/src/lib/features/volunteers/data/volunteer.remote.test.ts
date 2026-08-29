import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createInMemoryRepository } from '$lib/db/in-memory-repository';
import type { AuthorContext } from '$lib/db/model';

let memoryRepo = createInMemoryRepository();
vi.mock('$lib/db/repository', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/db/repository')>();
	return { ...actual, createRemoteRepository: () => memoryRepo };
});
vi.mock('$lib/db/shelter', () => ({ getShelterDb: () => 'shelter_sh001' }));

import { createVolunteerRepositoryForTest } from './volunteer.remote';
import type { VolunteerInput } from '../domain/volunteer.schema';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'tester' };

const baseInput: VolunteerInput = {
	first_name: 'สมชาย',
	last_name: 'ใจดี',
	phone: '0812345678',
	skills: ['ขับรถ'],
	source: 'walk_in',
	national_id: null
};

describe('VolunteerRemoteRepository', () => {
	beforeEach(() => {
		memoryRepo = createInMemoryRepository();
	});

	it('mints sequential volunteer_code starting at V-001', async () => {
		const repo = createVolunteerRepositoryForTest('shelter_sh001');
		const first = await repo.create(baseInput, ctx);
		const second = await repo.create({ ...baseInput, first_name: 'สมหญิง' }, ctx);

		expect(first.volunteer_code).toBe('V-001');
		expect(second.volunteer_code).toBe('V-002');
	});

	it('stamps envelope defaults from makeVolunteer (checked_in=false, identity_verified=false)', async () => {
		const repo = createVolunteerRepositoryForTest('shelter_sh001');
		const volunteer = await repo.create(baseInput, ctx);

		expect(volunteer._id).toMatch(/^volunteer:/);
		expect(volunteer.schema_v).toBe(3);
		expect(volunteer.checked_in).toBe(false);
		expect(volunteer.identity_verified).toBe(false);
		expect(volunteer.current_shelter_code).toBeNull();
		expect(volunteer.status).toBe('active');
	});

	it('list() filters by status/source/checkedIn', async () => {
		const repo = createVolunteerRepositoryForTest('shelter_sh001');
		await repo.create(baseInput, ctx, { status: 'active' });
		await repo.create({ ...baseInput, source: 'public_apply' }, ctx, { status: 'inactive' });

		expect((await repo.list({ status: 'inactive' })).length).toBe(1);
		expect((await repo.list({ source: 'public_apply' })).length).toBe(1);
		expect((await repo.list()).length).toBe(2);
	});

	it('setCheckedIn flips checked_in + current_shelter_code with a fresh _rev', async () => {
		const repo = createVolunteerRepositoryForTest('shelter_sh001');
		const created = await repo.create(baseInput, ctx);

		const checkedIn = await repo.setCheckedIn(created._id, true, 'SH001');
		expect(checkedIn.checked_in).toBe(true);
		expect(checkedIn.current_shelter_code).toBe('SH001');
		expect(checkedIn._rev).not.toBe(created._rev);

		const checkedOut = await repo.setCheckedIn(created._id, false, null);
		expect(checkedOut.checked_in).toBe(false);
		expect(checkedOut.current_shelter_code).toBeNull();
	});

	it('getByTrackingToken / getByPhoneHash return null when absent', async () => {
		const repo = createVolunteerRepositoryForTest('shelter_sh001');
		expect(await repo.getByTrackingToken('missing')).toBeNull();
		expect(await repo.getByPhoneHash('missing')).toBeNull();
	});

	it('update() throws for a document that does not exist', async () => {
		const repo = createVolunteerRepositoryForTest('shelter_sh001');
		const created = await repo.create(baseInput, ctx);
		await expect(repo.update({ ...created, _id: 'volunteer:missing' })).rejects.toThrow(
			'ไม่พบข้อมูลอาสาสมัคร'
		);
	});
});
