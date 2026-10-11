/// <reference types="node" />
import { defineConfig } from '@playwright/test';
import stagingConfig from './playwright.staging.config';

/**
 * Production post-deploy smoke (e2e/README.md §9.C / layer 5):
 * read-only `@prod` subset only (< 2 min). Never writes.
 *
 * E2E_BASE_URL is required — production origin under test.
 */
if (!process.env.E2E_BASE_URL) {
	throw new Error('E2E_BASE_URL must be set for the production smoke run');
}

export default defineConfig({
	...stagingConfig,
	grep: /@prod/,
	grepInvert: /@quarantine/,
	retries: 0,
	globalTimeout: 120_000,
	timeout: 30_000,
	outputDir: 'test-results/prod',
	reporter: [
		['list'],
		['html', { outputFolder: 'playwright-report/prod', open: 'never' }],
		['junit', { outputFile: 'test-results/prod/junit.xml' }]
	]
});
