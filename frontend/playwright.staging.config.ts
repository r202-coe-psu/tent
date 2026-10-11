/// <reference types="node" />
import { defineConfig, devices } from '@playwright/test';

const stagingURL = process.env.E2E_BASE_URL ?? 'https://shelter.importstar.dev';

if (!/^https:\/\/[^\s/]+\/?$/.test(stagingURL)) {
	throw new Error('E2E_BASE_URL must be an HTTPS origin without a path');
}

/**
 * Staging release gate (e2e/README.md §9.C / layer 4):
 *   - `testMatch` names exactly the suites that carry `@critical` or `@smoke`
 *     anywhere in the file — an explicit allowlist, not `**\/*.test.ts` + grep.
 *     Playwright must statically import every file `testMatch` names (to build
 *     its list before `grep` filters anything), so scoping it this tightly means
 *     an unrelated suite elsewhere in e2e/ (e.g. distribution/, sop-parameters/,
 *     stock-inventory.test.ts — none of them staging-tagged) can never break this
 *     config just by failing to resolve its own imports. Add a file here only
 *     when it gains a `@critical` or `@smoke` tag.
 *   - `grep` then picks the individual `@critical`/`@smoke` tests inside those
 *     files (not scoped to `@release` — this also surfaces `@critical` suites
 *     outside the six release journeys, e.g. the live-results describes in
 *     public-search-flow / public-shelters-filter, and public-home-flow as skipped
 *     rather than absent)
 *   - exclude `@quarantine`
 *   - workers=1; budget 15–30 min
 *
 * `@critical` suites only run their live writes when this process also has
 * `ALLOW_REMOTE_WRITES=true` — set via the `tent-staging-e2e-env` Jenkins
 * credential (`e2e/.env.example` documents it), never `tent-prod-e2e-env` — see
 * `CAN_WRITE` in `e2e/helpers/e2e-env.ts`. public-search-flow and
 * public-shelters-filter create and tear down their own per-run data like the
 * other `@critical` suites (each ends with a zero-leak Z test), so they need no
 * provisioned fixture on a writable run. public-home-flow is still gated on
 * `IS_REMOTE` directly (a live critical need would invite real donations) and
 * stays `test.skip` regardless of `ALLOW_REMOTE_WRITES`.
 *
 * The donation suites (`donation-fullstack*.test.ts`, `stock-donations.test.ts`; tag
 * `@donation`) follow the same rule: own `E2E Donation …` shelter, ledger teardown, a
 * zero-leak Z test. They flip the global reCAPTCHA switch off for their run and restore
 * it in afterAll, and pace their bookings to the BFF's 3/min/IP limiter, so the three
 * full-stack files add an estimated 10-15 minutes to a writable run (see e2e/README.md §9.C).
 */
export default defineConfig({
	testDir: './e2e',
	testMatch: [
		'back-office-evacuee-management.test.ts',
		'donation-fullstack-admin.test.ts',
		'donation-fullstack-race.test.ts',
		'donation-fullstack.test.ts',
		'onsite-stations-flow.test.ts',
		'public-home-flow.test.ts',
		'public-portal.test.ts',
		'public-pre-register-flow.test.ts',
		'public-search-flow.test.ts',
		'public-shelters-filter.test.ts',
		'staging/smoke.test.ts',
		'stock-donations.test.ts',
		'system-admin-shelter.test.ts'
	],
	fullyParallel: false,
	forbidOnly: true,
	retries: process.env.CI ? 1 : 0,
	grep: /@critical|@smoke/,
	grepInvert: /@quarantine/,
	workers: 1,
	timeout: 60_000,
	// 30 min wall clock for the full @critical + @smoke remote set.
	globalTimeout: 1_800_000,
	expect: { timeout: 15_000 },
	outputDir: 'test-results/staging',
	reporter: [
		['list'],
		['html', { outputFolder: 'playwright-report/staging', open: 'never' }],
		['junit', { outputFile: 'test-results/staging/junit.xml' }]
	],
	use: {
		baseURL: stagingURL,
		ignoreHTTPSErrors: false,
		trace: 'off',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure',
		actionTimeout: 15_000,
		navigationTimeout: 30_000,
		launchOptions: {
			args: ['--no-sandbox', '--disable-setuid-sandbox'],
			// Local debugging only: PW_SLOWMO=500 --headed to watch a run in a real
			// browser window (same var name as playwright.config.ts). Unset in CI, so
			// this never changes the pipeline's timing. PW_SLOW_MO (underscore) is
			// accepted too, for `.env`/`.env.staging` files written before this rename.
			slowMo: process.env.PW_SLOWMO
				? Number(process.env.PW_SLOWMO)
				: process.env.PW_SLOW_MO
					? Number(process.env.PW_SLOW_MO)
					: undefined
		}
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
