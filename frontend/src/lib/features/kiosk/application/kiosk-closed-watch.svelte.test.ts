import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KioskConfig } from '../data/kiosk-config.api';
import { KIOSK_CLOSED_POLL_MS, KioskClosedWatch } from './kiosk-closed-watch.svelte';

function config(serviceOpen: boolean): KioskConfig {
	return {
		phoneCheckInEnabled: true,
		walkInRegistrationEnabled: true,
		thaidCheckInEnabled: true,
		serviceOpen
	};
}

describe('KioskClosedWatch', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('polls config with bypassCache every 30 s and calls onReopen once service is open again', async () => {
		vi.useFakeTimers();
		const fetchConfig = vi
			.fn<(options: { bypassCache: true }) => Promise<KioskConfig>>()
			.mockResolvedValueOnce(config(false))
			.mockResolvedValueOnce(config(false))
			.mockResolvedValue(config(true));
		const onReopen = vi.fn();
		const watch = new KioskClosedWatch({ fetchConfig, onReopen });
		watch.start();

		expect(fetchConfig).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(KIOSK_CLOSED_POLL_MS);
		await vi.advanceTimersByTimeAsync(KIOSK_CLOSED_POLL_MS);
		expect(fetchConfig).toHaveBeenCalledTimes(2);
		expect(fetchConfig).toHaveBeenCalledWith({ bypassCache: true });
		expect(onReopen).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(KIOSK_CLOSED_POLL_MS);
		expect(onReopen).toHaveBeenCalledOnce();

		await vi.advanceTimersByTimeAsync(KIOSK_CLOSED_POLL_MS * 3);
		expect(fetchConfig).toHaveBeenCalledTimes(3);
		expect(onReopen).toHaveBeenCalledOnce();
	});

	it('stops polling after stop(), even with a request in flight', async () => {
		vi.useFakeTimers();
		const fetchConfig = vi
			.fn<(options: { bypassCache: true }) => Promise<KioskConfig>>()
			.mockResolvedValue(config(true));
		const onReopen = vi.fn();
		const watch = new KioskClosedWatch({ fetchConfig, onReopen });
		watch.start();

		watch.stop();
		await vi.advanceTimersByTimeAsync(KIOSK_CLOSED_POLL_MS * 2);

		expect(fetchConfig).not.toHaveBeenCalled();
		expect(onReopen).not.toHaveBeenCalled();
	});
});
