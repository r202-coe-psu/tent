import { describe, expect, it } from 'vitest';
import {
	createPrintJob,
	getPrintJobStatus,
	PrintJobForbiddenError,
	PrintJobNotFoundError,
	listShelterPrinters,
	PrinterNotFoundError,
	PrinterOfflineError,
	type PrintJobCreator,
	type PrintDeviceReader
} from './print-jobs.server';
import type { PrintDeviceDoc } from './device-credentials';
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
	const store: PrintJobCreator = {
		async createJob(doc) {
			created.push(doc);
		}
	};
	const devices: PrintDeviceReader = {
		async getDevice(printerId) {
			return printerId === printer._id ? printer : null;
		}
	};
	const authorizedShelters: string[] = [];
	const caller = {
		name: 'staff-a',
		async assertShelterAccess(code: string) {
			authorizedShelters.push(code);
		}
	};
	return {
		created,
		authorizedShelters,
		caller,
		deps: { store, devices, newId: () => '01JB0000000000000000000009' }
	};
}

describe('createPrintJob', () => {
	it('stores a pending job with its labels attached for an online printer', async () => {
		const { deps, caller, created, authorizedShelters } = setup();

		const result = await createPrintJob(
			deps,
			caller,
			{ printer_id: device._id, source: 'walk_in', labels: [LABEL_A, LABEL_B] },
			new Date('2026-10-22T03:00:00.000Z')
		);

		expect(result).toEqual({
			job_id: '01JB0000000000000000000009',
			expires_at: '2026-10-22T03:02:00.000Z'
		});
		expect(authorizedShelters).toEqual(['SH001']);
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
