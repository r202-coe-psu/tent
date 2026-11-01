// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureRecaptchaLoaded, executeRecaptcha, recaptchaScriptSrc } from './recaptcha-script';

const KEY = 'site-key';
const SRC = recaptchaScriptSrc(KEY);

// happy-dom fires `error` on its own for any script it cannot fetch. Give injected tags a
// non-JS type so it leaves them alone and each test drives load/error by hand.
function makeInjectedScriptsInert() {
	const append = document.head.appendChild.bind(document.head);
	vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
		if (node instanceof HTMLScriptElement) node.type = 'text/inert';
		return append(node);
	});
}

function tags(): HTMLScriptElement[] {
	return Array.from(document.scripts).filter((s) => s.src === SRC);
}

describe('ensureRecaptchaLoaded', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		document.head.innerHTML = '';
		makeInjectedScriptsInert();
		delete window.grecaptcha;
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		delete window.grecaptcha;
	});

	it('resolves false for an empty site key without touching the DOM', async () => {
		expect(await ensureRecaptchaLoaded('')).toBe(false);
		expect(tags()).toHaveLength(0);
	});

	it('resolves true immediately when grecaptcha is already usable', async () => {
		window.grecaptcha = { execute: async () => 'tok' };
		expect(await ensureRecaptchaLoaded(KEY)).toBe(true);
		expect(tags()).toHaveLength(0);
	});

	it('injects the tag and resolves true once it loads and grecaptcha is usable', async () => {
		const p = ensureRecaptchaLoaded(KEY);
		expect(tags()).toHaveLength(1);
		window.grecaptcha = { execute: async () => 'tok' };
		tags()[0].dispatchEvent(new Event('load'));
		expect(await p).toBe(true);
	});

	it('resolves false when the injected tag errors', async () => {
		const p = ensureRecaptchaLoaded(KEY);
		tags()[0].dispatchEvent(new Event('error'));
		expect(await p).toBe(false);
	});

	it('resolves false when the tag loads but grecaptcha is still unusable', async () => {
		const p = ensureRecaptchaLoaded(KEY);
		tags()[0].dispatchEvent(new Event('load'));
		expect(await p).toBe(false);
	});

	it('replaces a stale tag and settles on the new tag error, not the timeout', async () => {
		const stale = document.createElement('script');
		stale.src = SRC;
		stale.type = 'text/inert';
		document.head.appendChild(stale);

		let result: boolean | undefined;
		const p = ensureRecaptchaLoaded(KEY).then((ok) => (result = ok));

		const fresh = tags();
		expect(fresh).toHaveLength(1);
		expect(fresh[0]).not.toBe(stale);

		fresh[0].dispatchEvent(new Event('error'));
		await p;
		expect(result).toBe(false);
		// No timer left over from the 10s fallback.
		expect(vi.getTimerCount()).toBe(0);
	});

	it('shares one load between concurrent callers', async () => {
		const a = ensureRecaptchaLoaded(KEY);
		const b = ensureRecaptchaLoaded(KEY);
		expect(tags()).toHaveLength(1);
		window.grecaptcha = { execute: async () => 'tok' };
		tags()[0].dispatchEvent(new Event('load'));
		expect(await Promise.all([a, b])).toEqual([true, true]);
	});

	it('falls back to false after the timeout when no event ever fires', async () => {
		const p = ensureRecaptchaLoaded(KEY);
		await vi.advanceTimersByTimeAsync(10_000);
		expect(await p).toBe(false);
	});

	it('starts a fresh load after a previous one settled', async () => {
		const first = ensureRecaptchaLoaded(KEY);
		tags()[0].dispatchEvent(new Event('error'));
		expect(await first).toBe(false);

		const second = ensureRecaptchaLoaded(KEY);
		expect(tags()).toHaveLength(1);
		tags()[0].dispatchEvent(new Event('error'));
		expect(await second).toBe(false);
	});
});

describe('executeRecaptcha', () => {
	afterEach(() => {
		delete window.grecaptcha;
		delete window.__captchaToken;
	});

	it('prefers the token e2e injected', async () => {
		window.__captchaToken = 'e2e-token';
		expect(await executeRecaptcha(KEY, 'donation_lookup')).toBe('e2e-token');
	});

	it('runs the enterprise client for the action', async () => {
		const execute = vi.fn().mockResolvedValue('enterprise-token');
		window.grecaptcha = { enterprise: { ready: (cb) => void cb(), execute } };

		expect(await executeRecaptcha(KEY, 'donation_lookup')).toBe('enterprise-token');
		expect(execute).toHaveBeenCalledWith(KEY, { action: 'donation_lookup' });
	});

	it('resolves null when execute throws', async () => {
		window.grecaptcha = {
			enterprise: { ready: (cb) => void cb(), execute: vi.fn().mockRejectedValue(new Error('x')) }
		};
		expect(await executeRecaptcha(KEY, 'donation_lookup')).toBeNull();
	});

	it('resolves null without a site key', async () => {
		expect(await executeRecaptcha('', 'donation_lookup')).toBeNull();
	});
});
