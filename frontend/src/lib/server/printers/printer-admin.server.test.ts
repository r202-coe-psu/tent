import { describe, expect, it } from 'vitest';
// eslint-disable-next-line no-restricted-imports -- server-safe domain schema; feature barrel pulls client UI/query code
import { printLabelSchema } from '$lib/features/printers/domain/print-job.schema';
import { PrinterOfflineError } from './print-jobs.server';
import { TEST_LABEL_PNG_BASE64 } from './test-label';
import { authenticatePrintDevice, type PrintDeviceDoc } from './device-credentials';
import type { PrintJobDoc } from './print-queue.server';
import {
	createPrinter,
	deletePrinter,
	listPrinters,
	PrintDeviceNotFoundError,
	queueTestPrint,
	rotatePrinterSecret,
	toPrinterSummary,
	updatePrinter,
	PrintDeviceConflictError,
	printDeviceInputSchema,
	printDevicePatchSchema,
	type PrintDeviceAdminStore,
	type PrintDeviceInput
} from './printer-admin.server';

const NOW = new Date('2026-10-22T03:00:00.000Z');

/** In-memory `printing` registry: the port we own, so a fake beats a mock. Enforces `_rev` like Couch. */
function fakeStore(seed: PrintDeviceDoc[] = []) {
	const docs = new Map(seed.map((doc) => [doc._id, doc]));
	const state: { beforeNextUpdate: (() => void) | null } = { beforeNextUpdate: null };
	const store: PrintDeviceAdminStore = {
		async createDevice(doc) {
			if (docs.has(doc._id)) return { conflict: true };
			docs.set(doc._id, { ...doc, _rev: '1-a' });
			return { ok: true, rev: '1-a' };
		},
		async getDevice(printerId) {
			const doc = docs.get(printerId);
			return doc ? structuredClone(doc) : null;
		},
		async updateDevice(doc) {
			state.beforeNextUpdate?.();
			state.beforeNextUpdate = null;
			if (docs.get(doc._id)?._rev !== doc._rev) return { conflict: true };
			const rev = `${Number(doc._rev?.split('-')[0] ?? 0) + 1}-x`;
			docs.set(doc._id, { ...doc, _rev: rev });
			return { ok: true, rev };
		},
		async deleteDevice(doc) {
			state.beforeNextUpdate?.();
			state.beforeNextUpdate = null;
			if (docs.get(doc._id)?._rev !== doc._rev) return { conflict: true };
			docs.delete(doc._id);
			return { ok: true };
		}
	};
	return { store, docs, state };
}

/** In-memory print jobs: just the find/put slice the admin use cases need. `pageSize` mimics a Mango limit. */
function fakeJobs(seed: PrintJobDoc[] = [], pageSize = Infinity) {
	const docs = new Map(seed.map((doc) => [doc._id, doc]));
	return {
		docs,
		findJobs: async ({ status, printerId: id }: { status: string; printerId?: string }) =>
			[...docs.values()]
				.filter((d) => d.status === status && (id === undefined || d.printer_id === id))
				.slice(0, pageSize),
		put: async (doc: PrintJobDoc) => {
			docs.set(doc._id, doc);
			return { ok: true as const, rev: 'x' };
		}
	};
}

/** Scanner registry slice: `kiosk-a` is in SH001, `kiosk-b` in SH002. */
const scanners = {
	async getDeviceByDeviceId(deviceId: string) {
		const shelters: Record<string, string> = { 'kiosk-a': 'SH001', 'kiosk-b': 'SH002' };
		return deviceId in shelters ? { shelter_code: shelters[deviceId] } : null;
	}
};

/** `createPrinter` deps over `store`; `events` records provisioning and the device write in order. */
function createDeps(store: PrintDeviceAdminStore, events: string[] = []) {
	return {
		store: {
			...store,
			createDevice: async (doc: PrintDeviceDoc) => {
				events.push('create');
				return store.createDevice(doc);
			}
		},
		scanners,
		ensureShelterDb: async (shelterCode: string) => void events.push(`ensure:${shelterCode}`)
	};
}

/** `updatePrinter` deps; `jobs` is the store of whichever shelter is asked for (see `shelters`). */
function updateDeps(
	store: PrintDeviceAdminStore,
	jobs: ReturnType<typeof fakeJobs>,
	shelters: string[] = []
) {
	return {
		devices: store,
		scanners,
		jobsFor: (shelterCode: string) => {
			shelters.push(shelterCode);
			return jobs;
		}
	};
}

const input: PrintDeviceInput = {
	device_id: 'printer-sh001-reg1',
	name: 'จุดลงทะเบียน 1',
	shelter_code: 'SH001',
	station: 'โต๊ะ 1',
	host_kind: 'standalone'
};

describe('createPrinter', () => {
	it('registers an active printer and returns its secret once, stored only as hash + prefix', async () => {
		const { store, docs } = fakeStore();

		const { device, secret } = await createPrinter(createDeps(store), input, 'sa-user', NOW);

		expect(secret).toMatch(/^sk_print_[0-9a-f]{64}$/);
		expect(device).toEqual({
			id: 'print_device:printer-sh001-reg1',
			device_id: 'printer-sh001-reg1',
			name: 'จุดลงทะเบียน 1',
			shelter_code: 'SH001',
			station: 'โต๊ะ 1',
			host_kind: 'standalone',
			kiosk_device_id: null,
			status: 'active',
			secret_prefix: secret.slice(0, 16),
			last_seen_at: null,
			queue_state: 'unknown',
			agent_version: null,
			local_ips: [],
			online: false
		});

		const stored = docs.get('print_device:printer-sh001-reg1');
		expect(JSON.stringify(stored)).not.toContain(secret);
		expect(stored).toMatchObject({
			type: 'print_device',
			schema_v: 1,
			status: 'active',
			last_seen_at: null,
			queue_state: 'unknown',
			agent_version: null,
			created_at: '2026-10-22T03:00:00.000Z',
			updated_at: '2026-10-22T03:00:00.000Z',
			created_by: 'sa-user',
			secret_prefix: secret.slice(0, 16)
		});
		await expect(
			authenticatePrintDevice('printer-sh001-reg1', secret, {
				getDeviceByDeviceId: async () => stored ?? null
			})
		).resolves.toMatchObject({ device_id: 'printer-sh001-reg1' });
	});

	it('rejects an existing device_id and leaves the stored printer untouched', async () => {
		const { store, docs } = fakeStore();
		const first = await createPrinter(createDeps(store), input, 'sa-user', NOW);
		const before = structuredClone(docs.get('print_device:printer-sh001-reg1'));

		await expect(
			createPrinter(createDeps(store), { ...input, name: 'ซ้ำ' }, 'other', NOW)
		).rejects.toBeInstanceOf(PrintDeviceConflictError);

		expect(docs.get('print_device:printer-sh001-reg1')).toEqual(before);
		expect(before?.secret_prefix).toBe(first.secret.slice(0, 16));
	});
});

function deviceDoc(overrides: Partial<PrintDeviceDoc>): PrintDeviceDoc {
	return {
		_id: 'print_device:printer-sh001-reg1',
		_rev: '3-c',
		type: 'print_device',
		schema_v: 1,
		device_id: 'printer-sh001-reg1',
		name: 'จุดลงทะเบียน 1',
		shelter_code: 'SH001',
		station: null,
		host_kind: 'standalone',
		secret_hash: 'a'.repeat(64),
		secret_prefix: 'sk_print_01234567',
		status: 'active',
		last_seen_at: '2026-10-22T02:59:50.000Z',
		queue_state: 'ready',
		agent_version: '0.1.0',
		created_at: '2026-10-22T00:00:00.000Z',
		updated_at: '2026-10-22T02:59:50.000Z',
		created_by: 'sa-user',
		...overrides
	};
}

function jobDoc(printerId: string, overrides: Partial<PrintJobDoc> = {}): PrintJobDoc {
	return {
		_id: 'print_job:01J',
		type: 'print_job',
		schema_v: 1,
		shelter_code: 'SH001',
		printer_id: printerId,
		status: 'failed',
		label_count: 1,
		source: 'walk_in',
		created_at: '2026-10-22T02:50:00.000Z',
		created_by: 'staff-a',
		expires_at: '2026-10-22T02:52:00.000Z',
		claimed_at: '2026-10-22T02:50:01.000Z',
		lease_until: null,
		finished_at: '2026-10-22T02:50:09.000Z',
		printed: 0,
		error_code: 'cups_error',
		...overrides
	};
}

describe('toPrinterSummary', () => {
	it('carries the LAN IPs the agent last reported', () => {
		const summary = toPrinterSummary(deviceDoc({ local_ips: ['192.168.1.50'] }), NOW);

		expect(summary.local_ips).toEqual(['192.168.1.50']);
	});

	it('reports no IPs for a device whose agent never sent any', () => {
		expect(toPrinterSummary(deviceDoc({}), NOW).local_ips).toEqual([]);
	});
});

describe('listPrinters', () => {
	it('lists printers in scope with online state and each last job, never the secret hash', async () => {
		const online = deviceDoc({});
		const offline = deviceDoc({
			_id: 'print_device:printer-sh002-a',
			device_id: 'printer-sh002-a',
			name: 'ก',
			shelter_code: 'SH002',
			last_seen_at: '2026-10-22T02:55:00.000Z'
		});
		let askedScope: string[] | null | undefined;

		const result = await listPrinters(
			{
				devices: {
					async listDevicesInScope(scope) {
						askedScope = scope;
						return [offline, online];
					}
				},
				jobsFor: () => ({
					async lastJobOf(printerId: string) {
						return printerId === online._id ? jobDoc(printerId, { _attachments: { x: 1 } }) : null;
					}
				})
			},
			['SH001', 'SH002'],
			NOW
		);

		expect(askedScope).toEqual(['SH001', 'SH002']);
		expect(result.server_time).toBe('2026-10-22T03:00:00.000Z');
		expect(result.printers.map((p) => [p.device_id, p.online, p.last_job])).toEqual([
			[
				'printer-sh001-reg1',
				true,
				{
					status: 'failed',
					finished_at: '2026-10-22T02:50:09.000Z',
					error_code: 'cups_error',
					created_at: '2026-10-22T02:50:00.000Z'
				}
			],
			['printer-sh002-a', false, null]
		]);
		expect(JSON.stringify(result)).not.toContain('secret_hash');
	});
});

describe('updatePrinter', () => {
	it('changes name, station and status, bumps updated_at and keeps the credentials', async () => {
		const original = deviceDoc({});
		const { store, docs } = fakeStore([original]);

		const summary = await updatePrinter(
			updateDeps(store, fakeJobs()),
			original._id,
			{ name: 'จุดลงทะเบียน 2', station: null, status: 'inactive' },
			NOW
		);

		expect(summary).toMatchObject({
			name: 'จุดลงทะเบียน 2',
			station: null,
			status: 'inactive',
			online: false
		});
		expect(docs.get(original._id)).toMatchObject({
			name: 'จุดลงทะเบียน 2',
			status: 'inactive',
			updated_at: '2026-10-22T03:00:00.000Z',
			secret_hash: original.secret_hash,
			last_seen_at: original.last_seen_at
		});
	});

	it('reports an unknown printer as not found', async () => {
		const { store } = fakeStore();

		await expect(
			updatePrinter(updateDeps(store, fakeJobs()), 'print_device:nope', { name: 'x' }, NOW)
		).rejects.toBeInstanceOf(PrintDeviceNotFoundError);
	});

	it('survives a heartbeat landing between read and write, without losing the heartbeat', async () => {
		const original = deviceDoc({});
		const { store, docs, state } = fakeStore([original]);
		state.beforeNextUpdate = () =>
			docs.set(original._id, {
				...original,
				_rev: '4-d',
				last_seen_at: '2026-10-22T02:59:59.000Z'
			});

		await updatePrinter(updateDeps(store, fakeJobs()), original._id, { name: 'ใหม่' }, NOW);

		expect(docs.get(original._id)).toMatchObject({
			name: 'ใหม่',
			last_seen_at: '2026-10-22T02:59:59.000Z'
		});
	});
	it('deactivating fails its pending and printing jobs without labels, after the device is inactive', async () => {
		const original = deviceDoc({});
		const { store, docs } = fakeStore([original]);
		const open = { finished_at: null, error_code: null, _attachments: { a: 1 } };
		const jobs = fakeJobs([
			jobDoc(original._id, { _id: 'print_job:P', status: 'pending', ...open }),
			jobDoc(original._id, { _id: 'print_job:R', status: 'printing', ...open }),
			jobDoc(original._id, { _id: 'print_job:D', status: 'printed', error_code: null }),
			jobDoc('print_device:other', { _id: 'print_job:O', status: 'pending', ...open })
		]);
		const deviceStatusAtJobWrite: string[] = [];
		const put = jobs.put;
		jobs.put = async (doc) => {
			deviceStatusAtJobWrite.push(docs.get(original._id)?.status ?? 'missing');
			return put(doc);
		};

		await updatePrinter(updateDeps(store, jobs), original._id, { status: 'inactive' }, NOW);

		for (const id of ['print_job:P', 'print_job:R']) {
			expect(jobs.docs.get(id)).toMatchObject({
				status: 'failed',
				error_code: 'printer_inactive',
				finished_at: '2026-10-22T03:00:00.000Z'
			});
			expect(jobs.docs.get(id)).not.toHaveProperty('_attachments');
		}
		expect(deviceStatusAtJobWrite).toEqual(['inactive', 'inactive']);
		expect(jobs.docs.get('print_job:D')).toMatchObject({ status: 'printed' });
		expect(jobs.docs.get('print_job:O')).toMatchObject({ status: 'pending' });
	});

	it('leaves open jobs alone on a rename or reactivation', async () => {
		const original = deviceDoc({});
		const { store } = fakeStore([original]);
		const jobs = fakeJobs([
			jobDoc(original._id, {
				_id: 'print_job:P',
				status: 'pending',
				finished_at: null,
				error_code: null
			})
		]);

		await updatePrinter(updateDeps(store, jobs), original._id, { name: 'ใหม่' }, NOW);
		await updatePrinter(updateDeps(store, jobs), original._id, { status: 'active' }, NOW);

		expect(jobs.docs.get('print_job:P')).toMatchObject({ status: 'pending' });
	});
});

describe('rotatePrinterSecret', () => {
	it('issues a new secret and the old one stops authenticating at once', async () => {
		const { store, docs } = fakeStore();
		const created = await createPrinter(createDeps(store), input, 'sa-user', NOW);
		const id = 'print_device:printer-sh001-reg1';
		const lookup = { getDeviceByDeviceId: async () => docs.get(id) ?? null };

		const rotated = await rotatePrinterSecret(store, id, new Date('2026-10-22T04:00:00.000Z'));

		expect(rotated.secret).toMatch(/^sk_print_[0-9a-f]{64}$/);
		expect(rotated.secret).not.toBe(created.secret);
		expect(rotated.device).toMatchObject({
			device_id: 'printer-sh001-reg1',
			secret_prefix: rotated.secret.slice(0, 16)
		});
		expect(JSON.stringify(docs.get(id))).not.toContain(rotated.secret);
		expect(docs.get(id)?.updated_at).toBe('2026-10-22T04:00:00.000Z');
		await expect(
			authenticatePrintDevice('printer-sh001-reg1', created.secret, lookup)
		).rejects.toMatchObject({ code: 'DEVICE_AUTH_FAILED' });
		await expect(
			authenticatePrintDevice('printer-sh001-reg1', rotated.secret, lookup)
		).resolves.toMatchObject({ device_id: 'printer-sh001-reg1' });
	});

	it('reports an unknown printer as not found', async () => {
		const { store } = fakeStore();

		await expect(rotatePrinterSecret(store, 'print_device:nope', NOW)).rejects.toBeInstanceOf(
			PrintDeviceNotFoundError
		);
	});
});

describe('queueTestPrint', () => {
	const printerId = 'print_device:printer-sh001-reg1';
	const manager = { name: 'sm-a', roles: ['shelter:SH001', 'SH001:shelter_manager'] };

	function testPrintDeps(devices: { getDevice: () => Promise<PrintDeviceDoc | null> }) {
		const created: PrintJobDoc[] = [];
		const storesBuiltFor: string[] = [];
		return {
			created,
			storesBuiltFor,
			deps: {
				devices,
				newId: () => 'JOB1',
				storeFor: (shelterCode: string) => {
					storesBuiltFor.push(shelterCode);
					return { createJob: async (doc: PrintJobDoc) => void created.push(doc) };
				}
			}
		};
	}

	it('queues a one-label test job carrying only the built-in label, written as the caller', async () => {
		const { deps, created, storesBuiltFor } = testPrintDeps({
			getDevice: async () => deviceDoc({})
		});

		const result = await queueTestPrint(deps, printerId, manager, NOW);

		expect(result).toEqual({
			job_id: 'JOB1',
			shelter_code: 'SH001',
			expires_at: '2026-10-22T03:02:00.000Z'
		});
		expect(storesBuiltFor).toEqual(['SH001']);
		expect(created).toHaveLength(1);
		expect(created[0]).toMatchObject({
			_id: 'print_job:JOB1',
			status: 'pending',
			source: 'test',
			label_count: 1,
			printer_id: printerId,
			shelter_code: 'SH001',
			created_by: 'sm-a'
		});
		expect(created[0]._attachments).toEqual({
			'label-000.png': { content_type: 'image/png', data: TEST_LABEL_PNG_BASE64 }
		});
		expect(printLabelSchema.safeParse(TEST_LABEL_PNG_BASE64).success).toBe(true);
	});

	it('refuses an offline printer and queues nothing', async () => {
		const { deps, created } = testPrintDeps({
			getDevice: async () => deviceDoc({ last_seen_at: '2026-10-22T02:55:00.000Z' })
		});

		await expect(queueTestPrint(deps, printerId, manager, NOW)).rejects.toBeInstanceOf(
			PrinterOfflineError
		);
		expect(created).toEqual([]);
	});

	it('refuses a caller who is not a shelter manager of the shelter, even if they can print', async () => {
		const { deps, created } = testPrintDeps({ getDevice: async () => deviceDoc({}) });

		await expect(
			queueTestPrint(
				deps,
				printerId,
				{ name: 'reg-a', roles: ['shelter:SH001', 'SH001:registration_staff'] },
				NOW
			)
		).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(created).toEqual([]);
	});
});

describe('deletePrinter', () => {
	const printerId = 'print_device:printer-sh001-reg1';

	it('fails its pending and printing jobs without labels, then removes the device', async () => {
		const { store, docs } = fakeStore([deviceDoc({})]);
		const jobs = fakeJobs([
			jobDoc(printerId, {
				_id: 'print_job:P',
				status: 'pending',
				finished_at: null,
				error_code: null,
				_attachments: { a: 1 }
			}),
			jobDoc(printerId, {
				_id: 'print_job:R',
				status: 'printing',
				finished_at: null,
				error_code: null,
				_attachments: { a: 1 }
			}),
			jobDoc(printerId, { _id: 'print_job:D', status: 'printed', error_code: null }),
			jobDoc('print_device:other', {
				_id: 'print_job:O',
				status: 'pending',
				finished_at: null,
				error_code: null,
				_attachments: { a: 1 }
			})
		]);
		const failedBeforeDelete: string[] = [];
		const deleteDevice = store.deleteDevice;
		store.deleteDevice = async (doc) => {
			for (const job of jobs.docs.values())
				if (job.status === 'failed') failedBeforeDelete.push(job._id);
			return deleteDevice(doc);
		};

		await deletePrinter({ devices: store, jobsFor: () => jobs }, printerId, NOW);

		expect(docs.has(printerId)).toBe(false);
		for (const id of ['print_job:P', 'print_job:R']) {
			expect(jobs.docs.get(id)).toMatchObject({
				status: 'failed',
				error_code: 'printer_deleted',
				finished_at: '2026-10-22T03:00:00.000Z'
			});
			expect(jobs.docs.get(id)).not.toHaveProperty('_attachments');
		}
		expect(failedBeforeDelete).toEqual(expect.arrayContaining(['print_job:P', 'print_job:R']));
		expect(jobs.docs.get('print_job:D')).toMatchObject({ status: 'printed', error_code: null });
		expect(jobs.docs.get('print_job:O')).toMatchObject({ status: 'pending' });
	});

	it('fails every open job, not just the first page of the query', async () => {
		const { store } = fakeStore([deviceDoc({})]);
		const open = Array.from({ length: 5 }, (_, i) =>
			jobDoc(printerId, {
				_id: `print_job:P${i}`,
				status: 'pending',
				finished_at: null,
				error_code: null
			})
		);
		const jobs = fakeJobs(open, 2);

		await deletePrinter({ devices: store, jobsFor: () => jobs }, printerId, NOW);

		expect([...jobs.docs.values()].map((job) => job.status)).toEqual(Array(5).fill('failed'));
	});

	it('reports an unknown printer as not found', async () => {
		const { store } = fakeStore();

		await expect(
			deletePrinter({ devices: store, jobsFor: () => fakeJobs([]) }, printerId, NOW)
		).rejects.toBeInstanceOf(PrintDeviceNotFoundError);
	});

	it('survives a heartbeat landing between read and delete', async () => {
		const original = deviceDoc({});
		const { store, docs, state } = fakeStore([original]);
		state.beforeNextUpdate = () => docs.set(original._id, { ...original, _rev: '4-d' });

		await deletePrinter({ devices: store, jobsFor: () => fakeJobs([]) }, printerId, NOW);

		expect(docs.has(printerId)).toBe(false);
	});
});

describe('printDeviceInputSchema kiosk link', () => {
	const parse = (override: object) => printDeviceInputSchema.safeParse({ ...input, ...override });

	it('accepts a kiosk printer with the scanner device it sits in', () => {
		const result = parse({ host_kind: 'kiosk', kiosk_device_id: 'kiosk-a' });

		expect(result.success && result.data.kiosk_device_id).toBe('kiosk-a');
	});

	it('accepts a kiosk printer without a link yet, and a plain standalone printer', () => {
		expect(parse({ host_kind: 'kiosk' }).success).toBe(true);
		expect(parse({ host_kind: 'standalone' }).success).toBe(true);
	});

	it('rejects a kiosk_device_id on a standalone printer', () => {
		const result = parse({ host_kind: 'standalone', kiosk_device_id: 'kiosk-a' });

		expect(result.success).toBe(false);
		expect(!result.success && result.error.issues[0]?.message).toBe(
			'kiosk_device_id requires host_kind "kiosk"'
		);
	});
});

describe('printDevicePatchSchema kiosk link', () => {
	it('accepts linking a scanner device or clearing the link', () => {
		expect(printDevicePatchSchema.safeParse({ kiosk_device_id: 'kiosk-a' }).success).toBe(true);
		expect(printDevicePatchSchema.safeParse({ kiosk_device_id: null }).success).toBe(true);
	});
});

describe('createPrinter kiosk link and provisioning', () => {
	const kioskInput: PrintDeviceInput = {
		...input,
		device_id: 'printer-sh001-kiosk-a',
		host_kind: 'kiosk',
		kiosk_device_id: 'kiosk-a'
	};

	it('links a kiosk printer to the scanner device of the same shelter', async () => {
		const { store, docs } = fakeStore();

		const { device } = await createPrinter(createDeps(store), kioskInput, 'sa-user', NOW);

		expect(device).toMatchObject({ host_kind: 'kiosk', kiosk_device_id: 'kiosk-a' });
		expect(docs.get('print_device:printer-sh001-kiosk-a')).toMatchObject({
			kiosk_device_id: 'kiosk-a'
		});
	});

	it('stores no link for a standalone printer', async () => {
		const { store, docs } = fakeStore();

		const { device } = await createPrinter(createDeps(store), input, 'sa-user', NOW);

		expect(device.kiosk_device_id).toBeNull();
		expect(docs.get('print_device:printer-sh001-reg1')).toMatchObject({ kiosk_device_id: null });
	});

	it.each([
		['does not exist', 'kiosk-zzz'],
		['belongs to another shelter', 'kiosk-b']
	])('rejects a scanner device that %s, writing and provisioning nothing', async (_n, id) => {
		const { store, docs } = fakeStore();
		const events: string[] = [];

		await expect(
			createPrinter(createDeps(store, events), { ...kioskInput, kiosk_device_id: id }, 'sa', NOW)
		).rejects.toMatchObject({
			name: 'PrintDeviceValidationError',
			code: 'KIOSK_DEVICE_NOT_FOUND'
		});
		expect(events).toEqual([]);
		expect(docs.size).toBe(0);
	});

	it('provisions the shelter printing DB before the device is written (FR-4)', async () => {
		const { store } = fakeStore();
		const events: string[] = [];

		await createPrinter(createDeps(store, events), input, 'sa-user', NOW);

		expect(events).toEqual(['ensure:SH001', 'create']);
	});

	it('writes no device when provisioning the shelter DB fails', async () => {
		const { store, docs } = fakeStore();
		const deps = createDeps(store);
		deps.ensureShelterDb = async () => {
			throw new Error('couch down');
		};

		await expect(createPrinter(deps, input, 'sa-user', NOW)).rejects.toThrow('couch down');
		expect(docs.size).toBe(0);
	});
});

describe('toPrinterSummary kiosk link', () => {
	it('carries the linked scanner device, and null for a device written before the link existed', () => {
		expect(toPrinterSummary(deviceDoc({ kiosk_device_id: 'kiosk-a' }), NOW).kiosk_device_id).toBe(
			'kiosk-a'
		);
		expect(toPrinterSummary(deviceDoc({}), NOW).kiosk_device_id).toBeNull();
	});
});

describe('per-shelter job stores', () => {
	const sh2 = deviceDoc({
		_id: 'print_device:printer-sh002-a',
		device_id: 'printer-sh002-a',
		shelter_code: 'SH002'
	});

	it('listPrinters reads each printer last job from its own shelter store', async () => {
		const asked: string[] = [];
		await listPrinters(
			{
				devices: { listDevicesInScope: async () => [deviceDoc({}), sh2] },
				jobsFor: (shelterCode) => ({
					async lastJobOf() {
						asked.push(shelterCode);
						return null;
					}
				})
			},
			null,
			NOW
		);

		expect(asked.sort()).toEqual(['SH001', 'SH002']);
	});

	it('deactivating closes jobs in the store of the printer shelter', async () => {
		const { store } = fakeStore([sh2]);
		const shelters: string[] = [];

		await updatePrinter(
			updateDeps(store, fakeJobs(), shelters),
			sh2._id,
			{ status: 'inactive' },
			NOW
		);

		expect(shelters).toEqual(['SH002']);
	});

	it('deleting closes jobs in the store of the printer shelter', async () => {
		const { store } = fakeStore([sh2]);
		const shelters: string[] = [];

		await deletePrinter(
			{
				devices: store,
				jobsFor: (shelterCode) => {
					shelters.push(shelterCode);
					return fakeJobs();
				}
			},
			sh2._id,
			NOW
		);

		expect(shelters).toEqual(['SH002']);
	});
});

describe('updatePrinter kiosk link', () => {
	const kiosk = () =>
		deviceDoc({ host_kind: 'kiosk', kiosk_device_id: null, shelter_code: 'SH001' });

	it('links a kiosk printer to a scanner device of its shelter, and clears the link', async () => {
		const original = kiosk();
		const { store, docs } = fakeStore([original]);

		await updatePrinter(
			updateDeps(store, fakeJobs()),
			original._id,
			{ kiosk_device_id: 'kiosk-a' },
			NOW
		);
		expect(docs.get(original._id)).toMatchObject({ kiosk_device_id: 'kiosk-a' });

		await updatePrinter(
			updateDeps(store, fakeJobs()),
			original._id,
			{ kiosk_device_id: null },
			NOW
		);
		expect(docs.get(original._id)).toMatchObject({ kiosk_device_id: null });
	});

	it.each([
		['a scanner device of another shelter', kiosk(), 'kiosk-b', 'KIOSK_DEVICE_NOT_FOUND'],
		['an unknown scanner device', kiosk(), 'kiosk-zzz', 'KIOSK_DEVICE_NOT_FOUND'],
		[
			'a standalone printer',
			deviceDoc({ host_kind: 'standalone' }),
			'kiosk-a',
			'KIOSK_DEVICE_REQUIRES_KIOSK_HOST'
		]
	])('rejects linking %s and changes nothing', async (_n, original, id, code) => {
		const { store, docs } = fakeStore([original]);

		await expect(
			updatePrinter(updateDeps(store, fakeJobs()), original._id, { kiosk_device_id: id }, NOW)
		).rejects.toMatchObject({ code });
		expect(docs.get(original._id)).toEqual(original);
	});
});
