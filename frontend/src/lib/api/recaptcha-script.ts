/**
 * Make sure Google's reCAPTCHA Enterprise script is loaded and ready, injecting it on
 * demand.
 *
 * Pages only render the `<script>` tag when the status check said ON at mount. If the
 * operator switches reCAPTCHA on while the page is open, the status is ON at submit but
 * `window.grecaptcha` is missing — without this the form would have no token to send.
 *
 * A matching tag that is already on the page while `grecaptcha` is still unusable is treated
 * as stale (it failed, was aborted, or finished without exposing `grecaptcha`): its `load` /
 * `error` events have already fired and will not fire again, so it is replaced with a fresh
 * tag whose events can be observed. Concurrent calls for the same key share one in-flight load.
 *
 * Resolves `true` once `grecaptcha` can execute, `false` if the script could not load
 * (blocked, offline, timed out).
 */

const LOAD_TIMEOUT_MS = 10_000;

export function recaptchaScriptSrc(siteKey: string): string {
	return `https://www.google.com/recaptcha/enterprise.js?render=${encodeURIComponent(siteKey)}`;
}

function isUsable(): boolean {
	const g = window.grecaptcha;
	return Boolean(g?.enterprise || g?.execute);
}

const inflight = new Map<string, Promise<boolean>>();

function loadScript(src: string): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		let settled = false;
		const finish = (ok: boolean) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(ok && isUsable());
		};
		const timer = setTimeout(() => finish(false), LOAD_TIMEOUT_MS);

		// Any existing tag is stale (see the doc comment) — its events will not fire again.
		for (const stale of Array.from(document.scripts).filter((s) => s.src === src)) stale.remove();

		const script = document.createElement('script');
		script.src = src;
		script.async = true;
		script.defer = true;
		script.addEventListener('load', () => finish(true), { once: true });
		script.addEventListener('error', () => finish(false), { once: true });
		document.head.appendChild(script);
	});
}

export function ensureRecaptchaLoaded(siteKey: string): Promise<boolean> {
	if (typeof window === 'undefined' || !siteKey) return Promise.resolve(false);
	if (isUsable()) return Promise.resolve(true);

	const src = recaptchaScriptSrc(siteKey);
	let pending = inflight.get(src);
	if (!pending) {
		pending = loadScript(src).finally(() => inflight.delete(src));
		inflight.set(src, pending);
	}
	return pending;
}

/**
 * A fresh reCAPTCHA token for `action`, loading the script first if the page has not.
 * `window.__captchaToken` (e2e) wins. Resolves `null` when no token can be had — no site
 * key, the script would not load, or `execute` threw — so the caller can say so.
 */
export async function executeRecaptcha(siteKey: string, action: string): Promise<string | null> {
	if (typeof window === 'undefined') return null;
	if (window.__captchaToken) return window.__captchaToken;
	if (!(await ensureRecaptchaLoaded(siteKey))) return null;
	const g = window.grecaptcha;
	try {
		if (g?.enterprise) {
			const enterprise = g.enterprise;
			await new Promise<void>((resolve) => enterprise.ready(() => resolve()));
			return await enterprise.execute(siteKey, { action });
		}
		if (g?.execute) return await g.execute(siteKey, { action });
	} catch {
		return null;
	}
	return null;
}
