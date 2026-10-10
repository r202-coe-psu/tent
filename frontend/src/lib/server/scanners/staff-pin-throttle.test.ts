import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	STAFF_PIN_ALERT_EVERY,
	STAFF_PIN_WRONG_DELAY_MS,
	StaffPinThrottle
} from './staff-pin-throttle';
import type { StaffPinVerifyResult } from './staff-pin';

const OK: StaffPinVerifyResult = { kind: 'ok' };
const WRONG: StaffPinVerifyResult = { kind: 'wrong' };
const NOT_SET: StaffPinVerifyResult = { kind: 'not_set' };

/** Settles `promise` and reports whether it had settled once the timers moved `ms` forward. */
async function settledAfter(promise: Promise<unknown>, ms: number): Promise<boolean> {
	let settled = false;
	void promise.then(
		() => (settled = true),
		() => (settled = true)
	);
	await vi.advanceTimersByTimeAsync(ms);
	return settled;
}

describe('StaffPinThrottle', () => {
	let warn: ReturnType<typeof vi.fn<(line: string) => void>>;
	let throttle: StaffPinThrottle;

	beforeEach(() => {
		vi.useFakeTimers();
		warn = vi.fn<(line: string) => void>();
		throttle = new StaffPinThrottle({ warn });
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('answers a right PIN at once', async () => {
		const result = throttle.run('kiosk-01', async () => OK);
		expect(await settledAfter(result, 0)).toBe(true);
		await expect(result).resolves.toEqual(OK);
	});

	it('holds a wrong PIN for about a second before answering', async () => {
		const result = throttle.run('kiosk-01', async () => WRONG);
		expect(await settledAfter(result, STAFF_PIN_WRONG_DELAY_MS - 1)).toBe(false);
		expect(await settledAfter(result, 1)).toBe(true);
		await expect(result).resolves.toEqual(WRONG);
	});

	it('checks one PIN at a time per device, so parallel guesses wait their turn', async () => {
		const checks: number[] = [];
		const runs = [1, 2, 3].map((n) =>
			throttle.run('kiosk-01', async () => {
				checks.push(n);
				return WRONG;
			})
		);
		const all = Promise.all(runs);

		expect(await settledAfter(all, STAFF_PIN_WRONG_DELAY_MS * 3 - 1)).toBe(false);
		expect(checks).toEqual([1, 2, 3]);
		expect(await settledAfter(all, 1)).toBe(true);
	});

	it('does not make one device wait for another', async () => {
		void throttle.run('kiosk-01', async () => WRONG);
		const other = throttle.run('kiosk-02', async () => OK);
		expect(await settledAfter(other, 0)).toBe(true);
	});

	it('warns on every fifth wrong PIN in a row, without the PIN', async () => {
		for (let i = 0; i < STAFF_PIN_ALERT_EVERY * 2; i += 1) {
			const result = throttle.run('kiosk-01', async () => WRONG);
			await vi.advanceTimersByTimeAsync(STAFF_PIN_WRONG_DELAY_MS);
			await result;
			const expected = Math.floor((i + 1) / STAFF_PIN_ALERT_EVERY);
			expect(warn).toHaveBeenCalledTimes(expected);
		}
		expect(warn.mock.calls[0][0]).toContain('device=kiosk-01');
		expect(warn.mock.calls[0][0]).toContain('consecutive=5');
		expect(warn.mock.calls[1][0]).toContain('consecutive=10');
	});

	it('starts counting again after a right PIN', async () => {
		for (let i = 0; i < STAFF_PIN_ALERT_EVERY - 1; i += 1) {
			const result = throttle.run('kiosk-01', async () => WRONG);
			await vi.advanceTimersByTimeAsync(STAFF_PIN_WRONG_DELAY_MS);
			await result;
		}
		await throttle.run('kiosk-01', async () => OK);
		const result = throttle.run('kiosk-01', async () => WRONG);
		await vi.advanceTimersByTimeAsync(STAFF_PIN_WRONG_DELAY_MS);
		await result;
		expect(warn).not.toHaveBeenCalled();
	});

	it('neither delays nor counts a device with no PIN or a failed check', async () => {
		const notSet = throttle.run('kiosk-01', async () => NOT_SET);
		expect(await settledAfter(notSet, 0)).toBe(true);

		const failed = throttle.run('kiosk-01', async () => {
			throw new Error('store down');
		});
		await expect(failed).rejects.toThrow('store down');

		// The failure released the device: the next check runs at once.
		const next = throttle.run('kiosk-01', async () => OK);
		expect(await settledAfter(next, 0)).toBe(true);
	});
});
