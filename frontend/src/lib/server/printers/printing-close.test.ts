import { describe, expect, it } from 'vitest';
import type { PrintDeviceDoc } from './device-credentials';
import type { PrintJobDoc } from './print-queue.server';
import {
	adminClosePorts,
	closeShelterPrintingWith,
	type AdminRaw,
	type CloseShelterPorts
} from './printing-close';

const NOW = new Date('2026-10-31T03:00:00.000Z');

describe('closeShelterPrintingWith', () => {
	it('dry-run reports the plan and makes no writes', async () => {
		const writes: string[] = [];
		const ports: CloseShelterPorts = {
			admin: async (path, method) => {
				writes.push(`${method} ${path}`);
				return { status: 200, data: {} };
			},
			printerIds: async () => ['print_device:pi-a', 'print_device:pi-b'],
			deactivate: async (id) => {
				writes.push(`deactivate ${id}`);
			}
		};

		const report = await closeShelterPrintingWith(ports, 'sh001', { dryRun: true });

		expect(report).toEqual({
			code: 'SH001',
			db: 'printing_sh001',
			registryId: 'printing_db:SH001',
			printerIds: ['print_device:pi-a', 'print_device:pi-b'],
			dryRun: true
		});
		expect(writes).toEqual([]);
	});
});

function device(deviceId: string, shelter = 'SH001'): PrintDeviceDoc {
	return {
		_id: `print_device:${deviceId}`,
		_rev: '1-a',
		type: 'print_device',
		schema_v: 1,
		device_id: deviceId,
		name: deviceId,
		shelter_code: shelter,
		station: null,
		host_kind: 'standalone',
		kiosk_device_id: null,
		secret_hash: 'h',
		secret_prefix: 'sk_print_aaaaaaaa',
		status: 'active',
		last_seen_at: null,
		queue_state: 'unknown',
		agent_version: null,
		created_at: '2026-10-01T00:00:00.000Z',
		updated_at: '2026-10-01T00:00:00.000Z',
		created_by: 'sa'
	};
}

function job(id: string, printerId: string, status: PrintJobDoc['status']): PrintJobDoc {
	return {
		_id: id,
		_rev: '1-j',
		type: 'print_job',
		schema_v: 1,
		shelter_code: 'SH001',
		printer_id: printerId,
		status,
		label_count: 1,
		source: 'walk_in',
		created_at: '2026-10-31T02:59:00.000Z',
		created_by: 'staff',
		expires_at: '2026-10-31T03:01:00.000Z',
		claimed_at: null,
		lease_until: null,
		finished_at: null,
		printed: 0,
		error_code: null,
		_attachments: { 'label-001.png': { stub: true } }
	};
}

/** Tiny CouchDB stand-in for the three DBs `adminClosePorts` talks to. */
function fakeCouch(devices: PrintDeviceDoc[], jobs: PrintJobDoc[]) {
	const deviceDocs = new Map(devices.map((d) => [d._id, d]));
	const jobDocs = new Map(jobs.map((j) => [j._id, j]));
	const raw: AdminRaw = async (path, method, body) => {
		const decoded = decodeURIComponent(path);
		if (method === 'POST' && path === '/printing_devices/_find') {
			const { shelter_code } = (body as { selector: { shelter_code: string } }).selector;
			return {
				status: 200,
				data: { docs: [...deviceDocs.values()].filter((d) => d.shelter_code === shelter_code) }
			};
		}
		if (path.startsWith('/printing_devices/print_device')) {
			const current = deviceDocs.get(decoded.replace('/printing_devices/', ''));
			if (method === 'GET')
				return current
					? { status: 200, data: structuredClone(current) }
					: { status: 404, data: null };
			if (method === 'PUT') {
				const doc = body as PrintDeviceDoc;
				if (current?._rev !== doc._rev) return { status: 409, data: null };
				deviceDocs.set(doc._id, { ...doc, _rev: '2-b' });
				return { status: 201, data: { rev: '2-b' } };
			}
		}
		if (method === 'POST' && path === '/printing_sh001/_find') {
			const { status, printer_id } = (body as { selector: { status: string; printer_id: string } })
				.selector;
			return {
				status: 200,
				data: {
					docs: [...jobDocs.values()].filter(
						(j) => j.status === status && j.printer_id === printer_id
					)
				}
			};
		}
		if (method === 'PUT' && path.startsWith('/printing_sh001/')) {
			const doc = body as PrintJobDoc;
			if (jobDocs.get(doc._id)?._rev !== doc._rev) return { status: 409, data: null };
			jobDocs.set(doc._id, { ...doc, _rev: '2-j' });
			return { status: 201, data: { rev: '2-j' } };
		}
		return { status: 500, data: null };
	};
	return { raw, deviceDocs, jobDocs };
}

describe('adminClosePorts', () => {
	it('lists the printers of the shelter only', async () => {
		const { raw } = fakeCouch([device('pi-a'), device('pi-b', 'SH002')], []);

		expect(await adminClosePorts(raw, () => NOW).printerIds('SH001')).toEqual([
			'print_device:pi-a'
		]);
	});

	it('deactivates a printer and fails its pending and printing jobs as printer_inactive', async () => {
		const { raw, deviceDocs, jobDocs } = fakeCouch(
			[device('pi-a')],
			[
				job('print_job:1', 'print_device:pi-a', 'pending'),
				job('print_job:2', 'print_device:pi-a', 'printing'),
				job('print_job:3', 'print_device:pi-b', 'pending')
			]
		);

		await adminClosePorts(raw, () => NOW).deactivate('print_device:pi-a');

		expect(deviceDocs.get('print_device:pi-a')?.status).toBe('inactive');
		for (const id of ['print_job:1', 'print_job:2'])
			expect(jobDocs.get(id)).toMatchObject({
				status: 'failed',
				error_code: 'printer_inactive',
				finished_at: '2026-10-31T03:00:00.000Z'
			});
		expect(jobDocs.get('print_job:1')?._attachments).toBeUndefined();
		expect(jobDocs.get('print_job:3')?.status).toBe('pending');
	});
});
