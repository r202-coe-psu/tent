import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

const mockEnv = vi.hoisted(() => ({ env: {} as Record<string, string | undefined> }));
vi.mock('$env/dynamic/private', () => mockEnv);

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

describe('RATE_LIMIT switch (CR-160)', () => {
	const exhaust = (limiter: RateLimiter, key: string) => {
		for (let i = 0; i < 3; i++) limiter.check(key);
	};

	afterEach(() => {
		delete mockEnv.env.RATE_LIMIT;
	});

	describe('unset or any value other than false/0', () => {
		it('enforces a bypassable limiter when RATE_LIMIT is unset (4th booking is blocked)', () => {
			const limiter = new RateLimiter(60000, 3, { bypassable: true });
			exhaust(limiter, 'sw-unset');
			expect(limiter.check('sw-unset')).toBe(false);
		});

		it.each(['true', '', 'off', 'no', 'garbage', '1'])(
			'enforces every limiter when RATE_LIMIT=%j',
			(value) => {
				mockEnv.env.RATE_LIMIT = value;
				for (const bypassable of [true, false]) {
					const limiter = new RateLimiter(60000, 3, { bypassable });
					const key = `sw-garbage-${bypassable}`;
					exhaust(limiter, key);
					expect(limiter.check(key)).toBe(false);
				}
			}
		);
	});

	describe('RATE_LIMIT=false|0 on a bypassable limiter', () => {
		it.each(['false', 'FALSE', ' False ', '0'])('never blocks when RATE_LIMIT=%j', (value) => {
			mockEnv.env.RATE_LIMIT = value;
			const limiter = new RateLimiter(60000, 3, { bypassable: true });
			for (let i = 0; i < 10; i++) expect(limiter.check('203.0.113.7')).toBe(true);
		});

		it('records no hit while bypassed, so re-enabling starts clean', () => {
			const limiter = new RateLimiter(60000, 3, { bypassable: true });
			mockEnv.env.RATE_LIMIT = 'false';
			for (let i = 0; i < 10; i++) limiter.check('sw-reenable');
			delete mockEnv.env.RATE_LIMIT;
			exhaust(limiter, 'sw-reenable');
			// Three fresh hits were allowed, so only the 4th is refused — none were stored earlier.
			expect(limiter.check('sw-reenable')).toBe(false);
		});

		it('works through the real donation / pre-register instances', async () => {
			mockEnv.env.RATE_LIMIT = 'false';
			const { donationIpLimiter, registerIpLimiter } = await import('./rate-limiter');
			for (const limiter of [donationIpLimiter, registerIpLimiter]) {
				const key = `sw-real-${Math.random()}`;
				for (let i = 0; i < 20; i++) expect(limiter.check(key)).toBe(true);
			}
		});
	});

	describe('RATE_LIMIT=false on a non-bypassable limiter', () => {
		it('a limiter built without options still blocks', () => {
			mockEnv.env.RATE_LIMIT = 'false';
			const limiter = new RateLimiter(60000, 3);
			expect(limiter.bypassable).toBe(false);
			exhaust(limiter, 'sw-default');
			expect(limiter.check('sw-default')).toBe(false);
		});

		it('auth and volunteer instances keep blocking (CR-160 acceptance)', async () => {
			mockEnv.env.RATE_LIMIT = 'false';
			const mod = await import('./rate-limiter');
			const cases: [RateLimiter, number][] = [
				[mod.loginCaptchaIpLimiter, 10],
				[mod.loginResolveIpLimiter, 10],
				[mod.thirdPartyClientSecretRevealLimiter, 10],
				[mod.linkAccountIpLimiter, 10],
				[mod.volunteerApplyIpLimiter, 3]
			];
			for (const [limiter, max] of cases) {
				const key = `sw-closed-${Math.random()}`;
				for (let i = 0; i < max; i++) expect(limiter.check(key)).toBe(true);
				expect(limiter.check(key)).toBe(false);
			}
		});
	});

	it('only the donation and pre-register limiters are bypassable — new limiters default closed', async () => {
		const mod = (await import('./rate-limiter')) as Record<string, unknown>;
		const bypassable = Object.entries(mod)
			.filter(([, v]) => v instanceof RateLimiter && v.bypassable)
			.map(([name]) => name)
			.sort();
		const closed = Object.entries(mod)
			.filter(([, v]) => v instanceof RateLimiter && !v.bypassable)
			.map(([name]) => name)
			.sort();

		expect(bypassable).toEqual([
			'donationEditLimiter',
			'donationIpLimiter',
			'donationPhoneLimiter',
			'donationReadLimiter',
			'registerIpLimiter',
			'registerLookupIpLimiter',
			'registerPhoneLimiter'
		]);
		expect(closed).toEqual([
			'donationSlotsLimiter',
			'kioskPhoneDeviceLimiter',
			'kioskPhoneNumberLimiter',
			'kioskRegisterDeviceLimiter',
			'kioskThaidSessionDeviceLimiter',
			'linkAccountIpLimiter',
			'linkAccountNonceLimiter',
			'loginCaptchaIpLimiter',
			'loginResolveIpLimiter',
			'thirdPartyClientSecretRevealLimiter',
			'volunteerApplyIpLimiter',
			'volunteerApplyPhoneLimiter',
			'volunteerDispatchRespondLimiter',
			'volunteerProfileUpdateLimiter',
			'volunteerTicketFindLimiter',
			'volunteerTicketLimiter'
		]);
	});
});
