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

describe('donation limiter budgets', () => {
	/**
	 * These were one shared 3-per-minute limiter, which made a single edit cost three
	 * requests — open the ticket, save, refetch — so a donor could edit once a minute
	 * at best. CR-080 says they may edit as often as they like, bounded only by the IP
	 * limit, so the budgets are split by what each surface actually exposes.
	 */
	it('keeps creating a booking tight, since that is the abuse vector', async () => {
		const { donationIpLimiter, donationPhoneLimiter } = await import('./rate-limiter');
		for (const limiter of [donationIpLimiter, donationPhoneLimiter]) {
			const key = `create-${Math.random()}`;
			expect([1, 2, 3].map(() => limiter.check(key))).toEqual([true, true, true]);
			expect(limiter.check(key)).toBe(false);
		}
	});

	it('leaves room to edit a booking more than once a minute', async () => {
		const { donationEditLimiter } = await import('./rate-limiter');
		const key = `edit-${Math.random()}`;
		// One edit costs a save plus the refetch that follows it.
		expect(Array.from({ length: 10 }, () => donationEditLimiter.check(key))).not.toContain(false);
		expect(donationEditLimiter.check(key)).toBe(false);
	});

	it('does not let reading your own ticket eat the write budget', async () => {
		const { donationEditLimiter, donationReadLimiter } = await import('./rate-limiter');
		const key = `read-${Math.random()}`;
		for (let i = 0; i < 20; i++) donationReadLimiter.check(key);
		// Reads are idempotent and token-gated; they must not spend what edits need.
		expect(donationEditLimiter.check(key)).toBe(true);
	});

	it('still caps reads, since each one reaches FastAPI and Mongo', async () => {
		const { donationReadLimiter } = await import('./rate-limiter');
		const key = `read-cap-${Math.random()}`;
		for (let i = 0; i < 30; i++) donationReadLimiter.check(key);
		expect(donationReadLimiter.check(key)).toBe(false);
	});
});
