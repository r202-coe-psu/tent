import { describe, expect, it, vi } from 'vitest';
import { KIOSK_HOST_INFO_PATH, fetchKioskHostInfo } from './kiosk-host-info.api';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const noUpdate = { commit: null, updatedAt: null, lastCheck: null };
const empty = { hostname: null, ips: [], ...noUpdate };

describe('fetchKioskHostInfo', () => {
	it('asks the kiosk machine for its hostname and addresses without caching', async () => {
		const fetchFn = vi
			.fn<typeof fetch>()
			.mockResolvedValue(json({ hostname: 'kiosk3', ips: ['192.168.1.42', 'fe80::1'] }));

		await expect(fetchKioskHostInfo(fetchFn)).resolves.toEqual({
			hostname: 'kiosk3',
			ips: ['192.168.1.42', 'fe80::1'],
			...noUpdate
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

		await expect(fetchKioskHostInfo(fetchFn)).resolves.toEqual(empty);
	});

	it('keeps only text addresses and treats a blank hostname as unknown', async () => {
		const fetchFn = vi
			.fn<typeof fetch>()
			.mockResolvedValue(json({ hostname: '   ', ips: ['10.0.0.5', 42, null, '10.0.0.6'] }));

		await expect(fetchKioskHostInfo(fetchFn)).resolves.toEqual({
			hostname: null,
			ips: ['10.0.0.5', '10.0.0.6'],
			...noUpdate
		});
	});

	it('tells the running commit, the last update and the last boot check', async () => {
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
			json({
				hostname: 'kiosk3',
				ips: [],
				commit: '6220c41',
				updated_at: '2026-11-17T08:01:12',
				last_check: { at: '2026-11-18T07:59:40', outcome: 'up-to-date' }
			})
		);

		await expect(fetchKioskHostInfo(fetchFn)).resolves.toEqual({
			hostname: 'kiosk3',
			ips: [],
			commit: '6220c41',
			updatedAt: '2026-11-17T08:01:12',
			lastCheck: { at: '2026-11-18T07:59:40', outcome: 'up-to-date' }
		});
	});

	it('treats a missing or malformed update state as unknown', async () => {
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
			json({
				hostname: 'kiosk3',
				ips: [],
				commit: 42,
				updated_at: '',
				last_check: { at: '2026-11-18T07:59:40' }
			})
		);

		await expect(fetchKioskHostInfo(fetchFn)).resolves.toEqual({
			hostname: 'kiosk3',
			ips: [],
			...noUpdate
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

		await expect(fetchKioskHostInfo(notAnObject)).resolves.toEqual(empty);
		await expect(fetchKioskHostInfo(notJson)).resolves.toEqual(empty);
		await expect(fetchKioskHostInfo(ipsNotAList)).resolves.toEqual({
			hostname: 'kiosk3',
			ips: [],
			...noUpdate
		});
	});

	it('answers empty on a network failure or a timeout instead of throwing', async () => {
		const offline = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));
		const slow = vi
			.fn<typeof fetch>()
			.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));

		await expect(fetchKioskHostInfo(offline)).resolves.toEqual(empty);
		await expect(fetchKioskHostInfo(slow)).resolves.toEqual(empty);
	});
});
