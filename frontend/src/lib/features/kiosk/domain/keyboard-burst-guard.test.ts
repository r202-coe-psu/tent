import { describe, expect, it } from 'vitest';
import { createBurstGuard } from './keyboard-burst-guard';

describe('createBurstGuard', () => {
	it('lets the first key through and flags the rest of a fast burst', () => {
		const guard = createBurstGuard(50);
		const flags = [0, 5, 10, 15, 20].map((time) => guard.isBurstKey(time));
		expect(flags).toEqual([false, true, true, true, true]);
	});

	it('does not flag a person typing slowly', () => {
		const guard = createBurstGuard(50);
		expect([0, 400, 900, 1500].map((time) => guard.isBurstKey(time))).toEqual([
			false,
			false,
			false,
			false
		]);
	});

	it('treats a gap equal to the limit as part of the burst, and a longer gap as a new one', () => {
		const guard = createBurstGuard(50);
		guard.isBurstKey(0);
		expect(guard.isBurstKey(50)).toBe(true);
		expect(guard.isBurstKey(101)).toBe(false);
	});

	it('flags keys swallowed earlier in the burst too, so the burst stays one unit', () => {
		const guard = createBurstGuard(50);
		const flags = [0, 40, 80, 120].map((time) => guard.isBurstKey(time));
		expect(flags).toEqual([false, true, true, true]);
	});
});
