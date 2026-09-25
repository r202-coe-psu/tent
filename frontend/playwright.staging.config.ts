/// <reference types="node" />
import { defineConfig, devices } from '@playwright/test';

const stagingURL = process.env.STAGING_URL ?? 'https://shelter.importstar.dev';

export default defineConfig({
	testDir: './e2e/staging',
	fullyParallel: false,
	forbidOnly: true,
	retries: process.env.CI ? 1 : 0,
	workers: 1,
	timeout: 60_000,
	globalTimeout: 120_000,
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
