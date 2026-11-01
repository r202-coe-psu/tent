import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const adminRaw = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/couch-admin', () => ({ adminRaw }));

import { PrintDependencyError } from './device-credentials';
import {
	ensurePrintingDevicesDb,
	ensureShelterPrintingDb,
	resetPrintingProvisionForTests
} from './printing-provision';
import { buildPrintingValidateDocUpdate } from './printing-vdu';

interface Call {
	method: string;
	path: string;
	body: unknown;
}

type Responder = (call: Call) => { status: number; data?: unknown } | undefined;

let calls: Call[];

/** Fake CouchDB: happy-path answers, with per-test overrides taking precedence. */
function fakeCouch(override: Responder = () => undefined) {
	adminRaw.mockImplementation((path: string, method: string, body?: unknown) => {
		const call = { method, path, body };
		calls.push(call);
		const answer = override(call) ?? happyPath(call);
		return Promise.resolve({ status: answer.status, data: answer.data ?? { ok: true } });
	});
}

function happyPath({ method, path }: Call): { status: number; data?: unknown } {
	if (method === 'PUT' && /^\/[a-z_0-9]+$/.test(path)) return { status: 201 };
	if (method === 'GET' && path.includes('/_design/')) return { status: 404, data: { error: 'x' } };
	if (method === 'PUT' && path.includes('/_design/')) return { status: 201 };
	if (method === 'PUT' && path.includes('/_security')) return { status: 200 };
	if (method === 'PUT' && path.includes('/_revs_limit')) return { status: 200 };
	if (method === 'POST' && path.endsWith('/_index')) return { status: 200 };
	if (method === 'PUT') return { status: 201 };
	return { status: 500 };
}

const requests = () => calls.map(({ method, path }) => `${method} ${path}`);
const bodyOf = (method: string, path: string) =>
	calls.find((c) => c.method === method && c.path === path)?.body;
const indexesOf = (db: string) =>
	calls
		.filter((c) => c.method === 'POST' && c.path === `/${db}/_index`)
		.map((c) => c.body as { index: { fields: string[] }; name: string; type: string });

beforeEach(() => {
	calls = [];
	adminRaw.mockReset();
	resetPrintingProvisionForTests();
	fakeCouch();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('ensurePrintingDevicesDb', () => {
	it('creates the db, locks it to printing_service, keeps few revisions and indexes devices', async () => {
		await ensurePrintingDevicesDb();

		expect(requests()).toEqual([
			'PUT /printing_devices',
			'PUT /printing_devices/_security',
			'PUT /printing_devices/_revs_limit',
			'POST /printing_devices/_index',
			'POST /printing_devices/_index'
		]);
		expect(bodyOf('PUT', '/printing_devices/_security')).toEqual({
			admins: { names: ['printing_service'], roles: [] },
			members: { names: ['printing_service'], roles: [] }
		});
		expect(bodyOf('PUT', '/printing_devices/_revs_limit')).toBe(10);
		expect(indexesOf('printing_devices')).toEqual([
			{ index: { fields: ['type', 'shelter_code'] }, name: 'print-device-shelter', type: 'json' },
			{ index: { fields: ['type'] }, name: 'print-doc-type', type: 'json' }
		]);
	});

	it('treats an already existing db (412) as success', async () => {
		fakeCouch(({ method, path }) =>
			method === 'PUT' && path === '/printing_devices' ? { status: 412 } : undefined
		);
		await expect(ensurePrintingDevicesDb()).resolves.toBeUndefined();
		expect(requests()).toContain('PUT /printing_devices/_security');
	});

	it('does not talk to CouchDB again after it succeeded', async () => {
		await ensurePrintingDevicesDb();
		calls.length = 0;
		await ensurePrintingDevicesDb();
		expect(calls).toEqual([]);
	});

	it('shares one provisioning run between concurrent callers', async () => {
		await Promise.all([ensurePrintingDevicesDb(), ensurePrintingDevicesDb()]);
		expect(requests().filter((r) => r === 'PUT /printing_devices')).toHaveLength(1);
	});

	it('fails with PrintDependencyError when CouchDB refuses, and retries on the next call', async () => {
		fakeCouch(({ method, path }) =>
			method === 'PUT' && path === '/printing_devices/_security' ? { status: 500 } : undefined
		);
		await expect(ensurePrintingDevicesDb()).rejects.toBeInstanceOf(PrintDependencyError);

		calls.length = 0;
		fakeCouch();
		await expect(ensurePrintingDevicesDb()).resolves.toBeUndefined();
		expect(requests()[0]).toBe('PUT /printing_devices');
	});
});

describe('ensureShelterPrintingDb', () => {
	const NOW = '2026-11-01T08:00:00.000Z';

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(NOW));
	});

	it('provisions the shelter db, then the devices db, then the registry doc', async () => {
		await ensureShelterPrintingDb('SH001');

		expect(requests()).toEqual([
			'PUT /printing_sh001',
			'PUT /printing_sh001/_security',
			'PUT /printing_sh001/_revs_limit',
			'GET /printing_sh001/_design/print_access',
			'PUT /printing_sh001/_design/print_access',
			'POST /printing_sh001/_index',
			'POST /printing_sh001/_index',
			'POST /printing_sh001/_index',
			'POST /printing_sh001/_index',
			'POST /printing_sh001/_index',
			'PUT /printing_devices',
			'PUT /printing_devices/_security',
			'PUT /printing_devices/_revs_limit',
			'POST /printing_devices/_index',
			'POST /printing_devices/_index',
			'PUT /printing_devices/printing_db%3ASH001'
		]);
	});

	it('grants only printing_service and the shelter roles on the shelter db', async () => {
		await ensureShelterPrintingDb('SH001');
		expect(bodyOf('PUT', '/printing_sh001/_security')).toEqual({
			admins: { names: ['printing_service'], roles: [] },
			members: { names: ['printing_service'], roles: ['shelter:SH001', 'system_admin'] }
		});
	});

	it('keeps 100 revisions on the shelter db', async () => {
		await ensureShelterPrintingDb('SH001');
		expect(bodyOf('PUT', '/printing_sh001/_revs_limit')).toBe(100);
	});

	it('normalises a lower-case code to the upper-case shelter role and registry doc', async () => {
		await ensureShelterPrintingDb('sh001');
		expect(bodyOf('PUT', '/printing_sh001/_security')).toMatchObject({
			members: { roles: ['shelter:SH001', 'system_admin'] }
		});
		expect(bodyOf('PUT', '/printing_devices/printing_db%3ASH001')).toEqual({
			_id: 'printing_db:SH001',
			type: 'printing_db',
			schema_v: 1,
			shelter_code: 'SH001',
			created_at: NOW
		});
	});

	it('installs the print_access validate_doc_update', async () => {
		await ensureShelterPrintingDb('SH001');
		expect(bodyOf('PUT', '/printing_sh001/_design/print_access')).toEqual({
			language: 'javascript',
			validate_doc_update: buildPrintingValidateDocUpdate()
		});
	});

	it('creates the five job indexes', async () => {
		await ensureShelterPrintingDb('SH001');
		expect(indexesOf('printing_sh001')).toEqual([
			{
				index: { fields: ['printer_id', 'status', 'created_at'] },
				name: 'print-job-printer-status-created',
				type: 'json'
			},
			{
				index: { fields: ['printer_id', 'created_at'] },
				name: 'print-job-printer-created',
				type: 'json'
			},
			{
				index: { fields: ['status', 'finished_at'] },
				name: 'print-job-status-finished',
				type: 'json'
			},
			{
				index: { fields: ['status', 'lease_until'] },
				name: 'print-job-status-lease',
				type: 'json'
			},
			{
				index: { fields: ['status', 'expires_at'] },
				name: 'print-job-status-expires',
				type: 'json'
			}
		]);
	});

	it('leaves an up-to-date design doc alone', async () => {
		fakeCouch(({ method, path }) =>
			method === 'GET' && path === '/printing_sh001/_design/print_access'
				? {
						status: 200,
						data: {
							_id: '_design/print_access',
							_rev: '3-abc',
							language: 'javascript',
							validate_doc_update: buildPrintingValidateDocUpdate()
						}
					}
				: undefined
		);
		await ensureShelterPrintingDb('SH001');
		expect(requests()).not.toContain('PUT /printing_sh001/_design/print_access');
	});

	it('rewrites a stale design doc with its current rev', async () => {
		fakeCouch(({ method, path }) =>
			method === 'GET' && path === '/printing_sh001/_design/print_access'
				? {
						status: 200,
						data: {
							_id: '_design/print_access',
							_rev: '3-abc',
							language: 'javascript',
							validate_doc_update: 'function () {}'
						}
					}
				: undefined
		);
		await ensureShelterPrintingDb('SH001');
		expect(bodyOf('PUT', '/printing_sh001/_design/print_access')).toEqual({
			_rev: '3-abc',
			language: 'javascript',
			validate_doc_update: buildPrintingValidateDocUpdate()
		});
	});

	it('is idempotent: existing dbs (412) and an existing registry doc (409) are success', async () => {
		fakeCouch(({ method, path }) => {
			if (method === 'PUT' && (path === '/printing_sh001' || path === '/printing_devices'))
				return { status: 412 };
			if (method === 'PUT' && path === '/printing_devices/printing_db%3ASH001')
				return { status: 409 };
			return undefined;
		});
		await expect(ensureShelterPrintingDb('SH001')).resolves.toBeUndefined();
	});

	it.each(['', 'SH-001', 'sh 001', '../x', 'devices'])(
		'rejects invalid code %j before any request',
		async (code) => {
			await expect(ensureShelterPrintingDb(code)).rejects.toThrow();
			expect(adminRaw).not.toHaveBeenCalled();
		}
	);

	it('does not talk to CouchDB again for a code it already provisioned', async () => {
		await ensureShelterPrintingDb('SH001');
		calls.length = 0;
		await ensureShelterPrintingDb('sh001');
		expect(calls).toEqual([]);
	});

	it('provisions another shelter on its own but reuses the devices db', async () => {
		await ensureShelterPrintingDb('SH001');
		calls.length = 0;
		await ensureShelterPrintingDb('SH002');
		expect(requests()).toContain('PUT /printing_sh002');
		expect(requests()).not.toContain('PUT /printing_devices');
		expect(requests()).toContain('PUT /printing_devices/printing_db%3ASH002');
	});

	it('fails with PrintDependencyError when CouchDB refuses, and retries on the next call', async () => {
		fakeCouch(({ method, path }) =>
			method === 'PUT' && path === '/printing_sh001/_security' ? { status: 500 } : undefined
		);
		await expect(ensureShelterPrintingDb('SH001')).rejects.toBeInstanceOf(PrintDependencyError);

		calls.length = 0;
		fakeCouch();
		await expect(ensureShelterPrintingDb('SH001')).resolves.toBeUndefined();
		expect(requests()[0]).toBe('PUT /printing_sh001');
	});

	it('does not register the shelter when its db could not be provisioned', async () => {
		fakeCouch(({ method, path }) =>
			method === 'PUT' && path === '/printing_sh001/_design/print_access'
				? { status: 500 }
				: undefined
		);
		await expect(ensureShelterPrintingDb('SH001')).rejects.toBeInstanceOf(PrintDependencyError);
		expect(requests().some((r) => r.includes('printing_db'))).toBe(false);
	});
});
