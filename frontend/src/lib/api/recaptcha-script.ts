/**
 * Make sure Google's reCAPTCHA Enterprise script is loaded and ready, injecting it on
 * demand.
 *
 * Pages only render the `<script>` tag when the status check said ON at mount. If the
 * operator switches reCAPTCHA on while the page is open, the status is ON at submit but
 * `window.grecaptcha` is missing — without this the form would have no token to send.
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

export function ensureRecaptchaLoaded(siteKey: string): Promise<boolean> {
	if (typeof window === 'undefined' || !siteKey) return Promise.resolve(false);
	if (isUsable()) return Promise.resolve(true);

	return new Promise<boolean>((resolve) => {
		const src = recaptchaScriptSrc(siteKey);
		let script = Array.from(document.scripts).find((s) => s.src === src) ?? null;
		let settled = false;
		const finish = (ok: boolean) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(ok && isUsable());
		};
		const timer = setTimeout(() => finish(false), LOAD_TIMEOUT_MS);

		if (!script) {
			script = document.createElement('script');
			script.src = src;
			script.async = true;
			script.defer = true;
			document.head.appendChild(script);
		}
		script.addEventListener('load', () => finish(true), { once: true });
		script.addEventListener('error', () => finish(false), { once: true });
		// Tag already on the page and finished loading between the check above and here.
		if (isUsable()) finish(true);
	});
}
