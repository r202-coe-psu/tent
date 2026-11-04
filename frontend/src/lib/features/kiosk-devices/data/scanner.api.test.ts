import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	deleteScannerDevice,
	listScannerDevices,
	revealScannerStaffPin,
	setScannerStaffPin,
	updateScannerDevice
} from './scanner.api';

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

function respond(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

describe('scanner staff PIN api', () => {
	afterEach(() => {
		fetchMock.mockReset();
	});

	it('posts a chosen PIN to the encoded device path without caching', async () => {
		fetchMock.mockResolvedValueOnce(respond(200, { ok: true }));

		expect(await setScannerStaffPin('kiosk-01', { pin: '482913' })).toEqual({
			ok: true
		});
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('/api/v1/kiosk/devices/kiosk-01/staff-pin');
		expect(init.method).toBe('POST');
		expect(init.cache).toBe('no-store');
		expect(JSON.parse(init.body as string)).toEqual({ pin: '482913' });
	});

	it('returns the regenerated PIN', async () => {
		fetchMock.mockResolvedValueOnce(respond(200, { ok: true, pin: '582047' }));
		const result = await setScannerStaffPin('kiosk-01', { regenerate: true });
		expect(result.pin).toBe('582047');
	});

	it('reveals via POST to the reveal path and validates the payload', async () => {
		fetchMock.mockResolvedValueOnce(
			respond(200, { pin: '482913', is_default: false, updated_at: null, updated_by: null })
		);
		const revealed = await revealScannerStaffPin('kiosk-01');
		expect(revealed.pin).toBe('482913');
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('/api/v1/kiosk/devices/kiosk-01/staff-pin/reveal');
		expect(init.method).toBe('POST');

		fetchMock.mockResolvedValueOnce(respond(200, { pin: 'abc' }));
		await expect(revealScannerStaffPin('kiosk-01')).rejects.toThrow();
	});

	it.each([
		[403, { error: { code: 'FORBIDDEN', message: 'x' } }, 'ไม่มีสิทธิ์จัดการ PIN ของเครื่องนี้'],
		[404, { error: { code: 'NOT_FOUND', message: 'x' } }, 'ไม่พบเครื่อง'],
		[409, { error: { code: 'staff_pin_not_set', message: 'x' } }, 'ยังไม่ได้ตั้ง PIN'],
		[409, { error: { code: 'CONFLICT', message: 'x' } }, 'แก้ไขเครื่องนี้พร้อมกัน'],
		[503, { error: { code: 'STAFF_PIN_UNAVAILABLE', message: 'x' } }, 'ไม่พร้อมใช้งานชั่วคราว']
	])('maps HTTP %i to a Thai message', async (status, body, expected) => {
		fetchMock.mockResolvedValueOnce(respond(status, body));
		await expect(revealScannerStaffPin('kiosk-01')).rejects.toThrow(expected);
	});

	it('surfaces the server validation message for a rejected PIN', async () => {
		fetchMock.mockResolvedValueOnce(
			respond(400, { error: { code: 'VALIDATION', message: 'PIN นี้เดาง่ายเกินไป' } })
		);
		await expect(setScannerStaffPin('kiosk-01', { pin: '482913' })).rejects.toThrow(
			'PIN นี้เดาง่ายเกินไป'
		);
	});
});

describe('deleteScannerDevice', () => {
	afterEach(() => {
		fetchMock.mockReset();
	});

	it('sends DELETE to the encoded device path', async () => {
		fetchMock.mockResolvedValueOnce(respond(200, { ok: true }));
		await deleteScannerDevice('kiosk-01');
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('/api/v1/kiosk/devices/kiosk-01');
		expect(init.method).toBe('DELETE');
	});

	it.each([
		[403, 'ไม่มีสิทธิ์ลบเครื่องสแกนของศูนย์นี้'],
		[404, 'ไม่พบเครื่อง'],
		[409, 'แก้ไขเครื่องนี้พร้อมกัน'],
		[503, 'ไม่สามารถลบเครื่องสแกนได้']
	])('maps HTTP %i to a Thai message', async (status, expected) => {
		fetchMock.mockResolvedValueOnce(respond(status, { error: { code: 'X' } }));
		await expect(deleteScannerDevice('kiosk-01')).rejects.toThrow(expected);
	});
});

const summary = {
	id: 'scanner:kiosk-01',
	device_id: 'kiosk-01',
	name: 'Kiosk 1',
	shelter_code: 'SH001',
	station_name: 'จุดคัดกรองทั่วไป',
	status: 'active',
	last_seen_at: null,
	staff_pin_set: true,
	staff_pin_is_default: false,
	banner_group_id: null,
	screen_type: 'compact'
};

describe('listScannerDevices', () => {
	afterEach(() => {
		fetchMock.mockReset();
	});

	it('gets the device list without a query string when no shelter is given', async () => {
		fetchMock.mockResolvedValueOnce(respond(200, [summary]));
		expect(await listScannerDevices()).toEqual([summary]);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
		expect(url).toBe('/api/v1/kiosk/devices');
		expect(init?.method ?? 'GET').toBe('GET');
	});

	it('sends the encoded shelter_code when given', async () => {
		fetchMock.mockResolvedValueOnce(respond(200, [summary]));
		await listScannerDevices('SH 001');
		expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/kiosk/devices?shelter_code=SH%20001');
	});

	it('rejects a payload that does not match the summary shape', async () => {
		fetchMock.mockResolvedValueOnce(respond(200, [{ ...summary, secret_hash: 'x' }]));
		await expect(listScannerDevices()).rejects.toThrow();
	});

	it.each([
		[400, 'กรุณาระบุศูนย์พักพิง'],
		[403, 'ไม่มีสิทธิ์ดูเครื่องของศูนย์นี้']
	])('throws the server message for HTTP %i', async (status, message) => {
		fetchMock.mockResolvedValueOnce(respond(status, { error: { code: 'X', message } }));
		await expect(listScannerDevices('SH002')).rejects.toThrow(message);
	});
});

describe('updateScannerDevice', () => {
	afterEach(() => {
		fetchMock.mockReset();
	});

	it('patches the encoded device_id path with the JSON body and parses the summary', async () => {
		const updated = { ...summary, status: 'inactive' };
		fetchMock.mockResolvedValueOnce(respond(200, updated));
		expect(await updateScannerDevice('kiosk 01', { status: 'inactive' })).toEqual(updated);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('/api/v1/kiosk/devices/kiosk%2001');
		expect(init.method).toBe('PATCH');
		expect(new Headers(init.headers).get('content-type')).toBe('application/json');
		expect(JSON.parse(init.body as string)).toEqual({ status: 'inactive' });
	});

	it('returns the banner group id from the summary', async () => {
		const updated = { ...summary, banner_group_id: 'kiosk_banner_group:lobby' };
		fetchMock.mockResolvedValueOnce(respond(200, updated));
		expect(await updateScannerDevice('kiosk-01', { status: 'active' })).toEqual(updated);
	});

	it('throws the server message on an error envelope', async () => {
		fetchMock.mockResolvedValueOnce(
			respond(404, { error: { code: 'NOT_FOUND', message: 'ไม่พบเครื่องสแกนนี้' } })
		);
		await expect(updateScannerDevice('kiosk-01', { name: 'A' })).rejects.toThrow(
			'ไม่พบเครื่องสแกนนี้'
		);
	});
});
