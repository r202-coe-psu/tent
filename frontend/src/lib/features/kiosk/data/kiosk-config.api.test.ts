import { describe, expect, it, vi } from 'vitest';
import { fetchKioskConfig, KIOSK_CONFIG_TIMEOUT_MS } from './kiosk-config.api';

describe('fetchKioskConfig', () => {
	it('returns the shelter setting and makes an uncached same-origin POST', async () => {
		const fetchFn = vi
			.fn<typeof fetch>()
			.mockResolvedValue(
				new Response(JSON.stringify({ phone_check_in_enabled: true }), { status: 200 })
			);

		await expect(fetchKioskConfig(fetchFn)).resolves.toEqual({ phoneCheckInEnabled: true });
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
		['disabled', new Response(JSON.stringify({ phone_check_in_enabled: false }), { status: 200 })],
		['missing flag', new Response(JSON.stringify({}), { status: 200 })],
		['unauthorized', new Response(null, { status: 401 })],
		['unavailable', new Response(null, { status: 503 })]
	])('fails closed when config is %s', async (_label, response) => {
		await expect(
			fetchKioskConfig(vi.fn<typeof fetch>().mockResolvedValue(response))
		).resolves.toEqual({
			phoneCheckInEnabled: false
		});
	});

	it('fails closed when the request fails or times out', async () => {
		const networkError = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));
		const timeoutError = vi
			.fn<typeof fetch>()
			.mockRejectedValue(new DOMException('The operation timed out', 'TimeoutError'));

		await expect(fetchKioskConfig(networkError)).resolves.toEqual({ phoneCheckInEnabled: false });
		await expect(fetchKioskConfig(timeoutError)).resolves.toEqual({ phoneCheckInEnabled: false });
	});
});
