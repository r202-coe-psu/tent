import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ SHELTER_IMPORT_WORKER_TOKEN: 'worker-secret' }));
const requireSystemAdminMock = vi.hoisted(() => vi.fn());
const createImportJobMock = vi.hoisted(() => vi.fn());
const safeParseMock = vi.hoisted(() => vi.fn());
const readMasterDocMock = vi.hoisted(() => vi.fn());

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
vi.mock('$lib/server/master-data-server', () => ({ readMasterDoc: readMasterDocMock }));
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
		data: { site_kind: 'evacuation_center', ...value, name: 'validated name' }
	}));
	readMasterDocMock.mockReset().mockResolvedValue({
		items: [
			{ code: 'evacuation_center', status: 'active' },
			{ code: 'field_hospital', status: 'inactive' }
		]
	});
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
					input: { site_kind: 'evacuation_center', name: 'validated name', capacity: 100 },
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

	async function postSiteKind(siteKind: string) {
		await POST({
			request: request(
				JSON.stringify({
					filename: 'shelters.xlsx',
					duplicate_action: 'skip',
					rows: [{ row: 1, name: 'ศูนย์ A', shelter: { name: 'ศูนย์ A', site_kind: siteKind } }]
				})
			)
		} as unknown as Parameters<typeof POST>[0]);
		return createImportJobMock.mock.calls[0][0].rows[0];
	}

	it('rejects a row whose site_kind is not in the master (CR-198 FR-7)', async () => {
		const row = await postSiteKind('made_up_kind');
		expect(row).toMatchObject({
			valid: false,
			errors: [expect.objectContaining({ column: 'site_kind' })]
		});
		expect(row.input).toBeUndefined();
	});

	it('lets an inactive site_kind through for the worker to judge against the stored shelter (FR-8)', async () => {
		const row = await postSiteKind('field_hospital');
		expect(row.valid).toBe(true);
		expect(row.errors).toBeUndefined();
		expect(row.input).toMatchObject({ site_kind: 'field_hospital' });
	});

	it('passes site_kind_blank through only for rows that left the cell empty (CR-198 D-4)', async () => {
		await POST({
			request: request(
				JSON.stringify({
					filename: 'shelters.xlsx',
					duplicate_action: 'update',
					rows: [
						{ row: 1, name: 'ศูนย์ A', shelter: { name: 'ศูนย์ A' }, site_kind_blank: true },
						{ row: 2, name: 'ศูนย์ B', shelter: { name: 'ศูนย์ B', site_kind: 'host_house' } }
					]
				})
			)
		} as unknown as Parameters<typeof POST>[0]);
		const [{ rows }] = createImportJobMock.mock.calls[0];
		expect(rows[0]).toMatchObject({ site_kind_blank: true });
		expect(rows[1]).not.toHaveProperty('site_kind_blank');
	});

	it('rejects a closed shelter row even when the client sent no row errors (CR-183 FR-23)', async () => {
		const response = await POST({
			request: request(
				JSON.stringify({
					filename: 'shelters.xlsx',
					duplicate_action: 'skip',
					rows: [
						{
							row: 1,
							name: 'ศูนย์ปิด',
							shelter: { name: 'ศูนย์ปิด', capacity: 100, operation_status: 'closed' }
						}
					]
				})
			)
		} as unknown as Parameters<typeof POST>[0]);

		expect(response.status).toBe(202);
		const [{ rows }] = createImportJobMock.mock.calls[0];
		expect(rows[0]).toMatchObject({ valid: false });
		expect(rows[0].input).toBeUndefined();
		expect(rows[0].errors).toContainEqual(expect.objectContaining({ column: 'operation_status' }));
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
