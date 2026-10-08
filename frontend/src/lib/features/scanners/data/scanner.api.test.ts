import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteScannerDevice, revealScannerStaffPin, setScannerStaffPin } from './scanner.api';

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

		expect(await setScannerStaffPin('scanner_device:kiosk-01', { pin: '482913' })).toEqual({
			ok: true
		});
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('/api/v1/scanner/devices/scanner_device%3Akiosk-01/staff-pin');
		expect(init.method).toBe('POST');
		expect(init.cache).toBe('no-store');
		expect(JSON.parse(init.body as string)).toEqual({ pin: '482913' });
	});

	it('returns the regenerated PIN', async () => {
		fetchMock.mockResolvedValueOnce(respond(200, { ok: true, pin: '582047' }));
		const result = await setScannerStaffPin('scanner_device:kiosk-01', { regenerate: true });
		expect(result.pin).toBe('582047');
	});

	it('reveals via POST to the reveal path and validates the payload', async () => {
		fetchMock.mockResolvedValueOnce(
			respond(200, { pin: '482913', is_default: false, updated_at: null, updated_by: null })
		);
		const revealed = await revealScannerStaffPin('scanner_device:kiosk-01');
		expect(revealed.pin).toBe('482913');
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('/api/v1/scanner/devices/scanner_device%3Akiosk-01/staff-pin/reveal');
		expect(init.method).toBe('POST');

		fetchMock.mockResolvedValueOnce(respond(200, { pin: 'abc' }));
		await expect(revealScannerStaffPin('scanner_device:kiosk-01')).rejects.toThrow();
	});

	it.each([
		[403, { error: { code: 'FORBIDDEN', message: 'x' } }, 'เฉพาะผู้ดูแลระบบ'],
		[404, { error: { code: 'NOT_FOUND', message: 'x' } }, 'ไม่พบเครื่อง'],
		[409, { error: { code: 'staff_pin_not_set', message: 'x' } }, 'ยังไม่ได้ตั้ง PIN'],
		[409, { error: { code: 'CONFLICT', message: 'x' } }, 'แก้ไขเครื่องนี้พร้อมกัน'],
		[503, { error: { code: 'STAFF_PIN_UNAVAILABLE', message: 'x' } }, 'ไม่พร้อมใช้งานชั่วคราว']
	])('maps HTTP %i to a Thai message', async (status, body, expected) => {
		fetchMock.mockResolvedValueOnce(respond(status, body));
		await expect(revealScannerStaffPin('scanner_device:kiosk-01')).rejects.toThrow(expected);
	});

	it('surfaces the server validation message for a rejected PIN', async () => {
		fetchMock.mockResolvedValueOnce(
			respond(400, { error: { code: 'VALIDATION', message: 'PIN นี้เดาง่ายเกินไป' } })
		);
		await expect(setScannerStaffPin('scanner_device:kiosk-01', { pin: '482913' })).rejects.toThrow(
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
		await deleteScannerDevice('scanner_device:kiosk-01');
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('/api/v1/scanner/devices/scanner_device%3Akiosk-01');
		expect(init.method).toBe('DELETE');
	});

	it.each([
		[403, 'เฉพาะผู้ดูแลระบบ'],
		[404, 'ไม่พบเครื่อง'],
		[409, 'แก้ไขเครื่องนี้พร้อมกัน'],
		[503, 'ไม่สามารถลบเครื่องสแกนได้']
	])('maps HTTP %i to a Thai message', async (status, expected) => {
		fetchMock.mockResolvedValueOnce(respond(status, { error: { code: 'X' } }));
		await expect(deleteScannerDevice('scanner_device:kiosk-01')).rejects.toThrow(expected);
	});
});
