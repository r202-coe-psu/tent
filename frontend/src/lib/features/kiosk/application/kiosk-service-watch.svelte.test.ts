import { afterEach, describe, expect, it, vi } from 'vitest';
import { KIOSK_SERVICE_POLL_MS, KioskServiceWatch } from './kiosk-service-watch.svelte';

describe('KioskServiceWatch until open (closed page)', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('asks the server every 30 s and calls onReopen once it answers service open', async () => {
		vi.useFakeTimers();
		const readServiceOpen = vi
			.fn<() => Promise<boolean | null>>()
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(false)
			.mockResolvedValue(true);
		const onReopen = vi.fn();
		const watch = new KioskServiceWatch({ readServiceOpen, until: 'open', onChange: onReopen });
		watch.start();

		expect(readServiceOpen).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(KIOSK_SERVICE_POLL_MS);
		await vi.advanceTimersByTimeAsync(KIOSK_SERVICE_POLL_MS);
		expect(readServiceOpen).toHaveBeenCalledTimes(2);
		expect(onReopen).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(KIOSK_SERVICE_POLL_MS);
		expect(onReopen).toHaveBeenCalledOnce();

		await vi.advanceTimersByTimeAsync(KIOSK_SERVICE_POLL_MS * 3);
		expect(readServiceOpen).toHaveBeenCalledTimes(3);
		expect(onReopen).toHaveBeenCalledOnce();
	});

	it('stays on the closed page while reads fail (null or throw) and only reopens on a real open answer', async () => {
		vi.useFakeTimers();
		const readServiceOpen = vi
			.fn<() => Promise<boolean | null>>()
			.mockResolvedValueOnce(null)
			.mockRejectedValueOnce(new Error('offline'))
			.mockResolvedValue(true);
		const onReopen = vi.fn();
		const watch = new KioskServiceWatch({ readServiceOpen, until: 'open', onChange: onReopen });
		watch.start();

		await vi.advanceTimersByTimeAsync(KIOSK_SERVICE_POLL_MS * 2);
		expect(readServiceOpen).toHaveBeenCalledTimes(2);
		expect(onReopen).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(KIOSK_SERVICE_POLL_MS);
		expect(onReopen).toHaveBeenCalledOnce();
	});

	it('stops polling after stop(), even with a request in flight', async () => {
		vi.useFakeTimers();
		const readServiceOpen = vi.fn<() => Promise<boolean | null>>().mockResolvedValue(true);
		const onReopen = vi.fn();
		const watch = new KioskServiceWatch({ readServiceOpen, until: 'open', onChange: onReopen });
		watch.start();

		watch.stop();
		await vi.advanceTimersByTimeAsync(KIOSK_SERVICE_POLL_MS * 2);

		expect(readServiceOpen).not.toHaveBeenCalled();
		expect(onReopen).not.toHaveBeenCalled();
	});
});

describe('KioskServiceWatch until closed (home screen)', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('asks every 30 s and calls onChange once the server answers service closed', async () => {
		vi.useFakeTimers();
		const readServiceOpen = vi
			.fn<() => Promise<boolean | null>>()
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(true)
			.mockResolvedValue(false);
		const onChange = vi.fn();
		const watch = new KioskServiceWatch({ readServiceOpen, until: 'closed', onChange });
		watch.start();

		await vi.advanceTimersByTimeAsync(KIOSK_SERVICE_POLL_MS * 2);
		expect(readServiceOpen).toHaveBeenCalledTimes(2);
		expect(onChange).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(KIOSK_SERVICE_POLL_MS);
		expect(onChange).toHaveBeenCalledOnce();

		await vi.advanceTimersByTimeAsync(KIOSK_SERVICE_POLL_MS * 3);
		expect(readServiceOpen).toHaveBeenCalledTimes(3);
		expect(onChange).toHaveBeenCalledOnce();
	});

	it('does nothing when a read fails (null or throw): an unreadable config never closes the kiosk', async () => {
		vi.useFakeTimers();
		const readServiceOpen = vi
			.fn<() => Promise<boolean | null>>()
			.mockResolvedValueOnce(null)
			.mockRejectedValueOnce(new Error('offline'))
			.mockResolvedValue(true);
		const onChange = vi.fn();
		const watch = new KioskServiceWatch({ readServiceOpen, until: 'closed', onChange });
		watch.start();

		await vi.advanceTimersByTimeAsync(KIOSK_SERVICE_POLL_MS * 4);

		expect(readServiceOpen).toHaveBeenCalledTimes(4);
		expect(onChange).not.toHaveBeenCalled();
	});
});
