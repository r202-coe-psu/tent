import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireSystemAdminMock = vi.hoisted(() => vi.fn());
const listImportLogsMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/couch-admin', () => ({
	requireSystemAdmin: requireSystemAdminMock,
	serviceError: vi.fn()
}));
vi.mock('$lib/features/shelter-import/server/job-store', () => ({
	listImportLogs: listImportLogsMock
}));

import { GET } from './+server';

const log = {
	_id: 'shelter_import_log:01JLOG',
	_rev: '2-secret-revision',
	type: 'shelter_import_log',
	schema_v: 3,
	created_at: '2026-09-21T00:00:00.000Z',
	updated_at: '2026-09-21T00:00:00.000Z',
	created_by: 'sa',
	job_id: 'shelter_import_job:01JJOB',
	attempt: 1,
	source: 'shelter',
	filename: 'shelters.xlsx',
	imported_by: 'sa',
	total_rows: 1,
	success_count: 1,
	updated_count: 0,
	skipped_count: 0,
	error_count: 0,
	results: [],
	started_at: '2026-09-21T00:00:00.000Z',
	finished_at: '2026-09-21T00:01:00.000Z'
};

const projectedLog = {
	_id: log._id,
	type: log.type,
	schema_v: log.schema_v,
	created_at: log.created_at,
	updated_at: log.updated_at,
	created_by: log.created_by,
	job_id: log.job_id,
	attempt: log.attempt,
	source: log.source,
	filename: log.filename,
	imported_by: log.imported_by,
	total_rows: log.total_rows,
	success_count: log.success_count,
	updated_count: log.updated_count,
	skipped_count: log.skipped_count,
	error_count: log.error_count,
	results: log.results,
	started_at: log.started_at,
	finished_at: log.finished_at
};

beforeEach(() => {
	requireSystemAdminMock.mockReset().mockResolvedValue({
		name: 'sa',
		roles: ['system_admin'],
		isSA: true,
		shelterCode: null
	});
	listImportLogsMock.mockReset().mockResolvedValue([log]);
});

describe('GET /api/back-office/shelter-import/logs', () => {
	it.each([
		['app system admin', ['system_admin']],
		['CouchDB server admin', ['_admin']]
	])('returns the projected history for %s', async (_label, roles) => {
		requireSystemAdminMock.mockResolvedValueOnce({
			name: 'sa',
			roles,
			isSA: true,
			shelterCode: null
		});

		const response = await GET({
			request: new Request('http://localhost/api/back-office/shelter-import/logs', {
				headers: { cookie: 'session=sa' }
			})
		} as unknown as Parameters<typeof GET>[0]);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual([projectedLog]);
		expect(requireSystemAdminMock).toHaveBeenCalledWith('session=sa');
	});
});
