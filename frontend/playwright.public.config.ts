/// <reference types="node" />
import { defineConfig } from '@playwright/test';
import stagingConfig from './playwright.staging.config';

// Remote run of the public-plane suites: READ-ONLY against the provisioned E2E fixture
// (see e2e/helpers/e2e-env.ts). Inherits every runner setting from the Staging config
// and swaps only the test list and output paths.
//
// E2E_BASE_URL is required — it is what switches the suites to read-only, so falling
// back to the Staging default URL would let the local-only setup steps write there.
if (!process.env.E2E_BASE_URL) {
	throw new Error('E2E_BASE_URL must be set for the public-plane remote run');
}

export default defineConfig({
	...stagingConfig,
	testMatch: [
		'**/public-home-flow.test.ts',
		'**/public-pre-register-flow.test.ts',
		'**/public-search-flow.test.ts',
		'**/public-shelters-filter.test.ts'
	],
	globalTimeout: 480_000,
	outputDir: 'test-results/public',
	reporter: [
		['list'],
		['html', { outputFolder: 'playwright-report/public', open: 'never' }],
		['junit', { outputFile: 'test-results/public/junit.xml' }]
	]
});
