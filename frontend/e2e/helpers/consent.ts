import type { Page } from '@playwright/test';
import { CONSENT_COPY } from '../../src/lib/features/consent/domain/consent-notice.i18n';

/** No-op when every member already has consent, because the block is then absent. */
export async function acceptFullConsent(page: Page): Promise<void> {
	const main = page.getByRole('checkbox', { name: CONSENT_COPY.main.short });
	if ((await main.count()) === 0) return;
	await main.check();
}
