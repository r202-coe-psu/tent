import { describe, expect, it, vi } from 'vitest';
import {
	KIOSK_DEVICE_INFO_PATH,
	fetchKioskDeviceInfo,
	type KioskDeviceInfoResult
} from './kiosk-device-info.api';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const wireInfo = {
	device: {
		device_id: 'dev-01',
		name: 'Kiosk 1',
		station_name: 'Front desk',
		screen_type: 'portrait'
	},
	shelter: { code: 'SH-001', name: 'Hat Yai Hall' },
	staff_pin: {
		set: true,
		is_default: false,
		updated_at: '2026-10-20T08:30:00Z',
		updated_by: 'staff-7'
	},
	banner_group: { id: 'bg-1', name: 'Lobby banners' }
};

describe('fetchKioskDeviceInfo', () => {
	it('posts the PIN to the device-info endpoint without caching it and maps the answer', async () => {
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json(wireInfo));

		await expect(fetchKioskDeviceInfo('482913', fetchFn)).resolves.toEqual({
			kind: 'ok',
			info: {
				deviceId: 'dev-01',
				name: 'Kiosk 1',
				stationName: 'Front desk',
				screenType: 'portrait',
				shelterCode: 'SH-001',
				shelterName: 'Hat Yai Hall',
				staffPin: {
					set: true,
					isDefault: false,
					updatedAt: '2026-10-20T08:30:00Z',
					updatedBy: 'staff-7'
				},
				bannerGroup: { id: 'bg-1', name: 'Lobby banners' }
			}
		});

		const [url, init] = fetchFn.mock.calls[0]!;
		expect(url).toBe(KIOSK_DEVICE_INFO_PATH);
		expect(init).toMatchObject({ method: 'POST', cache: 'no-store' });
		expect(init?.signal).toBeInstanceOf(AbortSignal);
		expect(JSON.parse(init?.body as string)).toEqual({ pin: '482913' });
	});

	it.each<[string, Response, KioskDeviceInfoResult]>([
		[
			'a wrong PIN',
			json({ error: { code: 'staff_pin_invalid', message: 'x' } }, 401),
			{ kind: 'wrong' }
		],
		[
			'no PIN set on this kiosk',
			json({ error: { code: 'staff_pin_not_set', message: 'x' } }, 409),
			{ kind: 'not_set' }
		],
		[
			'a device credential failure (401 with another code)',
			json({ error: { code: 'unauthorized', message: 'x' } }, 401),
			{ kind: 'error' }
		],
		[
			'a rate limit',
			json({ error: { code: 'RATE_LIMITED', message: 'x' } }, 429),
			{ kind: 'error' }
		],
		[
			'the service down',
			json({ error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'x' } }, 503),
			{ kind: 'error' }
		],
		['a 409 with another code', json({ error: { code: 'conflict' } }, 409), { kind: 'error' }],
		['a body that is not JSON', new Response('nope', { status: 401 }), { kind: 'error' }]
	])('maps %s', async (_name, response, expected) => {
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response);

		await expect(fetchKioskDeviceInfo('123456', fetchFn)).resolves.toEqual(expected);
	});

	it('turns a 200 whose body is not the device info into an error', async () => {
		const missingShelter: Partial<typeof wireInfo> = { ...wireInfo };
		delete missingShelter.shelter;
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json(missingShelter));

		await expect(fetchKioskDeviceInfo('123456', fetchFn)).resolves.toEqual({ kind: 'error' });
	});

	it('turns a 200 whose screen_type is neither compact nor portrait into an error', async () => {
		const fetchFn = vi
			.fn<typeof fetch>()
			.mockResolvedValue(
				json({ ...wireInfo, device: { ...wireInfo.device, screen_type: 'tablet' } })
			);

		await expect(fetchKioskDeviceInfo('123456', fetchFn)).resolves.toEqual({ kind: 'error' });
	});

	it('shows a kiosk without a banner group or PIN history as nulls', async () => {
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
			json({
				...wireInfo,
				staff_pin: { set: true, is_default: true, updated_at: null, updated_by: null },
				banner_group: null
			})
		);

		const result = await fetchKioskDeviceInfo('123456', fetchFn);

		expect(result).toMatchObject({
			kind: 'ok',
			info: {
				staffPin: { set: true, isDefault: true, updatedAt: null, updatedBy: null },
				bannerGroup: null
			}
		});
	});

	it('turns a network failure or a timeout into an error instead of throwing', async () => {
		const offline = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));
		const slow = vi
			.fn<typeof fetch>()
			.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));

		await expect(fetchKioskDeviceInfo('123456', offline)).resolves.toEqual({ kind: 'error' });
		await expect(fetchKioskDeviceInfo('123456', slow)).resolves.toEqual({ kind: 'error' });
	});
});
