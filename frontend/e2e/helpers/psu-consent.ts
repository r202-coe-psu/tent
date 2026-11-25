import type { Page } from '@playwright/test';

/**
 * PSU cookie-consent banner (app.html loads `web-consent.psu.ac.th/static/js/psu-consent.min.js`).
 * Its API answers 403 / no CORS header for hosts that are not registered against the site key
 * (staging) and can hang page load while it retries, so any page that loads it would log console
 * errors or never fire `load`. It is third-party and not under test here, so serve an empty script:
 * `window.PSUConsent` stays undefined, app.html's loader returns early and nothing else is requested.
 */
const PSU_CONSENT_URL = /^https:\/\/web-consent\.psu\.ac\.th\//;

export function stubPsuConsent(page: Page): Promise<void> {
	return page.route(PSU_CONSENT_URL, (route) =>
		route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
	);
}
