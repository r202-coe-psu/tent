/// <reference types="node" />
import { defineConfig, devices } from '@playwright/test';

const stagingURL = process.env.E2E_BASE_URL ?? 'https://shelter.importstar.dev';

if (!/^https:\/\/[^\s/]+\/?$/.test(stagingURL)) {
	throw new Error('E2E_BASE_URL must be an HTTPS origin without a path');
}

/**
 * Staging release gate (e2e/README.md §9.C / layer 4):
 *   - run `@release` + `@smoke` across the suite tree
 *   - exclude `@quarantine`
 *   - workers=1; budget 15–30 min
 *
 * Remote `@critical` journeys (J2 W*, J3–J6) only run their live writes when this
 * process also has `ALLOW_REMOTE_WRITES=true` (set by `Jenkinsfile.e2e-staging`,
 * never `Jenkinsfile.prod`) — see `CAN_WRITE` in `e2e/helpers/e2e-env.ts`. Without
 * it they `test.skip` and appear as skipped, not failures. Staging `@smoke`/
 * `@release` that are read-only (incl. J1 + J2 navigation) always run.
 */
export default defineConfig({
	testDir: './e2e',
	testMatch: '**/*.test.ts',
	fullyParallel: false,
	forbidOnly: true,
	retries: process.env.CI ? 1 : 0,
	grep: /@release|@smoke/,
	grepInvert: /@quarantine/,
	workers: 1,
	timeout: 60_000,
	// 30 min wall clock for the full @release + @smoke remote set.
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
			args: ['--no-sandbox', '--disable-setuid-sandbox']
		}
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
