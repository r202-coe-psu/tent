import { afterEach, describe, expect, it, vi } from 'vitest';
import { KioskIdleTimeout, KIOSK_IDLE_TIMEOUT_MS } from './kiosk-idle-timeout.svelte.js';

describe('KioskIdleTimeout', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('calls onIdle after one minute without activity', () => {
		vi.useFakeTimers();
		const onIdle = vi.fn();
		const timeout = new KioskIdleTimeout(KIOSK_IDLE_TIMEOUT_MS, onIdle);
		timeout.start();

		vi.advanceTimersByTime(KIOSK_IDLE_TIMEOUT_MS - 1);
		expect(onIdle).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(onIdle).toHaveBeenCalledOnce();
	});

	it('resets the idle deadline after activity', () => {
		vi.useFakeTimers();
		const onIdle = vi.fn();
		const timeout = new KioskIdleTimeout(1000, onIdle);
		timeout.start();
		vi.advanceTimersByTime(900);
		timeout.recordActivity();
		vi.advanceTimersByTime(999);
		expect(onIdle).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(onIdle).toHaveBeenCalledOnce();
	});

	it('pauses while printing and resumes with a fresh idle window', () => {
		vi.useFakeTimers();
		const onIdle = vi.fn();
		const timeout = new KioskIdleTimeout(1000, onIdle);
		timeout.start();
		vi.advanceTimersByTime(900);
		timeout.setPaused(true);
		vi.advanceTimersByTime(5000);
		expect(onIdle).not.toHaveBeenCalled();
		timeout.setPaused(false);
		vi.advanceTimersByTime(999);
		expect(onIdle).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(onIdle).toHaveBeenCalledOnce();
	});

	it('clears the pending deadline when stopped', () => {
		vi.useFakeTimers();
		const onIdle = vi.fn();
		const timeout = new KioskIdleTimeout(1000, onIdle);
		timeout.start();
		timeout.stop();
		vi.advanceTimersByTime(1000);
		expect(onIdle).not.toHaveBeenCalled();
	});
});
