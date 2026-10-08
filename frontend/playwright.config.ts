/// <reference types="node" />
import { defineConfig, devices } from '@playwright/test';

const APP_BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL ?? 'http://localhost:4173';

export default defineConfig({
	testDir: './e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	// §3 / §9.B — suites tagged @quarantine (e.g. SH001 live writers) stay out of default runs.
	grepInvert: /@quarantine/,
	// User management access-control tests call CouchDB directly (no parallelism
	// issues since each test uses unique usernames with a RUN_ID suffix).
	workers: 1,
	reporter: 'html',
	use: {
		baseURL: APP_BASE_URL,
		trace: 'on-first-retry',
		video: process.env.PW_VIDEO ? 'on' : 'off',
		launchOptions: {
			args: ['--no-sandbox', '--disable-setuid-sandbox'],
			slowMo: process.env.PW_SLOWMO ? parseInt(process.env.PW_SLOWMO, 10) : 0
		}
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: [
		{
			command: 'node e2e/mock-api.js',
			url: 'http://localhost:9001/v1/health',
			reuseExistingServer: !process.env.CI,
			timeout: 15_000
		},
		{
			// Pass the admin URL so the SvelteKit BFF can reach CouchDB.
			// COUCHDB_ADMIN_URL can be overridden via CI env; defaults to local dev value.
			command: `COUCHDB_ADMIN_URL=${process.env.COUCHDB_ADMIN_URL ?? 'http://admin:password@localhost:5984'} pnpm preview`,
			url: APP_BASE_URL,
			reuseExistingServer: !process.env.CI,
			timeout: 60_000,
			env: {
				COUCHDB_ADMIN_URL: process.env.COUCHDB_ADMIN_URL ?? 'http://admin:password@localhost:5984',
				SECRET_RECAPTCHA_KEY: process.env.SECRET_RECAPTCHA_KEY ?? 'e2e-recaptcha-secret',
				// Public shelter bookings write as the limited `public_writer` user (production mode
				// has no admin fallback) — pre-register W5 needs it, see .env.example.
				...(process.env.COUCHDB_PUBLIC_WRITER_URL
					? { COUCHDB_PUBLIC_WRITER_URL: process.env.COUCHDB_PUBLIC_WRITER_URL }
					: {})
			}
		}
	]
});
