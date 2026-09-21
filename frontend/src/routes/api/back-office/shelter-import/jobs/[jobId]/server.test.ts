import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireSystemAdminMock = vi.hoisted(() => vi.fn());
const getImportJobMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/couch-admin', () => ({
	requireSystemAdmin: requireSystemAdminMock,
	serviceError: vi.fn()
}));
vi.mock('$lib/features/shelter-import/server/job-store', () => ({
	getImportJob: getImportJobMock
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
				max_attempts: 3
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
});
