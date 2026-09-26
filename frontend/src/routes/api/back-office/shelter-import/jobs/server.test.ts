import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ SHELTER_IMPORT_WORKER_TOKEN: 'worker-secret' }));
const requireSystemAdminMock = vi.hoisted(() => vi.fn());
const createImportJobMock = vi.hoisted(() => vi.fn());
const safeParseMock = vi.hoisted(() => vi.fn());

vi.mock('$env/dynamic/private', () => ({ env }));
vi.mock('$lib/server/couch-admin', () => ({
	requireSystemAdmin: requireSystemAdminMock,
	serviceError: (error: unknown) =>
		new Response(JSON.stringify({ error: { code: 'INTERNAL', message: String(error) } }), {
			status: 500,
			headers: { 'content-type': 'application/json' }
		})
}));
vi.mock('$lib/features/shelters/server', () => ({
	createShelterSchema: { safeParse: safeParseMock }
}));
vi.mock('$lib/features/shelter-import/server/job-store', () => ({
	MAX_IMPORT_ROWS: 1000,
	createImportJob: createImportJobMock
}));

import { POST } from './+server';

function request(body: string, idempotencyKey = 'import-key-1'): Request {
	return new Request('http://localhost/api/back-office/shelter-import/jobs', {
		method: 'POST',
		headers: {
			cookie: 'session=admin',
			'content-type': 'application/json',
			'Idempotency-Key': idempotencyKey
		},
		body
	});
}

beforeEach(() => {
	env.SHELTER_IMPORT_WORKER_TOKEN = 'worker-secret';
	requireSystemAdminMock.mockReset().mockResolvedValue({
		name: 'admin',
		roles: ['system_admin'],
		isSA: true,
		shelterCode: null
	});
	createImportJobMock.mockReset().mockResolvedValue({ _id: 'shelter_import_job:key-hash' });
	safeParseMock.mockReset().mockImplementation((value) => ({
		success: true,
		data: { ...value, name: 'validated name' }
	}));
});

describe('POST /api/back-office/shelter-import/jobs', () => {
	it('passes the idempotency key and server-derived row metadata to the job store', async () => {
		const response = await POST({
			request: request(
				JSON.stringify({
					filename: 'shelters.xlsx',
					duplicate_action: 'skip',
					rows: [
						{
							row: 1,
							name: 'client-forged name',
							shelter: { name: 'client payload name', capacity: 100 }
						}
					]
				})
			)
		} as unknown as Parameters<typeof POST>[0]);

		expect(response.status).toBe(202);
		expect(createImportJobMock).toHaveBeenCalledWith({
			filename: 'shelters.xlsx',
			importedBy: 'admin',
			idempotencyKey: 'import-key-1',
			duplicateAction: 'skip',
			rows: [
				expect.objectContaining({
					row: 1,
					name: 'validated name',
					input: { name: 'validated name', capacity: 100 },
					valid: true
				})
			]
		});
	});

	it.each([
		['app system admin', ['system_admin']],
		['CouchDB server admin', ['_admin']]
	])('allows %s sessions through the server gate', async (_label, roles) => {
		requireSystemAdminMock.mockResolvedValueOnce({
			name: 'admin',
			roles,
			isSA: true,
			shelterCode: null
		});

		const response = await POST({
			request: request(
				JSON.stringify({
					filename: 'shelters.xlsx',
					duplicate_action: 'skip',
					rows: [{ row: 1, name: 'ศูนย์ A', shelter: { name: 'ศูนย์ A', capacity: 100 } }]
				})
			)
		} as unknown as Parameters<typeof POST>[0]);

		expect(response.status).toBe(202);
		expect(requireSystemAdminMock).toHaveBeenCalledWith('session=admin');
	});

	it('returns 422 for malformed JSON instead of a generic server error', async () => {
		const response = await POST({
			request: request('{not-json}')
		} as unknown as Parameters<typeof POST>[0]);

		expect(response.status).toBe(422);
		expect(createImportJobMock).not.toHaveBeenCalled();
	});

	it('rejects an oversized body while reading a chunked request', async () => {
		const response = await POST({
			request: request('x'.repeat(5 * 1024 * 1024 + 1))
		} as unknown as Parameters<typeof POST>[0]);

		expect(response.status).toBe(413);
		expect(createImportJobMock).not.toHaveBeenCalled();
	});
});
