import { describe, expect, it, vi } from 'vitest';
import { KIOSK_HOST_INFO_PATH, fetchKioskHostInfo } from './kiosk-host-info.api';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('fetchKioskHostInfo', () => {
	it('asks the kiosk machine for its hostname and addresses without caching', async () => {
		const fetchFn = vi
			.fn<typeof fetch>()
			.mockResolvedValue(json({ hostname: 'kiosk3', ips: ['192.168.1.42', 'fe80::1'] }));

		await expect(fetchKioskHostInfo(fetchFn)).resolves.toEqual({
			hostname: 'kiosk3',
			ips: ['192.168.1.42', 'fe80::1']
		});

		const [url, init] = fetchFn.mock.calls[0]!;
		expect(url).toBe(KIOSK_HOST_INFO_PATH);
		expect(init).toMatchObject({ method: 'POST', cache: 'no-store' });
		expect(init?.signal).toBeInstanceOf(AbortSignal);
	});

	it('answers empty in a plain browser where the kiosk path does not exist', async () => {
		const fetchFn = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response('Not found', { status: 404 }));

		await expect(fetchKioskHostInfo(fetchFn)).resolves.toEqual({ hostname: null, ips: [] });
	});

	it('keeps only text addresses and treats a blank hostname as unknown', async () => {
		const fetchFn = vi
			.fn<typeof fetch>()
			.mockResolvedValue(json({ hostname: '   ', ips: ['10.0.0.5', 42, null, '10.0.0.6'] }));

		await expect(fetchKioskHostInfo(fetchFn)).resolves.toEqual({
			hostname: null,
			ips: ['10.0.0.5', '10.0.0.6']
		});
	});

	it('answers empty when the body is not the expected shape', async () => {
		const notAnObject = vi.fn<typeof fetch>().mockResolvedValue(json('kiosk3'));
		const notJson = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response('<html>', { status: 200 }));
		const ipsNotAList = vi
			.fn<typeof fetch>()
			.mockResolvedValue(json({ hostname: 'kiosk3', ips: '10.0.0.5' }));

		await expect(fetchKioskHostInfo(notAnObject)).resolves.toEqual({ hostname: null, ips: [] });
		await expect(fetchKioskHostInfo(notJson)).resolves.toEqual({ hostname: null, ips: [] });
		await expect(fetchKioskHostInfo(ipsNotAList)).resolves.toEqual({
			hostname: 'kiosk3',
			ips: []
		});
	});

	it('answers empty on a network failure or a timeout instead of throwing', async () => {
		const offline = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));
		const slow = vi
			.fn<typeof fetch>()
			.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));

		await expect(fetchKioskHostInfo(offline)).resolves.toEqual({ hostname: null, ips: [] });
		await expect(fetchKioskHostInfo(slow)).resolves.toEqual({ hostname: null, ips: [] });
	});
});
