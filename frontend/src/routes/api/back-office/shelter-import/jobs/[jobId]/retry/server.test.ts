import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireSystemAdminMock = vi.hoisted(() => vi.fn());
const retryFailedImportItemsMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/couch-admin', () => ({
	requireSystemAdmin: requireSystemAdminMock,
	serviceError: vi.fn()
}));
vi.mock('$lib/features/shelter-import/server/job-store', () => ({
	retryFailedImportItems: retryFailedImportItemsMock
}));

import { POST } from './+server';

beforeEach(() => {
	requireSystemAdminMock.mockReset().mockResolvedValue({
		name: 'sa',
		roles: ['system_admin'],
		isSA: true,
		shelterCode: null
	});
	retryFailedImportItemsMock
		.mockReset()
		.mockResolvedValue({ job: { status: 'queued' }, items: [] });
});

describe('POST /api/back-office/shelter-import/jobs/[jobId]/retry', () => {
	it.each([
		['app system admin', ['system_admin']],
		['CouchDB server admin', ['_admin']]
	])('allows %s', async (_label, roles) => {
		requireSystemAdminMock.mockResolvedValueOnce({
			name: 'sa',
			roles,
			isSA: true,
			shelterCode: null
		});

		const response = await POST({
			request: new Request('http://localhost/api/back-office/shelter-import/jobs/job-1', {
				method: 'POST',
				headers: { cookie: 'session=sa' }
			}),
			params: { jobId: 'job-1' }
		} as unknown as Parameters<typeof POST>[0]);

		expect(response.status).toBe(202);
		expect(retryFailedImportItemsMock).toHaveBeenCalledWith('job-1');
	});
});
