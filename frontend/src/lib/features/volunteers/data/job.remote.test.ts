import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createInMemoryRepository } from '$lib/db/in-memory-repository';
import { ConflictError } from '$lib/utils/errors';
import type { AuthorContext } from '$lib/db/model';

let memoryRepo = createInMemoryRepository();
vi.mock('$lib/db/repository', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/db/repository')>();
	return { ...actual, createRemoteRepository: () => memoryRepo };
});
vi.mock('$lib/db/shelter', () => ({ getShelterDb: () => 'shelter_sh001' }));

import { createJobRepositoryForTest } from './job.remote';
import type { JobInput } from '../domain/job.schema';
import { QuotaError } from '../domain/quota';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'tester' };

const baseInput: JobInput = {
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
			quota: 5
		}
	],
	auto_accept: false,
	is_urgent: false
};

/** Same fixture with the sub-shift resized — `quota` is derived from `shifts[]`. */
function withQuota(seats: number): JobInput {
	return { ...baseInput, shifts: [{ ...baseInput.shifts[0], quota: seats }] };
}

/** Simulate N transient 409s on `repo.put`, then fall through to the real in-memory write. */
function simulateConflictsOnPut(times: number): void {
	const originalPut = memoryRepo.put.bind(memoryRepo);
	let calls = 0;
	vi.spyOn(memoryRepo, 'put').mockImplementation(async (doc: { _id: string }) => {
		calls++;
		if (calls <= times) throw new ConflictError();
		return originalPut(doc);
	});
}

describe('JobRemoteRepository — quota mutations', () => {
	beforeEach(() => {
		memoryRepo = createInMemoryRepository();
		vi.restoreAllMocks();
	});

	it('create() starts open with the full quota unclaimed', async () => {
		const repo = createJobRepositoryForTest('shelter_sh001');
		const job = await repo.create(baseInput, ctx);
		expect(job.status).toBe('open');
		expect(job).toMatchObject({
			quota: 5,
			slots_confirmed: 0,
			slots_dispatched: 0,
			slots_remaining: 5
		});
	});

	it('dispatch/acceptDispatch/declineDispatch keep the invariant through a full sequence', async () => {
		const repo = createJobRepositoryForTest('shelter_sh001');
		const created = await repo.create(baseInput, ctx);

		let job = await repo.dispatch(created._id, 3);
		expect(job).toMatchObject({ slots_confirmed: 0, slots_dispatched: 3, slots_remaining: 2 });

		job = await repo.acceptDispatch(created._id, 2);
		expect(job).toMatchObject({ slots_confirmed: 2, slots_dispatched: 1, slots_remaining: 2 });

		job = await repo.declineDispatch(created._id, 1);
		expect(job).toMatchObject({ slots_confirmed: 2, slots_dispatched: 0, slots_remaining: 3 });

		expect(job.slots_confirmed + job.slots_dispatched + job.slots_remaining).toBe(job.quota);
	});

	it('confirmSlot moves remaining -> confirmed directly, leaving dispatched untouched', async () => {
		const repo = createJobRepositoryForTest('shelter_sh001');
		const created = await repo.create(baseInput, ctx);

		const job = await repo.confirmSlot(created._id);
		expect(job).toMatchObject({ slots_confirmed: 1, slots_dispatched: 0, slots_remaining: 4 });
	});

	it('retries the read-modify-write cycle on a 409 conflict and still lands on a valid invariant', async () => {
		const repo = createJobRepositoryForTest('shelter_sh001');
		const created = await repo.create(baseInput, ctx);

		simulateConflictsOnPut(2); // two transient conflicts, then succeed
		const job = await repo.dispatch(created._id, 1);

		expect(job).toMatchObject({ slots_confirmed: 0, slots_dispatched: 1, slots_remaining: 4 });
		expect(job.slots_confirmed + job.slots_dispatched + job.slots_remaining).toBe(job.quota);
	});

	it('gives up after exceeding the retry budget and surfaces the conflict', async () => {
		const repo = createJobRepositoryForTest('shelter_sh001');
		const created = await repo.create(baseInput, ctx);

		simulateConflictsOnPut(10); // always conflicts — exceeds MAX_QUOTA_RETRIES
		await expect(repo.dispatch(created._id, 1)).rejects.toThrow();
	});

	it('rejects dispatching more than slots_remaining without writing anything', async () => {
		const repo = createJobRepositoryForTest('shelter_sh001');
		const created = await repo.create(baseInput, ctx);

		await expect(repo.dispatch(created._id, 99)).rejects.toThrow(QuotaError);

		const reloaded = await repo.get(created._id);
		expect(reloaded).toMatchObject({ slots_confirmed: 0, slots_dispatched: 0, slots_remaining: 5 });
	});

	it('rejects accepting more than slots_dispatched', async () => {
		const repo = createJobRepositoryForTest('shelter_sh001');
		const created = await repo.create(baseInput, ctx);
		await repo.dispatch(created._id, 1);

		await expect(repo.acceptDispatch(created._id, 2)).rejects.toThrow(QuotaError);
	});

	it('update() does a read-modify-write for metadata fields', async () => {
		const repo = createJobRepositoryForTest('shelter_sh001');
		const created = await repo.create(baseInput, ctx);

		const updated = await repo.update({ ...created, title: 'ผู้ช่วยครัว (แก้ไข)', status: 'open' });
		expect(updated.title).toBe('ผู้ช่วยครัว (แก้ไข)');
		expect(updated.status).toBe('open');
		expect(updated._rev).not.toBe(created._rev);
	});

	it('dispatch/acceptDispatch re-derive job.status via deriveJobStatus (F7)', async () => {
		const repo = createJobRepositoryForTest('shelter_sh001');
		// quota 5 -> almostFullCutoff = max(1, ceil(5 * 0.2)) = 1 remaining
		const created = await repo.create(withQuota(5), ctx);
		expect(created.status).toBe('open');

		// dispatched slots count toward the cutoff — 4 offered out leaves 1
		let job = await repo.dispatch(created._id, 4);
		expect(job).toMatchObject({ slots_dispatched: 4, slots_remaining: 1 });
		expect(job.status).toBe('almost_full');

		job = await repo.acceptDispatch(created._id, 4);
		expect(job).toMatchObject({ slots_confirmed: 4, slots_remaining: 1 });
		expect(job.status).toBe('almost_full');

		await repo.dispatch(created._id, 1);
		job = await repo.acceptDispatch(created._id, 1);
		expect(job).toMatchObject({ slots_confirmed: 5, slots_remaining: 0 });
		expect(job.status).toBe('full');
	});

	it('deriveJobStatus never touches a draft job even after quota mutations (F7)', async () => {
		const repo = createJobRepositoryForTest('shelter_sh001');
		const created = await repo.create(baseInput, ctx);
		const drafted = await repo.update({ ...created, status: 'draft' });
		expect(drafted.status).toBe('draft');

		const job = await repo.dispatch(created._id, created.quota);
		expect(job.status).toBe('draft');
	});

	it('list() filters by status/tier/isUrgent', async () => {
		const repo = createJobRepositoryForTest('shelter_sh001');
		await repo.create(baseInput, ctx);
		await repo.create({ ...baseInput, is_urgent: true }, ctx);

		expect((await repo.list({ isUrgent: true })).length).toBe(1);
		expect((await repo.list({ tier: 'operational' })).length).toBe(2);
	});

	it('update() rejects a document shape the schema forbids (D2 — F-AUTO bypass)', async () => {
		const repo = createJobRepositoryForTest('shelter_sh001');
		const created = await repo.create({ ...baseInput, tier: 'operational' }, ctx);

		// The exploit: flip the stored job to staff-capable + auto_accept, which
		// the F-AUTO refine forbids. `put` itself validates nothing, so without
		// validate-before-write this persists and a later public application to
		// that job resolves to `confirmed` on a staff-capable job — the path that
		// drives a CouchDB RoleKey grant (CR-094 FR-VOL-05R.2).
		await expect(
			repo.update({ ...created, tier: 'staff-capable', auto_accept: true })
		).rejects.toThrow();

		const reloaded = await repo.get(created._id);
		expect(reloaded).toMatchObject({ tier: created.tier, auto_accept: created.auto_accept });
	});

	it('update() ignores stale quota buckets from the client snapshot (D2 — lost update)', async () => {
		const repo = createJobRepositoryForTest('shelter_sh001');
		const created = await repo.create(withQuota(5), ctx);
		// A dispatch lands while the edit form sits open on `created`.
		await repo.dispatch(created._id, 2);

		const saved = await repo.update({ ...created, title: 'ชื่อใหม่' });

		expect(saved).toMatchObject({
			title: 'ชื่อใหม่',
			quota: 5,
			slots_confirmed: 0,
			slots_dispatched: 2,
			slots_remaining: 3
		});
	});

	it('update() rejects a quota lower than what is already claimed (D2)', async () => {
		const repo = createJobRepositoryForTest('shelter_sh001');
		const created = await repo.create(withQuota(5), ctx);
		await repo.dispatch(created._id, 3);

		await expect(repo.update({ ...created, quota: 2 })).rejects.toThrow(QuotaError);

		expect(await repo.get(created._id)).toMatchObject({ quota: 5, slots_dispatched: 3 });
	});

	it('update() re-derives status so a metadata edit cannot leave a full job open (D2)', async () => {
		const repo = createJobRepositoryForTest('shelter_sh001');
		const created = await repo.create(withQuota(2), ctx);
		await repo.dispatch(created._id, 2); // remaining 0 -> full
		const full = await repo.get(created._id);
		expect(full?.status).toBe('full');

		const edited = await repo.update({ ...full!, title: 'แก้ชื่องาน', status: 'open' });
		expect(edited.status).toBe('full');
	});
});
