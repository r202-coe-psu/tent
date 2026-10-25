import type { Page } from '@playwright/test';
import { CONSENT_COPY } from '../../src/lib/features/consent/domain/consent-notice.i18n';

/**
 * Ticks the PDPA main checkbox (C1) at the end of an onsite registration / report-in form.
 * A no-op when the block is absent, i.e. every member in the form already has consent.
 */
export async function acceptFullConsent(page: Page): Promise<void> {
	const main = page.getByRole('checkbox', { name: CONSENT_COPY.main.text });
	if ((await main.count()) === 0) return;
	await main.check();
}
