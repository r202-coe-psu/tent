import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RateLimiter } from './rate-limiter';

describe('RateLimiter', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('should allow requests within the limit', () => {
		const limiter = new RateLimiter(60000, 3);
		expect(limiter.check('ip1')).toBe(true);
		expect(limiter.check('ip1')).toBe(true);
		expect(limiter.check('ip1')).toBe(true);
	});

	it('should block requests exceeding the limit', () => {
		const limiter = new RateLimiter(60000, 3);
		expect(limiter.check('ip2')).toBe(true);
		expect(limiter.check('ip2')).toBe(true);
		expect(limiter.check('ip2')).toBe(true);
		// 4th request in the same window
		expect(limiter.check('ip2')).toBe(false);
	});

	it('should allow requests after the window expires', () => {
		const limiter = new RateLimiter(60000, 3);
		limiter.check('ip3');
		limiter.check('ip3');
		limiter.check('ip3');
		expect(limiter.check('ip3')).toBe(false); // blocked

		// fast-forward 61 seconds
		vi.advanceTimersByTime(61000);

		expect(limiter.check('ip3')).toBe(true); // allowed again
	});

	it('should treat different keys independently', () => {
		const limiter = new RateLimiter(60000, 3);
		limiter.check('ip4');
		limiter.check('ip4');
		limiter.check('ip4');

		expect(limiter.check('ip4')).toBe(false); // ip4 blocked
		expect(limiter.check('ip5')).toBe(true); // ip5 allowed
	});
});
