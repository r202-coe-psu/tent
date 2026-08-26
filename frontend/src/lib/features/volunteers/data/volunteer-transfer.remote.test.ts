import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createInMemoryRepository } from '$lib/db/in-memory-repository';
import type { AuthorContext } from '$lib/db/model';

let memoryRepo = createInMemoryRepository();
vi.mock('$lib/db/repository', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/db/repository')>();
	return { ...actual, createRemoteRepository: () => memoryRepo };
});
vi.mock('$lib/db/shelter', () => ({ getShelterDb: () => 'shelter_sh001' }));

import { createVolunteerTransferRepositoryForTest } from './volunteer-transfer.remote';
import type { VolunteerTransferInput } from '../domain/volunteer-transfer.schema';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'tester' };

const baseInput: VolunteerTransferInput = {
	volunteer_id: 'volunteer:01AAAAAAAAAAAAAAAAAAAAAAAA',
	from_shelter_code: 'SH001',
	to_shelter_code: 'SH002',
	reason: 'ย้ายที่พักอาศัย'
};

describe('VolunteerTransferRemoteRepository', () => {
	beforeEach(() => {
		memoryRepo = createInMemoryRepository();
	});

	it('request() mints a pending transfer bound to the active shelter DB', async () => {
		const repo = createVolunteerTransferRepositoryForTest('shelter_sh001');
		const transfer = await repo.request(baseInput, ctx);
		expect(transfer.status).toBe('pending');
		expect(transfer.requested_by).toBe('tester');
		expect(transfer._id).toMatch(/^volunteer_transfer:/);
	});

	it('decide(accepted) stamps decided_by/decided_at and does not touch any other DB', async () => {
		const repo = createVolunteerTransferRepositoryForTest('shelter_sh001');
		const created = await repo.request(baseInput, ctx);

		const decided = await repo.decide(created._id, 'accepted', 'manager-1');
		expect(decided.status).toBe('accepted');
		expect(decided.decided_by).toBe('manager-1');
		expect(decided.decided_at).not.toBeNull();
	});

	it('decide() throws for a transfer that is already resolved', async () => {
		const repo = createVolunteerTransferRepositoryForTest('shelter_sh001');
		const created = await repo.request(baseInput, ctx);
		await repo.decide(created._id, 'rejected', 'manager-1');

		await expect(repo.decide(created._id, 'accepted', 'manager-1')).rejects.toThrow(
			/ถูกพิจารณาไปแล้ว/
		);
	});

	it('cancel() withdraws a still-pending request', async () => {
		const repo = createVolunteerTransferRepositoryForTest('shelter_sh001');
		const created = await repo.request(baseInput, ctx);

		const cancelled = await repo.cancel(created._id, 'requester-1');
		expect(cancelled.status).toBe('cancelled');
	});

	it('cancel() throws once a decision has already been made', async () => {
		const repo = createVolunteerTransferRepositoryForTest('shelter_sh001');
		const created = await repo.request(baseInput, ctx);
		await repo.decide(created._id, 'accepted', 'manager-1');

		await expect(repo.cancel(created._id, 'requester-1')).rejects.toThrow(/ยกเลิกไม่ได้แล้ว/);
	});

	it('list() filters by toShelterCode/volunteerId/status', async () => {
		const repo = createVolunteerTransferRepositoryForTest('shelter_sh001');
		await repo.request(baseInput, ctx);
		await repo.request({ ...baseInput, to_shelter_code: 'SH003' }, ctx);

		expect((await repo.list({ toShelterCode: 'SH002' })).length).toBe(1);
		expect((await repo.list({ volunteerId: baseInput.volunteer_id })).length).toBe(2);
		expect((await repo.list({ status: 'pending' })).length).toBe(2);
	});
});
