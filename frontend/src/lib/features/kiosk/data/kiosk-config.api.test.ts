import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	fetchKioskConfig,
	KIOSK_CONFIG_CACHE_TTL_MS,
	KIOSK_CONFIG_TIMEOUT_MS,
	resetKioskConfigCache
} from './kiosk-config.api';

describe('fetchKioskConfig', () => {
	beforeEach(() => {
		resetKioskConfigCache();
		vi.useRealTimers();
	});

	it('returns the shelter setting and makes an uncached same-origin POST', async () => {
		const fetchFn = vi
			.fn<typeof fetch>()
			.mockResolvedValue(
				new Response(
					JSON.stringify({ phone_check_in_enabled: true, walk_in_registration_enabled: true }),
					{ status: 200 }
				)
			);

		await expect(fetchKioskConfig(fetchFn)).resolves.toEqual({
			phoneCheckInEnabled: true,
			walkInRegistrationEnabled: true
		});
		expect(fetchFn).toHaveBeenCalledWith(
			'/api/v1/scanner/kiosk/config',
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
	])('fails closed when config is %s', async (_label, response) => {
		await expect(
			fetchKioskConfig(vi.fn<typeof fetch>().mockResolvedValue(response))
		).resolves.toEqual({
			phoneCheckInEnabled: false,
			walkInRegistrationEnabled: false
		});
	});

	it('fails closed when the request fails or times out', async () => {
		const networkError = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));
		const timeoutError = vi
			.fn<typeof fetch>()
			.mockRejectedValue(new DOMException('The operation timed out', 'TimeoutError'));

		await expect(fetchKioskConfig(networkError)).resolves.toEqual({
			phoneCheckInEnabled: false,
			walkInRegistrationEnabled: false
		});
		await expect(fetchKioskConfig(timeoutError)).resolves.toEqual({
			phoneCheckInEnabled: false,
			walkInRegistrationEnabled: false
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
		expect(second).toEqual({ phoneCheckInEnabled: true, walkInRegistrationEnabled: false });
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
		expect(second).toEqual({ phoneCheckInEnabled: true, walkInRegistrationEnabled: true });
	});
});
