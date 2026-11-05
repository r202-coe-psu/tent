import { describe, expect, it } from 'vitest';
import {
	createPrintJob,
	getPrintJobStatus,
	PrintJobForbiddenError,
	PrintJobNotFoundError,
	listShelterPrinters,
	PrinterNotFoundError,
	PrinterOfflineError,
	PrintJobConflictError,
	PrintJobIdConflictError,
	type PrintJobCreator,
	type PrintDeviceReader
} from './print-jobs.server';
import {
	PrintDependencyError,
	PrintShelterDbMissingError,
	type PrintDeviceDoc
} from './device-credentials';
import type { PrintJobDoc } from './print-queue.server';

// 8 PNG magic bytes + 00 00 00 0D, and the same with a different tail.
const LABEL_A = 'iVBORw0KGgoAAAAN';
const LABEL_B = 'iVBORw0KGgoAAAAO';

const device: PrintDeviceDoc = {
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
	created_by: 'sa-user'
};

function setup(printer: PrintDeviceDoc = device) {
	const created: PrintJobDoc[] = [];
	const storesBuiltFor: string[] = [];
	const devices: PrintDeviceReader = {
		async getDevice(printerId) {
			return printerId === printer._id ? printer : null;
		}
	};
	const caller = { name: 'staff-a', roles: ['shelter:SH001', 'SH001:registration_staff'] };
	return {
		created,
		storesBuiltFor,
		caller,
		deps: {
			storeFor(shelterCode: string): PrintJobCreator {
				storesBuiltFor.push(shelterCode);
				return {
					async createJob(doc) {
						created.push(doc);
					}
				};
			},
			devices,
			newId: () => '01JB0000000000000000000009'
		}
	};
}

describe('createPrintJob', () => {
	it('stores a pending job with its labels attached for an online printer', async () => {
		const { deps, caller, created, storesBuiltFor } = setup();

		const result = await createPrintJob(
			deps,
			caller,
			{ printer_id: device._id, source: 'walk_in', labels: [LABEL_A, LABEL_B] },
			new Date('2026-10-22T03:00:00.000Z')
		);

		expect(result).toEqual({
			job_id: '01JB0000000000000000000009',
			shelter_code: 'SH001',
			expires_at: '2026-10-22T03:02:00.000Z'
		});
		expect(storesBuiltFor).toEqual(['SH001']);
		expect(created).toEqual([
			{
				_id: 'print_job:01JB0000000000000000000009',
				type: 'print_job',
				schema_v: 1,
				shelter_code: 'SH001',
				printer_id: 'print_device:printer-sh001-reg1',
				status: 'pending',
				label_count: 2,
				source: 'walk_in',
				created_at: '2026-10-22T03:00:00.000Z',
				created_by: 'staff-a',
				expires_at: '2026-10-22T03:02:00.000Z',
				claimed_at: null,
				lease_until: null,
				finished_at: null,
				printed: 0,
				error_code: null,
				_attachments: {
					'label-000.png': { content_type: 'image/png', data: LABEL_A },
					'label-001.png': { content_type: 'image/png', data: LABEL_B }
				}
			}
		]);
	});

	describe('with a client-minted job id', () => {
		const clientId = '01JC0000000000000000000001';
		const input = {
			job_id: clientId,
			printer_id: device._id,
			source: 'walk_in' as const,
			labels: [LABEL_A]
		};
		const now = new Date('2026-10-22T03:00:00.000Z');

		it('uses it as the doc id instead of minting one', async () => {
			const { deps, caller, created } = setup();

			const result = await createPrintJob(deps, caller, input, now);

			expect(result.job_id).toBe(clientId);
			expect(created[0]._id).toBe(`print_job:${clientId}`);
		});

		function existingDoc(over: Partial<PrintJobDoc> = {}): PrintJobDoc {
			return {
				_id: `print_job:${clientId}`,
				type: 'print_job',
				schema_v: 1,
				shelter_code: 'SH001',
				printer_id: device._id,
				status: 'printing',
				label_count: 1,
				source: 'walk_in',
				created_at: '2026-10-22T02:59:58.000Z',
				created_by: 'staff-a',
				expires_at: '2026-10-22T03:01:58.000Z',
				claimed_at: null,
				lease_until: null,
				finished_at: null,
				printed: 0,
				error_code: null,
				...over
			};
		}

		function conflictingStore(existing: PrintJobDoc | null): PrintJobCreator {
			return {
				async createJob() {
					throw new PrintJobConflictError();
				},
				async get() {
					return existing;
				}
			};
		}

		it('answers a retry of an already written job with that job (idempotent create)', async () => {
			const { deps, caller } = setup();
			deps.storeFor = () => conflictingStore(existingDoc());

			const result = await createPrintJob(deps, caller, input, now);

			expect(result).toEqual({
				job_id: clientId,
				shelter_code: 'SH001',
				expires_at: '2026-10-22T03:01:58.000Z'
			});
		});

		it.each([
			['another staff member', { created_by: 'staff-b' }],
			['another printer', { printer_id: 'print_device:other' }],
			['another shelter', { shelter_code: 'SH002' }],
			['another source', { source: 'evacuee_qr' as const }],
			['another label count', { label_count: 2 }]
		])('refuses to hand back a job that belongs to %s', async (_name, over) => {
			const { deps, caller } = setup();
			deps.storeFor = () => conflictingStore(existingDoc(over));

			await expect(createPrintJob(deps, caller, input, now)).rejects.toBeInstanceOf(
				PrintJobIdConflictError
			);
		});

		it('fails as a dependency error when the conflicting job cannot be read back', async () => {
			const { deps, caller } = setup();
			deps.storeFor = () => conflictingStore(null);

			await expect(createPrintJob(deps, caller, input, now)).rejects.toBeInstanceOf(
				PrintDependencyError
			);
		});
	});

	describe('when the shelter print DB is missing (dropped by another process)', () => {
		const label = { printer_id: device._id, source: 'walk_in' as const, labels: [LABEL_A] };
		const now = new Date('2026-10-22T03:00:00.000Z');

		it('reprovisions the DB once and retries the write', async () => {
			const { deps, caller, created } = setup();
			const events: string[] = [];
			let attempts = 0;
			const storeFor = deps.storeFor;
			deps.storeFor = (code) => {
				const store = storeFor(code);
				return {
					async createJob(doc) {
						attempts += 1;
						events.push(`create:${attempts}`);
						if (attempts === 1) throw new PrintShelterDbMissingError();
						await store.createJob(doc);
					}
				};
			};

			const result = await createPrintJob(
				{
					...deps,
					reprovisionShelterDb: async (code) => void events.push(`reprovision:${code}`)
				},
				caller,
				label,
				now
			);

			expect(events).toEqual(['create:1', 'reprovision:SH001', 'create:2']);
			expect(created).toHaveLength(1);
			expect(result.job_id).toBe('01JB0000000000000000000009');
		});

		it('does not reprovision when the printer was deactivated between the read and the write', async () => {
			const { deps, caller, created } = setup();
			let current: PrintDeviceDoc | null = device;
			deps.devices = { getDevice: async () => current };
			let reprovisions = 0;
			deps.storeFor = () => ({
				async createJob() {
					// Shelter closed while the request was in flight: the printer goes inactive, DB is gone.
					current = { ...device, status: 'inactive' };
					throw new PrintShelterDbMissingError();
				}
			});

			await expect(
				createPrintJob(
					{ ...deps, reprovisionShelterDb: async () => void (reprovisions += 1) },
					caller,
					label,
					now
				)
			).rejects.toBeInstanceOf(PrinterNotFoundError);
			expect(reprovisions).toBe(0);
			expect(created).toHaveLength(0);
		});

		it('gives up after one retry when the DB is still missing', async () => {
			const { deps, caller } = setup();
			let reprovisions = 0;
			let attempts = 0;
			deps.storeFor = () => ({
				async createJob() {
					attempts += 1;
					throw new PrintShelterDbMissingError();
				}
			});

			await expect(
				createPrintJob(
					{ ...deps, reprovisionShelterDb: async () => void (reprovisions += 1) },
					caller,
					label,
					now
				)
			).rejects.toBeInstanceOf(PrintShelterDbMissingError);
			expect(attempts).toBe(2);
			expect(reprovisions).toBe(1);
		});

		it('rethrows without a reprovision hook', async () => {
			const { deps, caller } = setup();
			deps.storeFor = () => ({
				async createJob() {
					throw new PrintShelterDbMissingError();
				}
			});

			await expect(createPrintJob(deps, caller, label, now)).rejects.toBeInstanceOf(
				PrintShelterDbMissingError
			);
		});
	});

	it('rejects an offline printer and stores no job', async () => {
		const { deps, caller, created } = setup({
			...device,
			last_seen_at: '2026-10-22T02:58:00.000Z' // 120 s ago, window is 90 s
		});

		await expect(
			createPrintJob(
				deps,
				caller,
				{ printer_id: device._id, source: 'walk_in', labels: [LABEL_A] },
				new Date('2026-10-22T03:00:00.000Z')
			)
		).rejects.toBeInstanceOf(PrinterOfflineError);
		expect(created).toEqual([]);
	});

	it('treats an inactive printer as not found', async () => {
		const { deps, caller, created } = setup({ ...device, status: 'inactive' });

		await expect(
			createPrintJob(
				deps,
				caller,
				{ printer_id: device._id, source: 'walk_in', labels: [LABEL_A] },
				new Date('2026-10-22T03:00:00.000Z')
			)
		).rejects.toBeInstanceOf(PrinterNotFoundError);
		expect(created).toEqual([]);
	});

	it.each([
		['a role that may not print this source', ['shelter:SH001', 'SH001:kitchen_staff']],
		['a role of another shelter', ['shelter:SH002', 'SH002:registration_staff']],
		['a shelter scope without a capability', ['shelter:SH001']]
	])('forbids %s and stores no job', async (_name, roles) => {
		const { deps, created, storesBuiltFor } = setup();

		await expect(
			createPrintJob(
				deps,
				{ name: 'staff-b', roles },
				{ printer_id: device._id, source: 'walk_in', labels: [LABEL_A] },
				new Date('2026-10-22T03:00:00.000Z')
			)
		).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(created).toEqual([]);
		expect(storesBuiltFor).toEqual([]);
	});

	it('lets a system admin print on any shelter', async () => {
		const { deps, created } = setup();

		await createPrintJob(
			deps,
			{ name: 'sa-user', roles: ['system_admin'] },
			{ printer_id: device._id, source: 'walk_in', labels: [LABEL_A] },
			new Date('2026-10-22T03:00:00.000Z')
		);

		expect(created).toHaveLength(1);
		expect(created[0].created_by).toBe('sa-user');
	});

	it('only a shelter manager or SA may queue a test print', async () => {
		const { deps } = setup();
		const input = { printer_id: device._id, source: 'test' as const, labels: [LABEL_A] };
		const at = new Date('2026-10-22T03:00:00.000Z');

		await expect(
			createPrintJob(
				deps,
				{ name: 'reg', roles: ['shelter:SH001', 'SH001:registration_staff'] },
				input,
				at
			)
		).rejects.toMatchObject({ code: 'FORBIDDEN' });
		await expect(
			createPrintJob(
				deps,
				{ name: 'sm', roles: ['shelter:SH001', 'SH001:shelter_manager'] },
				input,
				at
			)
		).resolves.toMatchObject({ shelter_code: 'SH001' });
	});
});

const job: PrintJobDoc = {
	_id: 'print_job:01JB0000000000000000000009',
	_rev: '2-x',
	type: 'print_job',
	schema_v: 1,
	shelter_code: 'SH001',
	printer_id: device._id,
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

const jobStore = {
	async get(id: string) {
		return id === job._id ? job : null;
	}
};

describe('getPrintJobStatus', () => {
	it('lets the creator read the status of their job', async () => {
		const status = await getPrintJobStatus(
			jobStore,
			{ name: 'staff-a', isSA: false },
			'01JB0000000000000000000009'
		);

		expect(status).toEqual({
			status: 'failed',
			printed: 1,
			label_count: 3,
			error_code: 'printer_error'
		});
	});

	it('forbids another staff member from reading the job', async () => {
		await expect(
			getPrintJobStatus(jobStore, { name: 'staff-b', isSA: false }, '01JB0000000000000000000009')
		).rejects.toBeInstanceOf(PrintJobForbiddenError);
	});

	it('lets an SA read any job', async () => {
		const status = await getPrintJobStatus(
			jobStore,
			{ name: 'sa-user', isSA: true },
			'01JB0000000000000000000009'
		);

		expect(status.status).toBe('failed');
	});

	it('reports a missing job as not found', async () => {
		await expect(
			getPrintJobStatus(jobStore, { name: 'staff-a', isSA: false }, '01JB0000000000000000000000')
		).rejects.toBeInstanceOf(PrintJobNotFoundError);
	});
});

describe('listShelterPrinters', () => {
	const dev = (device_id: string, overrides: Partial<PrintDeviceDoc>): PrintDeviceDoc => ({
		...device,
		_id: `print_device:${device_id}`,
		device_id,
		...overrides
	});
	const now = new Date('2026-10-22T03:00:00.000Z');

	it('lists active printers of the shelter by name with online state and no secrets', async () => {
		const devices = {
			async listDevices() {
				return [
					dev('reg2', {
						name: 'Reg 2',
						station: 'desk-2',
						last_seen_at: '2026-10-22T02:50:00.000Z'
					}),
					dev('retired', { name: 'Aaa retired', status: 'inactive' }),
					dev('reg1', { name: 'Reg 1', station: null }),
					dev('other', { name: 'Aaa other shelter', shelter_code: 'SH002' })
				];
			}
		};

		const result = await listShelterPrinters(devices, 'SH001', now);

		expect(result).toEqual([
			{
				id: 'print_device:reg1',
				name: 'Reg 1',
				station: null,
				online: true,
				queue_state: 'ready',
				last_seen_at: '2026-10-22T02:59:50.000Z'
			},
			{
				id: 'print_device:reg2',
				name: 'Reg 2',
				station: 'desk-2',
				online: false,
				queue_state: 'ready',
				last_seen_at: '2026-10-22T02:50:00.000Z'
			}
		]);
	});
});
