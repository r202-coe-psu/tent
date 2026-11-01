import { beforeEach, describe, expect, it, vi } from 'vitest';

const printingRaw = vi.hoisted(() => vi.fn());
const ensurePrintingDevicesDb = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/couch-printing-service', () => ({ printingRaw }));
vi.mock('$lib/server/printers/printing-provision', () => ({ ensurePrintingDevicesDb }));

import { PrintDependencyError, type PrintDeviceDoc } from './device-credentials';
import {
	compactDevicesDb,
	listRegisteredShelters,
	printDeviceRepository,
	readHousekeepingState,
	writeHousekeepingState
} from './print-device.repo';

type Reply = { status: number; data?: unknown };

let calls: { path: string; method: string; body: unknown }[];
let replies: Reply[];

/** Queue the next CouchDB answers, in call order. */
function reply(...next: Reply[]) {
	replies.push(...next);
}

beforeEach(() => {
	calls = [];
	replies = [];
	printingRaw.mockReset();
	ensurePrintingDevicesDb.mockReset();
	ensurePrintingDevicesDb.mockResolvedValue(undefined);
	printingRaw.mockImplementation((path: string, method: string, body?: unknown) => {
		calls.push({ path, method, body });
		const next = replies.shift() ?? { status: 500 };
		return Promise.resolve({ status: next.status, data: next.data ?? null });
	});
});

function device(overrides: Partial<PrintDeviceDoc> = {}): PrintDeviceDoc {
	return {
		_id: 'print_device:pi-1',
		_rev: '1-a',
		type: 'print_device',
		schema_v: 1,
		device_id: 'pi-1',
		name: 'Front desk',
		shelter_code: 'SH01',
		station: null,
		host_kind: 'standalone',
		secret_hash: 'h',
		secret_prefix: 'sk_print_ab',
		status: 'active',
		last_seen_at: null,
		queue_state: 'ready',
		agent_version: null,
		created_at: '2026-11-01T00:00:00.000Z',
		updated_at: '2026-11-01T00:00:00.000Z',
		created_by: 'admin',
		...overrides
	};
}

describe('print device repository (printing_devices via printing_service)', () => {
	it('authenticates by deterministic id with a plain GET in printing_devices', async () => {
		reply({ status: 200, data: device() });

		const found = await printDeviceRepository.getDeviceByDeviceId('pi-1');

		expect(found?.device_id).toBe('pi-1');
		expect(calls).toEqual([
			{ path: '/printing_devices/print_device%3Api-1', method: 'GET', body: undefined }
		]);
	});

	it('provisions the devices db before the first request', async () => {
		reply({ status: 404 });
		await printDeviceRepository.getDevice('print_device:pi-1');
		expect(ensurePrintingDevicesDb).toHaveBeenCalledTimes(1);
	});

	it('returns null for a missing device', async () => {
		reply({ status: 404, data: { error: 'not_found' } });
		expect(await printDeviceRepository.getDevice('print_device:nope')).toBeNull();
	});

	it('fails with a dependency error on an unexpected status', async () => {
		reply({ status: 500 });
		await expect(printDeviceRepository.getDevice('print_device:pi-1')).rejects.toBeInstanceOf(
			PrintDependencyError
		);
	});

	it('createDevice PUTs the doc and reports a duplicate id as conflict', async () => {
		reply({ status: 201, data: { rev: '1-x' } }, { status: 409 });

		expect(await printDeviceRepository.createDevice(device())).toEqual({ ok: true, rev: '1-x' });
		expect(await printDeviceRepository.createDevice(device())).toEqual({ conflict: true });
		expect(calls[0]).toMatchObject({
			path: '/printing_devices/print_device%3Api-1',
			method: 'PUT',
			body: device()
		});
	});

	it('updateDevice returns the new rev, or conflict on a stale rev', async () => {
		reply({ status: 202, data: { rev: '2-y' } }, { status: 409 });

		expect(await printDeviceRepository.updateDevice(device())).toEqual({ ok: true, rev: '2-y' });
		expect(await printDeviceRepository.updateDevice(device())).toEqual({ conflict: true });
	});

	it('deleteDevice deletes at the doc rev; conflict and already-gone are reported', async () => {
		reply({ status: 200 }, { status: 409 }, { status: 404 });

		expect(await printDeviceRepository.deleteDevice(device())).toEqual({ ok: true });
		expect(await printDeviceRepository.deleteDevice(device())).toEqual({ conflict: true });
		expect(await printDeviceRepository.deleteDevice(device())).toEqual({ ok: true });
		expect(calls[0]).toMatchObject({
			path: '/printing_devices/print_device%3Api-1?rev=1-a',
			method: 'DELETE'
		});
	});

	it('lists a shelter devices with a type + shelter_code selector', async () => {
		reply({ status: 200, data: { docs: [device()] } });

		const docs = await printDeviceRepository.listDevices('SH01');

		expect(docs).toHaveLength(1);
		expect(calls[0]).toMatchObject({
			path: '/printing_devices/_find',
			method: 'POST',
			body: { selector: { type: 'print_device', shelter_code: 'SH01' }, limit: 100 }
		});
	});

	it('lists devices in a scope with $in, or every shelter for a null scope', async () => {
		reply({ status: 200, data: { docs: [] } }, { status: 200, data: { docs: [] } });

		await printDeviceRepository.listDevicesInScope(['SH01', 'SH02']);
		await printDeviceRepository.listDevicesInScope(null);

		expect(calls[0]?.body).toEqual({
			selector: { type: 'print_device', shelter_code: { $in: ['SH01', 'SH02'] } },
			limit: 1000
		});
		expect(calls[1]?.body).toEqual({
			selector: { type: 'print_device', shelter_code: { $gt: null } },
			limit: 1000
		});
	});
});

describe('listRegisteredShelters', () => {
	it('reads printing_db registry ids and returns upper-case shelter codes', async () => {
		reply({
			status: 200,
			data: { rows: [{ id: 'printing_db:SH01' }, { id: 'printing_db:ab2' }] }
		});

		expect(await listRegisteredShelters()).toEqual(['SH01', 'AB2']);

		const url = new URL(calls[0]!.path, 'http://x');
		expect(url.pathname).toBe('/printing_devices/_all_docs');
		expect(url.searchParams.get('startkey')).toBe('"printing_db:"');
		expect(url.searchParams.get('endkey')).toBe('"printing_db:￰"');
		expect(calls[0]!.method).toBe('GET');
	});
});

describe('compactDevicesDb', () => {
	it('POSTs _compact on printing_devices and accepts 202', async () => {
		reply({ status: 202 });
		await compactDevicesDb();
		expect(calls[0]).toMatchObject({ path: '/printing_devices/_compact', method: 'POST' });
	});

	it('fails with a dependency error on any other status', async () => {
		reply({ status: 500 });
		await expect(compactDevicesDb()).rejects.toBeInstanceOf(PrintDependencyError);
	});
});

describe('print_housekeeping state', () => {
	const state = {
		last_run_at: '2026-11-01T01:00:00.000Z',
		last_retention_at: '2026-11-01T00:00:00.000Z',
		last_error: null
	};

	it('reads the stored state, or null when the doc does not exist yet', async () => {
		reply(
			{
				status: 200,
				data: { _id: 'print_housekeeping', _rev: '1-a', type: 'print_housekeeping', ...state }
			},
			{ status: 404 }
		);

		expect(await readHousekeepingState()).toEqual(state);
		expect(await readHousekeepingState()).toBeNull();
		expect(calls[0]).toMatchObject({ path: '/printing_devices/print_housekeeping', method: 'GET' });
	});

	it('creates the doc on first write', async () => {
		reply({ status: 404 }, { status: 201, data: { rev: '1-a' } });

		await writeHousekeepingState(state);

		expect(calls[1]).toEqual({
			path: '/printing_devices/print_housekeeping',
			method: 'PUT',
			body: { _id: 'print_housekeeping', type: 'print_housekeeping', schema_v: 1, ...state }
		});
	});

	it('updates at the current rev', async () => {
		reply({ status: 200, data: { _rev: '3-c' } }, { status: 201, data: { rev: '4-d' } });

		await writeHousekeepingState(state);

		expect(calls[1]?.body).toMatchObject({ _rev: '3-c', last_run_at: state.last_run_at });
	});

	it('re-reads the rev once after a 409 and retries', async () => {
		reply(
			{ status: 200, data: { _rev: '3-c' } },
			{ status: 409 },
			{ status: 200, data: { _rev: '4-d' } },
			{ status: 201, data: { rev: '5-e' } }
		);

		await writeHousekeepingState(state);

		expect(calls.map((c) => c.method)).toEqual(['GET', 'PUT', 'GET', 'PUT']);
		expect(calls[3]?.body).toMatchObject({ _rev: '4-d' });
	});

	it('gives up with a dependency error after a second 409', async () => {
		reply(
			{ status: 200, data: { _rev: '3-c' } },
			{ status: 409 },
			{ status: 200, data: { _rev: '4-d' } },
			{ status: 409 }
		);

		await expect(writeHousekeepingState(state)).rejects.toBeInstanceOf(PrintDependencyError);
		expect(calls).toHaveLength(4);
	});
});
