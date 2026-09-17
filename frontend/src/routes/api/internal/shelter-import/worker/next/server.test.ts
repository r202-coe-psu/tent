import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ SHELTER_IMPORT_WORKER_TOKEN: 'worker-secret' }));
const listJobsMock = vi.hoisted(() => vi.fn());
const claimMock = vi.hoisted(() => vi.fn());
const assertClaimMock = vi.hoisted(() => vi.fn());
const renewClaimMock = vi.hoisted(() => vi.fn());
const recomputeMock = vi.hoisted(() => vi.fn());
const updateItemMock = vi.hoisted(() => vi.fn());
const resumeRetryMock = vi.hoisted(() => vi.fn());
const findByNameMock = vi.hoisted(() => vi.fn());
const updateMasterMock = vi.hoisted(() => vi.fn());
const allocateCodeMock = vi.hoisted(() => vi.fn());
const provisionMock = vi.hoisted(() => vi.fn());
const acquireNameLockMock = vi.hoisted(() => vi.fn());
const isNameLockHeldMock = vi.hoisted(() => vi.fn());
const releaseNameLockMock = vi.hoisted(() => vi.fn());
const buildUpdatePayloadMock = vi.hoisted(() => vi.fn());

vi.mock('$env/dynamic/private', () => ({ env }));
vi.mock('$lib/features/shelter-import', () => ({
	buildUpdatePayload: buildUpdatePayloadMock
}));
vi.mock('$lib/features/shelter-import/server/job-store', () => ({
	claimNextImportItem: claimMock,
	assertImportItemClaim: assertClaimMock,
	IMPORT_LEASE_MS: 300_000,
	listRunnableImportJobs: listJobsMock,
	MAX_IMPORT_ATTEMPTS: 3,
	recomputeImportJob: recomputeMock,
	renewImportItemClaim: renewClaimMock,
	resumePendingImportRetry: resumeRetryMock,
	updateImportItem: updateItemMock
}));
vi.mock('$lib/server/shelters.admin', () => ({
	findMasterByName: findByNameMock,
	nowIso: () => '2026-09-17T00:00:00.000Z',
	updateMaster: updateMasterMock
}));
vi.mock('$lib/features/shelters/server/provisioner', () => ({
	allocateShelterCode: allocateCodeMock,
	provisionShelter: provisionMock
}));
vi.mock('$lib/server/shelter-name-lock', () => ({
	acquireShelterNameLock: acquireNameLockMock,
	isShelterNameLockHeld: isNameLockHeldMock,
	releaseShelterNameLock: releaseNameLockMock
}));

import { POST } from './+server';

const input = { name: 'ศูนย์ A', capacity: 100 } as never;

function job(status: 'queued' | 'running' = 'queued') {
	return {
		_id: 'shelter_import_job:job-1',
		status,
		duplicate_action: 'skip'
	} as { _id: string; status: 'queued' | 'running'; duplicate_action: 'skip' | 'update' };
}

function item(overrides: Record<string, unknown> = {}) {
	return {
		_id: 'shelter_import_item:job-1:000001',
		name: 'ศูนย์ A',
		input,
		status: 'running',
		attempts: 1,
		max_attempts: 3,
		worker_id: 'worker-a',
		claim_token: 'claim-a',
		lease_until: new Date(Date.now() + 300_000).toISOString(),
		...overrides
	} as never;
}

function call(token = 'worker-secret') {
	const request = new Request('http://localhost/api/internal/shelter-import/worker/next', {
		method: 'POST',
		headers: {
			authorization: `Bearer ${token}`,
			'x-shelter-import-worker-id': 'worker-a'
		}
	});
	return POST({ request } as unknown as Parameters<typeof POST>[0]);
}

beforeEach(() => {
	env.SHELTER_IMPORT_WORKER_TOKEN = 'worker-secret';
	listJobsMock.mockReset().mockResolvedValue([job()]);
	claimMock.mockReset().mockResolvedValue(item());
	assertClaimMock.mockReset().mockResolvedValue(undefined);
	renewClaimMock.mockReset().mockImplementation(async (current) => current);
	recomputeMock.mockReset().mockResolvedValue(job());
	updateItemMock.mockReset().mockImplementation(async (current, patch) => ({
		...current,
		...patch,
		_rev: '2-item'
	}));
	resumeRetryMock.mockReset();
	findByNameMock.mockReset().mockResolvedValue(null);
	updateMasterMock.mockReset();
	buildUpdatePayloadMock.mockReset();
	allocateCodeMock.mockReset().mockResolvedValue('SH001');
	provisionMock
		.mockReset()
		.mockResolvedValue({ ok: true, code: 'SH001', db: 'shelter_sh001', steps: [] });
	acquireNameLockMock.mockReset().mockResolvedValue(true);
	isNameLockHeldMock.mockReset().mockResolvedValue(true);
	releaseNameLockMock.mockReset().mockResolvedValue(undefined);
});

describe('POST /api/internal/shelter-import/worker/next', () => {
	it('rejects requests without the private worker token', async () => {
		const response = await call('wrong-secret');

		expect(response.status).toBe(401);
		expect(listJobsMock).not.toHaveBeenCalled();
	});

	it('claims and provisions exactly one item', async () => {
		const response = await call();

		expect(response.status).toBe(200);
		expect(claimMock).toHaveBeenCalledTimes(1);
		expect(provisionMock).toHaveBeenCalledWith(
			input,
			'SH001',
			expect.objectContaining({
				assertActive: expect.any(Function)
			})
		);
		expect(updateItemMock).toHaveBeenCalledWith(
			expect.objectContaining({ _id: 'shelter_import_item:job-1:000001' }),
			expect.objectContaining({ status: 'created', code: 'SH001' })
		);
	});

	it('resumes a partial provision even when duplicate action is skip', async () => {
		const partial = item({ code: 'SH007' }) as { input: typeof input };
		claimMock.mockResolvedValue(partial);
		findByNameMock.mockResolvedValue({ code: 'SH007', name: 'ศูนย์ A' });

		const response = await call();

		expect(response.status).toBe(200);
		expect(provisionMock).toHaveBeenCalledWith(partial.input, 'SH007', expect.any(Object));
		expect(updateMasterMock).not.toHaveBeenCalled();
	});

	it('builds duplicate updates from the latest document supplied by the MVCC helper', async () => {
		listJobsMock.mockResolvedValue([{ ...job(), duplicate_action: 'update' }]);
		findByNameMock.mockResolvedValue({ code: 'SH009', name: 'ศูนย์ A' });
		buildUpdatePayloadMock.mockReturnValue({ capacity: 250 });
		const latest = { name: 'ศูนย์ A', capacity: 101 };
		updateMasterMock.mockImplementation(async (_code, mutator) => {
			const result = await mutator(latest);
			expect(buildUpdatePayloadMock).toHaveBeenCalledWith(input, latest);
			expect(result.patch).toEqual({ capacity: 250, updated_at: '2026-09-17T00:00:00.000Z' });
		});

		const response = await call();

		expect(response.status).toBe(200);
		expect(updateMasterMock).toHaveBeenCalledWith(
			'SH009',
			expect.any(Function),
			expect.objectContaining({ assertActive: expect.any(Function) })
		);
		expect(provisionMock).not.toHaveBeenCalled();
	});

	it('continues to the next job when an older job has only an active lease', async () => {
		const olderJob = { ...job('running'), _id: 'shelter_import_job:older' };
		const newerJob = { ...job(), _id: 'shelter_import_job:newer' };
		listJobsMock.mockResolvedValue([olderJob, newerJob]);
		claimMock.mockImplementation(async (jobId: string) =>
			jobId === 'older' ? null : item({ _id: 'shelter_import_item:newer:000001' })
		);
		recomputeMock.mockResolvedValue(olderJob);

		const response = await call();

		expect(response.status).toBe(200);
		expect(claimMock).toHaveBeenNthCalledWith(1, 'older', 'worker-a');
		expect(claimMock).toHaveBeenNthCalledWith(2, 'newer', 'worker-a');
		expect(provisionMock).toHaveBeenCalledTimes(1);
	});

	it('does not provision after lease renewal loses the claim', async () => {
		renewClaimMock.mockRejectedValueOnce(new Error('lease lost'));

		const response = await call();

		expect(response.status).toBe(200);
		expect(provisionMock).not.toHaveBeenCalled();
		expect(updateItemMock).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ status: 'failed' })
		);
	});
});
