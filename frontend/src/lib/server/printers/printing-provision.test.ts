import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const adminRaw = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/couch-admin', () => ({ adminRaw }));
const requirePrintingServiceName = vi.hoisted(() => vi.fn<() => string>());
vi.mock('$lib/server/couch-printing-service', () => ({ requirePrintingServiceName }));
const findMasterByCode = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/shelters.admin', () => ({ findMasterByCode }));

import { PrintDependencyError } from './device-credentials';
import type { PrintDeviceDoc } from './device-credentials';
import type { PrintJobDoc } from './print-queue.server';
import {
	closeShelterPrinting,
	ensurePrintingDevicesDb,
	ensureShelterPrintingDb,
	isShelterOpenForPrinting,
	reprovisionShelterPrintingDb,
	resetPrintingProvisionForTests,
	type CloseShelterPrintingDeps
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
	requirePrintingServiceName.mockReset();
	requirePrintingServiceName.mockReturnValue('printing_service');
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

	it('grants the configured service user name instead of printing_service', async () => {
		requirePrintingServiceName.mockReturnValue('print_bot');
		await ensurePrintingDevicesDb();
		expect(bodyOf('PUT', '/printing_devices/_security')).toEqual({
			admins: { names: ['print_bot'], roles: [] },
			members: { names: ['print_bot'], roles: [] }
		});
	});

	it('fails closed without writing anything when the service user name is unknown', async () => {
		requirePrintingServiceName.mockImplementation(() => {
			throw new PrintDependencyError('COUCHDB_PRINTING_SERVICE_URL is missing');
		});
		await expect(ensurePrintingDevicesDb()).rejects.toBeInstanceOf(PrintDependencyError);
		expect(adminRaw).not.toHaveBeenCalled();
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

	it('grants the configured service user name, in _security and in the VDU', async () => {
		requirePrintingServiceName.mockReturnValue('print_bot');
		await ensureShelterPrintingDb('SH001');
		expect(bodyOf('PUT', '/printing_sh001/_security')).toEqual({
			admins: { names: ['print_bot'], roles: [] },
			members: { names: ['print_bot'], roles: ['shelter:SH001', 'system_admin'] }
		});
		expect(bodyOf('PUT', '/printing_sh001/_design/print_access')).toEqual({
			language: 'javascript',
			validate_doc_update: buildPrintingValidateDocUpdate('print_bot')
		});
	});

	it('rewrites a design doc that still names the old service user, so a renamed user gets a new VDU', async () => {
		requirePrintingServiceName.mockReturnValue('print_bot');
		fakeCouch(({ method, path }) =>
			method === 'GET' && path === '/printing_sh001/_design/print_access'
				? {
						status: 200,
						data: {
							_id: '_design/print_access',
							_rev: '3-abc',
							language: 'javascript',
							validate_doc_update: buildPrintingValidateDocUpdate('printing_service')
						}
					}
				: undefined
		);
		await ensureShelterPrintingDb('SH001');
		expect(bodyOf('PUT', '/printing_sh001/_design/print_access')).toEqual({
			_rev: '3-abc',
			language: 'javascript',
			validate_doc_update: buildPrintingValidateDocUpdate('print_bot')
		});
	});

	it('fails closed without writing anything when the service user name is unknown, and retries later', async () => {
		requirePrintingServiceName.mockImplementation(() => {
			throw new PrintDependencyError('COUCHDB_PRINTING_SERVICE_URL is missing');
		});
		await expect(ensureShelterPrintingDb('SH001')).rejects.toBeInstanceOf(PrintDependencyError);
		expect(adminRaw).not.toHaveBeenCalled();

		requirePrintingServiceName.mockReturnValue('printing_service');
		await expect(ensureShelterPrintingDb('SH001')).resolves.toBeUndefined();
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
			validate_doc_update: buildPrintingValidateDocUpdate('printing_service')
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
							validate_doc_update: buildPrintingValidateDocUpdate('printing_service')
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
			validate_doc_update: buildPrintingValidateDocUpdate('printing_service')
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

	it('reprovisioning ignores the memo, so a database dropped by another process is recreated', async () => {
		await ensureShelterPrintingDb('SH001');
		calls.length = 0;

		await reprovisionShelterPrintingDb('sh001');

		expect(requests()[0]).toBe('PUT /printing_sh001');
		expect(requests()).toContain('PUT /printing_devices/printing_db%3ASH001');
		calls.length = 0;
		// ...and the fresh result is memoized again.
		await ensureShelterPrintingDb('SH001');
		expect(calls).toEqual([]);
	});

	it('reprovisioning does not memoize a failure', async () => {
		await ensureShelterPrintingDb('SH001');
		fakeCouch(({ method, path }) =>
			method === 'PUT' && path === '/printing_sh001' ? { status: 500 } : undefined
		);

		await expect(reprovisionShelterPrintingDb('SH001')).rejects.toBeInstanceOf(
			PrintDependencyError
		);
		fakeCouch();
		calls.length = 0;
		await ensureShelterPrintingDb('SH001');
		expect(requests()[0]).toBe('PUT /printing_sh001');
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

describe('closeShelterPrinting', () => {
	const NOW = new Date('2026-10-31T03:00:00.000Z');

	function deviceDoc(deviceId: string, overrides: Partial<PrintDeviceDoc> = {}): PrintDeviceDoc {
		return {
			_id: `print_device:${deviceId}`,
			_rev: '1-a',
			type: 'print_device',
			schema_v: 1,
			device_id: deviceId,
			name: deviceId,
			shelter_code: 'SH001',
			station: null,
			secret_hash: 'h',
			secret_prefix: 'sk_print_aaaaaaaa',
			status: 'active',
			last_seen_at: null,
			queue_state: 'unknown',
			agent_version: null,
			created_at: '2026-10-01T00:00:00.000Z',
			updated_at: '2026-10-01T00:00:00.000Z',
			created_by: 'sa',
			...overrides
		};
	}

	function pendingJob(id: string, printerId: string): PrintJobDoc {
		return {
			_id: id,
			_rev: '1-j',
			type: 'print_job',
			schema_v: 1,
			shelter_code: 'SH001',
			printer_id: printerId,
			status: 'pending',
			label_count: 1,
			source: 'walk_in',
			created_at: '2026-10-31T02:59:00.000Z',
			created_by: 'staff',
			expires_at: '2026-10-31T03:01:00.000Z',
			claimed_at: null,
			lease_until: null,
			finished_at: null,
			printed: 0,
			error_code: null
		};
	}

	/** Fakes for the two ports `updatePrinter` needs; every write is also recorded in `events`. */
	function fakeShelter(devices: PrintDeviceDoc[], jobs: PrintJobDoc[], events: string[]) {
		const deviceDocs = new Map(devices.map((d) => [d._id, d]));
		const jobDocs = new Map(jobs.map((j) => [j._id, j]));
		const deps: CloseShelterPrintingDeps = {
			now: () => NOW,
			devices: {
				async listDevices(code) {
					return [...deviceDocs.values()].filter((d) => d.shelter_code === code);
				},
				async getDevice(id) {
					return structuredClone(deviceDocs.get(id) ?? null);
				},
				async updateDevice(doc) {
					events.push(`device ${doc._id} -> ${doc.status}`);
					deviceDocs.set(doc._id, { ...doc, _rev: '2-b' });
					return { ok: true, rev: '2-b' };
				},
				async createDevice() {
					throw new Error('unused');
				},
				async deleteDevice() {
					throw new Error('unused');
				}
			},
			jobsFor: () => ({
				async findJobs({ status, printerId }) {
					return [...jobDocs.values()].filter(
						(j) => j.status === status && j.printer_id === printerId
					);
				},
				async put(doc) {
					events.push(`job ${doc._id} -> ${doc.status} (${doc.error_code})`);
					jobDocs.set(doc._id, { ...doc, _rev: '2-j' });
					return { ok: true, rev: '2-j' };
				}
			})
		};
		return { deps, deviceDocs, jobDocs };
	}

	it('deactivates the shelter printers and fails their open jobs before deleting the db and its registry doc', async () => {
		const events: string[] = [];
		fakeCouch((call) => {
			if (call.method === 'GET' && call.path === '/printing_devices/printing_db%3ASH001')
				return { status: 200, data: { _id: 'printing_db:SH001', _rev: '3-r' } };
			if (call.method === 'DELETE') {
				events.push(`${call.method} ${call.path}`);
				return { status: 200 };
			}
			return undefined;
		});
		const { deps } = fakeShelter(
			[deviceDoc('pi-a'), deviceDoc('pi-b', { shelter_code: 'SH002' })],
			[pendingJob('print_job:1', 'print_device:pi-a')],
			events
		);

		await closeShelterPrinting('SH001', deps);

		expect(events).toEqual([
			'device print_device:pi-a -> inactive',
			'job print_job:1 -> failed (printer_inactive)',
			'DELETE /printing_sh001',
			'DELETE /printing_devices/printing_db%3ASH001?rev=3-r'
		]);
	});

	it('is a no-op on a rerun: a db and registry doc that are already gone (404) are fine', async () => {
		const events: string[] = [];
		fakeCouch(({ method }) =>
			method === 'DELETE' || method === 'GET' ? { status: 404 } : undefined
		);
		const { deps } = fakeShelter([], [], events);

		await expect(closeShelterPrinting('SH001', deps)).resolves.toMatchObject({
			db: 'printing_sh001',
			registryId: 'printing_db:SH001',
			printerIds: []
		});
		expect(requests()).toEqual([
			'DELETE /printing_sh001',
			'GET /printing_devices/printing_db%3ASH001'
		]);
	});

	it('still fails open jobs of printers that were already inactive', async () => {
		const events: string[] = [];
		fakeCouch(({ method }) =>
			method === 'DELETE' || method === 'GET' ? { status: 404 } : undefined
		);
		const { deps } = fakeShelter(
			[deviceDoc('pi-a', { status: 'inactive' })],
			[pendingJob('print_job:1', 'print_device:pi-a')],
			events
		);

		await closeShelterPrinting('SH001', deps);

		expect(events).toContain('job print_job:1 -> failed (printer_inactive)');
	});

	it('deletes nothing when a printer cannot be deactivated', async () => {
		const events: string[] = [];
		fakeCouch();
		const { deps } = fakeShelter([deviceDoc('pi-a')], [], events);
		deps.devices.updateDevice = async () => {
			throw new PrintDependencyError();
		};

		await expect(closeShelterPrinting('SH001', deps)).rejects.toBeInstanceOf(PrintDependencyError);
		expect(requests()).toEqual([]);
	});

	it('throws for an invalid shelter code before any request', async () => {
		fakeCouch();
		const { deps } = fakeShelter([], [], []);

		await expect(closeShelterPrinting('../_users', deps)).rejects.toThrow(/Invalid shelter code/);
		expect(requests()).toEqual([]);
	});

	it('lets the shelter be provisioned again after it was closed', async () => {
		await ensureShelterPrintingDb('SH001');
		fakeCouch(({ method }) =>
			method === 'DELETE' || method === 'GET' ? { status: 404 } : undefined
		);
		await closeShelterPrinting('SH001', fakeShelter([], [], []).deps);
		calls.length = 0;
		fakeCouch();

		await ensureShelterPrintingDb('SH001');

		expect(requests()[0]).toBe('PUT /printing_sh001');
	});
});

describe('isShelterOpenForPrinting', () => {
	it.each([
		[{ code: 'SH001', operation_status: 'open' }, true],
		[{ code: 'SH001', operation_status: 'preparing' }, true],
		[{ code: 'SH001', operation_status: 'closed' }, false],
		[{ code: 'SH001', operation_status: 'cancelled' }, false],
		[{ code: 'SH001', status: 'closed' }, false],
		[null, false]
	])('registry doc %j → %s', async (master, open) => {
		findMasterByCode.mockResolvedValue(master);

		expect(await isShelterOpenForPrinting('sh001')).toBe(open);
		expect(findMasterByCode).toHaveBeenCalledWith('SH001');
	});
});
