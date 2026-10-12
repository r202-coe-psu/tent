import { ensureRecaptchaLoaded } from '$lib/api/recaptcha-script';

/**
 * Browser reCAPTCHA token for the staff `login` action — shared by the password form and
 * link-on-first-login (CR-141). `''` = captcha off / script absent; `null` = execute failed.
 */
export async function executeLoginCaptcha(
	siteKey: string,
	enabled: boolean
): Promise<string | null> {
	const injected = window.__captchaToken || '';
	if (injected) return injected;
	if (!enabled) return '';
	// The page may have mounted while reCAPTCHA was off (no script tag) — load it now.
	await ensureRecaptchaLoaded(siteKey);
	const win = window;
	if (win.grecaptcha) {
		try {
			const action = 'login';
			if (win.grecaptcha.enterprise) {
				await new Promise<void>((resolve) => win.grecaptcha!.enterprise!.ready(() => resolve()));
				return await win.grecaptcha.enterprise.execute(siteKey, { action });
			}
			if (win.grecaptcha.execute) {
				return await win.grecaptcha.execute(siteKey, { action });
			}
		} catch {
			return null;
		}
	}
	return '';
}
