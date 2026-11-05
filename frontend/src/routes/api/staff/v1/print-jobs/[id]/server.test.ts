import { beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';
import { GET } from './+server';
import type { RequestEvent } from './$types';
import { requireShelterScopeOrSA } from '$lib/server/session-auth';
import { CouchUserError } from '$lib/server/couch-as-user';
import { userJobStore } from '$lib/server/printers/print-job.user-store';
import type { PrintJobDoc } from '$lib/server/printers/print-queue.server';

vi.mock('$lib/server/session-auth', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/session-auth')>(
		'$lib/server/session-auth'
	);
	return { ...actual, requireShelterScopeOrSA: vi.fn() };
});

vi.mock('$lib/server/printers/print-job.user-store', () => ({ userJobStore: vi.fn() }));

describe('GET /api/staff/v1/print-jobs/[id]', () => {
	const mockAuth = vi.mocked(requireShelterScopeOrSA);
	const mockUserJobStore = vi.mocked(userJobStore);
	const mockGet = vi.fn();

	const job: PrintJobDoc = {
		_id: 'print_job:01JB0000000000000000000009',
		_rev: '2-x',
		type: 'print_job',
		schema_v: 1,
		shelter_code: 'SH001',
		printer_id: 'print_device:printer-sh001-reg1',
		status: 'failed',
		label_count: 3,
		source: 'walk_in',
		created_at: '2026-10-22T03:00:00.000Z',
		created_by: 'staff-a',
		expires_at: '2026-10-22T03:02:00.000Z',
		claimed_at: '2026-10-22T03:00:05.000Z',
		lease_until: null,
		finished_at: '2026-10-22T03:00:20.000Z',
		printed: 1,
		error_code: 'printer_error'
	};

	beforeEach(() => {
		vi.clearAllMocks();
		mockAuth.mockResolvedValue({
			name: 'staff-a',
			roles: ['shelter:SH001'],
			isSA: false,
			shelterCode: 'SH001'
		});
		mockGet.mockReset();
		mockGet.mockImplementation(async (id: string) => (id === job._id ? job : null));
		mockUserJobStore.mockReturnValue({ createJob: vi.fn(), get: mockGet });
	});

	async function get(id: string, query = '?shelter_code=SH001'): Promise<Response> {
		const url = new URL(`http://localhost/api/staff/v1/print-jobs/${id}${query}`);
		return GET({
			params: { id },
			url,
			request: new Request(url, { headers: { cookie: 'AuthSession=staff-a' } })
		} as unknown as RequestEvent);
	}

	it('returns the job status to the staff member who created it', async () => {
		const response = await get('01JB0000000000000000000009');

		expect(response.status).toBe(200);
		expect(mockAuth).toHaveBeenCalledWith('AuthSession=staff-a', 'SH001');
		expect(mockUserJobStore).toHaveBeenCalledWith('AuthSession=staff-a', 'SH001');
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toEqual({
			status: 'failed',
			printed: 1,
			label_count: 3,
			error_code: 'printer_error'
		});
	});

	it('answers 403 FORBIDDEN when another staff member asks', async () => {
		mockAuth.mockResolvedValue({
			name: 'staff-b',
			roles: ['shelter:SH001'],
			isSA: false,
			shelterCode: 'SH001'
		});

		const response = await get('01JB0000000000000000000009');

		expect(response.status).toBe(403);
		expect((await response.json()).error.code).toBe('FORBIDDEN');
	});

	it('lets an SA read any job', async () => {
		mockAuth.mockResolvedValue({
			name: 'sa-user',
			roles: ['_admin'],
			isSA: true,
			shelterCode: null
		});

		const response = await get('01JB0000000000000000000009');

		expect(response.status).toBe(200);
	});

	it('answers 404 JOB_NOT_FOUND for a missing job', async () => {
		const response = await get('01JB0000000000000000000000');

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({
			error: { code: 'JOB_NOT_FOUND', message: 'Print job not found' }
		});
	});

	it('answers 401 UNAUTHENTICATED for an anonymous caller', async () => {
		mockAuth.mockImplementation(async () => error(401, 'Authentication required'));

		const response = await get('01JB0000000000000000000009');

		expect(response.status).toBe(401);
		expect((await response.json()).error.code).toBe('UNAUTHENTICATED');
	});

	it.each([
		['missing', ''],
		['empty', '?shelter_code='],
		['not a shelter code', '?shelter_code=../printing_devices']
	])('answers 422 VALIDATION when shelter_code is %s', async (_name, query) => {
		const response = await get('01JB0000000000000000000009', query);

		expect(response.status).toBe(422);
		expect((await response.json()).error.code).toBe('VALIDATION');
		expect(mockUserJobStore).not.toHaveBeenCalled();
	});

	it("answers 403 FORBIDDEN for a shelter outside the caller's scope without reading", async () => {
		mockAuth.mockImplementation(async (_cookie, code) => error(403, `Caller not in "${code}"`));

		const response = await get('01JB0000000000000000000009', '?shelter_code=SH002');

		expect(response.status).toBe(403);
		expect(mockUserJobStore).not.toHaveBeenCalled();
	});

	it('answers 403 FORBIDDEN when CouchDB refuses the caller session', async () => {
		mockGet.mockRejectedValue(new CouchUserError('FORBIDDEN', 'Not permitted', 'secret reason'));

		const response = await get('01JB0000000000000000000009');

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			error: { code: 'FORBIDDEN', message: 'Not permitted' }
		});
	});
});
