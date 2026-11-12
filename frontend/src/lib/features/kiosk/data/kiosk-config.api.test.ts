import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	fetchKioskConfig,
	KIOSK_CONFIG_CACHE_TTL_MS,
	KIOSK_CONFIG_TIMEOUT_MS,
	KIOSK_SERVICE_GATE_FAILURE_TTL_MS,
	readKioskServiceGate,
	readKioskServiceOpen,
	resetKioskConfigCache
} from './kiosk-config.api';

describe('fetchKioskConfig', () => {
	beforeEach(() => {
		resetKioskConfigCache();
		vi.useRealTimers();
	});

	it('returns the shelter setting and makes an uncached same-origin POST', async () => {
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
			new Response(
				JSON.stringify({
					phone_check_in_enabled: true,
					walk_in_registration_enabled: true,
					thaid_check_in_enabled: true
				}),
				{ status: 200 }
			)
		);

		await expect(fetchKioskConfig(fetchFn)).resolves.toEqual({
			phoneCheckInEnabled: true,
			walkInRegistrationEnabled: true,
			thaidCheckInEnabled: true,
			serviceOpen: true
		});
		expect(fetchFn).toHaveBeenCalledWith(
			'/api/v1/kiosk/config',
			expect.objectContaining({
				method: 'POST',
				cache: 'no-store',
				signal: expect.any(AbortSignal)
			})
		);
		expect(KIOSK_CONFIG_TIMEOUT_MS).toBe(3_000);
	});

	it.each([
		[
			'disabled',
			new Response(
				JSON.stringify({ phone_check_in_enabled: false, walk_in_registration_enabled: false }),
				{ status: 200 }
			)
		],
		['missing flag', new Response(JSON.stringify({}), { status: 200 })],
		['unauthorized', new Response(null, { status: 401 })],
		['unavailable', new Response(null, { status: 503 })]
	])(
		'method flags fail closed and service stays open when config is %s',
		async (_label, response) => {
			await expect(
				fetchKioskConfig(vi.fn<typeof fetch>().mockResolvedValue(response))
			).resolves.toEqual({
				phoneCheckInEnabled: false,
				walkInRegistrationEnabled: false,
				thaidCheckInEnabled: false,
				serviceOpen: true
			});
		}
	);

	it('keeps the kiosk open but method flags closed when the request fails or times out', async () => {
		const networkError = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));
		const timeoutError = vi
			.fn<typeof fetch>()
			.mockRejectedValue(new DOMException('The operation timed out', 'TimeoutError'));

		await expect(fetchKioskConfig(networkError)).resolves.toEqual({
			phoneCheckInEnabled: false,
			walkInRegistrationEnabled: false,
			thaidCheckInEnabled: false,
			serviceOpen: true
		});
		await expect(fetchKioskConfig(timeoutError)).resolves.toEqual({
			phoneCheckInEnabled: false,
			walkInRegistrationEnabled: false,
			thaidCheckInEnabled: false,
			serviceOpen: true
		});
	});

	it('reuses a successful result within the cache TTL instead of fetching again', async () => {
		const fetchFn = vi
			.fn<typeof fetch>()
			.mockResolvedValue(
				new Response(
					JSON.stringify({ phone_check_in_enabled: true, walk_in_registration_enabled: false }),
					{ status: 200 }
				)
			);

		await fetchKioskConfig(fetchFn);
		const second = await fetchKioskConfig(fetchFn);

		expect(fetchFn).toHaveBeenCalledTimes(1);
		expect(second).toEqual({
			phoneCheckInEnabled: true,
			walkInRegistrationEnabled: false,
			thaidCheckInEnabled: false,
			serviceOpen: true
		});
	});

	it('re-fetches once the cache TTL has elapsed', async () => {
		vi.useFakeTimers();
		const fetchFn = vi
			.fn<typeof fetch>()
			.mockResolvedValue(
				new Response(
					JSON.stringify({ phone_check_in_enabled: true, walk_in_registration_enabled: true }),
					{ status: 200 }
				)
			);

		await fetchKioskConfig(fetchFn);
		vi.advanceTimersByTime(KIOSK_CONFIG_CACHE_TTL_MS + 1);
		await fetchKioskConfig(fetchFn);

		expect(fetchFn).toHaveBeenCalledTimes(2);
	});

	it('never caches a failed lookup, so the very next visit tries again', async () => {
		const fetchFn = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('offline'));

		await fetchKioskConfig(fetchFn);
		fetchFn.mockResolvedValueOnce(
			new Response(
				JSON.stringify({ phone_check_in_enabled: true, walk_in_registration_enabled: true }),
				{ status: 200 }
			)
		);
		const second = await fetchKioskConfig(fetchFn);

		expect(fetchFn).toHaveBeenCalledTimes(2);
		expect(second).toEqual({
			phoneCheckInEnabled: true,
			walkInRegistrationEnabled: true,
			thaidCheckInEnabled: false,
			serviceOpen: true
		});
	});

	it.each([
		['service_open false', { service_open: false }, false],
		['service_open true', { service_open: true }, true],
		['no service_open key', {}, true]
	])('an ok config reads service open state: %s', async (_label, body, expected) => {
		const fetchFn = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));

		const config = await fetchKioskConfig(fetchFn);

		expect(config.serviceOpen).toBe(expected);
	});

	it('bypassCache always hits the network and refreshes the cache', async () => {
		const closed = new Response(JSON.stringify({ service_open: false }), { status: 200 });
		const open = new Response(JSON.stringify({ service_open: true }), { status: 200 });
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(open).mockResolvedValueOnce(closed);

		await fetchKioskConfig(fetchFn);
		const fresh = await fetchKioskConfig(fetchFn, { bypassCache: true });
		const afterwards = await fetchKioskConfig(fetchFn);

		expect(fetchFn).toHaveBeenCalledTimes(2);
		expect(fresh.serviceOpen).toBe(false);
		expect(afterwards.serviceOpen).toBe(false);
	});
});

describe('readKioskServiceOpen', () => {
	beforeEach(() => {
		resetKioskConfigCache();
		vi.useRealTimers();
	});

	it.each([
		['service_open true', { service_open: true }, true],
		['service_open false', { service_open: false }, false]
	])('answers the server value when the read succeeds: %s', async (_label, body, expected) => {
		const fetchFn = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));

		await expect(readKioskServiceOpen(fetchFn)).resolves.toBe(expected);
	});

	it.each([
		[
			'non-ok response',
			vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }))
		],
		['network error', vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'))],
		[
			'timeout',
			vi
				.fn<typeof fetch>()
				.mockRejectedValue(new DOMException('The operation timed out', 'TimeoutError'))
		]
	])('answers null (could not read) on %s', async (_label, fetchFn) => {
		await expect(readKioskServiceOpen(fetchFn)).resolves.toBeNull();
	});

	it('always bypasses the cache and refreshes it on a successful read', async () => {
		const fetchFn = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response(JSON.stringify({ service_open: true }), { status: 200 }))
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ service_open: false }), { status: 200 })
			);

		await fetchKioskConfig(fetchFn);
		const fresh = await readKioskServiceOpen(fetchFn);
		const cached = await fetchKioskConfig(fetchFn);

		expect(fetchFn).toHaveBeenCalledTimes(2);
		expect(fresh).toBe(false);
		expect(cached.serviceOpen).toBe(false);
	});
});

describe('readKioskServiceGate', () => {
	const json = (body: object) => new Response(JSON.stringify(body), { status: 200 });

	beforeEach(() => {
		resetKioskConfigCache();
		vi.useRealTimers();
	});

	it('answers the server value and reuses it within the cache TTL', async () => {
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json({ service_open: false }));

		await expect(readKioskServiceGate(fetchFn)).resolves.toBe(false);
		await expect(readKioskServiceGate(fetchFn)).resolves.toBe(false);

		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it('after a failed read answers open without asking again until the failure TTL passes', async () => {
		vi.useFakeTimers();
		const fetchFn = vi
			.fn<typeof fetch>()
			.mockRejectedValueOnce(new Error('offline'))
			.mockResolvedValueOnce(json({ service_open: false }));

		await expect(readKioskServiceGate(fetchFn)).resolves.toBe(true);
		vi.advanceTimersByTime(KIOSK_SERVICE_GATE_FAILURE_TTL_MS - 1);
		await expect(readKioskServiceGate(fetchFn)).resolves.toBe(true);
		expect(fetchFn).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(1);
		await expect(readKioskServiceGate(fetchFn)).resolves.toBe(false);
		expect(fetchFn).toHaveBeenCalledTimes(2);
	});

	it('remembers a non-ok response as a failure too', async () => {
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));

		await readKioskServiceGate(fetchFn);
		await readKioskServiceGate(fetchFn);

		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it('does not make fetchKioskConfig cache failures', async () => {
		const fetchFn = vi
			.fn<typeof fetch>()
			.mockRejectedValueOnce(new Error('offline'))
			.mockResolvedValueOnce(json({ phone_check_in_enabled: true }));

		await readKioskServiceGate(fetchFn);
		const config = await fetchKioskConfig(fetchFn);

		expect(fetchFn).toHaveBeenCalledTimes(2);
		expect(config.phoneCheckInEnabled).toBe(true);
	});
});
