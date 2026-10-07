import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireSystemAdminMock = vi.hoisted(() => vi.fn());
const getImportJobMock = vi.hoisted(() => vi.fn());
const toShelterImportItemSummaryMock = vi.hoisted(() =>
	vi.fn((item: Record<string, unknown>) => ({
		_id: item._id,
		_rev: item._rev,
		row: item.row,
		name: item.name,
		status: item.status,
		attempts: item.attempts,
		max_attempts: item.max_attempts
	}))
);

vi.mock('$lib/server/couch-admin', () => ({
	requireSystemAdmin: requireSystemAdminMock,
	serviceError: vi.fn()
}));
vi.mock('$lib/features/shelter-import/server/job-store', () => ({
	getImportJob: getImportJobMock,
	toShelterImportItemSummary: toShelterImportItemSummaryMock,
	toShelterImportJobSummary: (job: Record<string, unknown>) => {
		const copy = { ...job };
		delete copy.idempotency_key_hash;
		delete copy.request_fingerprint;
		return copy;
	}
}));

import { GET } from './+server';

function summary(itemRevision: string, status: 'pending' | 'running' = 'pending') {
	return {
		job: { _id: 'shelter_import_job:job-1', _rev: '5-job', status: 'running' },
		items: [
			{
				_id: 'shelter_import_item:job-1:000001',
				_rev: itemRevision,
				row: 1,
				name: 'ศูนย์ A',
				status,
				attempts: status === 'running' ? 1 : 0,
				max_attempts: 3,
				type: 'shelter_import_item',
				schema_v: 1,
				created_at: '2026-09-21T00:00:00.000Z',
				updated_at: '2026-09-21T00:00:00.000Z'
			}
		]
	};
}

async function call(ifNoneMatch?: string): Promise<Response> {
	const headers: Record<string, string> = {};
	if (ifNoneMatch) headers['if-none-match'] = ifNoneMatch;
	return GET({
		request: new Request('http://localhost/api/back-office/shelter-import/jobs/job-1', { headers }),
		params: { jobId: 'job-1' }
	} as unknown as Parameters<typeof GET>[0]);
}

beforeEach(() => {
	requireSystemAdminMock.mockReset().mockResolvedValue({
		name: 'admin',
		roles: ['system_admin'],
		isSA: true,
		shelterCode: null
	});
	getImportJobMock.mockReset().mockResolvedValue(summary('1-item'));
});

describe('GET /api/back-office/shelter-import/jobs/[jobId]', () => {
	it('changes ETag when only an item revision changes', async () => {
		const first = await call();
		const firstEtag = first.headers.get('etag');
		expect(first.status).toBe(200);
		expect(firstEtag).toBeTruthy();

		getImportJobMock.mockResolvedValue(summary('2-item', 'running'));
		const afterClaim = await call(firstEtag!);

		expect(afterClaim.status).toBe(200);
		expect(afterClaim.headers.get('etag')).not.toBe(firstEtag);
	});

	it('returns 304 when both job and item revisions are unchanged', async () => {
		const first = await call();
		const unchanged = await call(first.headers.get('etag')!);

		expect(unchanged.status).toBe(304);
	});

	it('does not return item payload or worker fencing fields', async () => {
		getImportJobMock.mockResolvedValueOnce({
			...summary('1-item'),
			items: [
				{
					...summary('1-item').items[0],
					input: { national_id: 'secret' },
					job_id: 'shelter_import_job:job-1',
					created_by: 'admin',
					lease_until: '2026-09-21T00:05:00.000Z',
					worker_id: 'worker-secret',
					claim_token: 'claim-secret'
				}
			]
		});

		const response = await call();
		const body = (await response.json()) as { items: Record<string, unknown>[] };

		expect(response.status).toBe(200);
		for (const field of [
			'input',
			'job_id',
			'created_by',
			'lease_until',
			'worker_id',
			'claim_token'
		]) {
			expect(body.items[0]).not.toHaveProperty(field);
		}
	});

	it('does not return server-only job metadata to browser (idempotency hash, fingerprint)', async () => {
		getImportJobMock.mockResolvedValueOnce({
			job: {
				...summary('1-item').job,
				idempotency_key_hash: 'secret-hash',
				request_fingerprint: 'secret-fingerprint'
			},
			items: summary('1-item').items
		});

		const response = await call();
		const body = (await response.json()) as { job: Record<string, unknown> };

		expect(response.status).toBe(200);
		expect(body.job).not.toHaveProperty('idempotency_key_hash');
		expect(body.job).not.toHaveProperty('request_fingerprint');
	});
});
