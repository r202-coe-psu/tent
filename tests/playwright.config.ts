import { defineConfig } from '@playwright/test';
import { loadEnv } from './lib/env.ts';

loadEnv();

export default defineConfig({
	// The suites share seeded shelters and mint accounts per file: keep one worker.
	workers: 1,
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: 0,
	// The HTML report holds each test's video, step screenshots and trace for review.
	reporter: process.env.CI
		? [['list'], ['junit', { outputFile: 'test-results/junit.xml' }], ['html', { open: 'never' }]]
		: [['list'], ['html', { open: 'never' }]],
	projects: [
		{
			// Talks to CouchDB / FastAPI over HTTP only: no browser is launched or installed.
			name: 'api',
			testDir: './api'
		},
		{
			// Staff and public journeys in a real browser against a running app
			// (`pnpm dev` in frontend/). Every test keeps a video and a screenshot per step
			// so a reviewer can watch what was checked without rerunning it.
			name: 'e2e',
			testDir: './e2e',
			// The Vite dev server compiles modules on first request: allow a cold first page.
			timeout: 60_000,
			expect: { timeout: 15_000 },
			use: {
				browserName: 'chromium',
				baseURL: process.env.APP_BASE_URL?.trim() || 'http://localhost:5173',
				locale: 'th-TH',
				timezoneId: 'Asia/Bangkok',
				viewport: { width: 1366, height: 768 },
				video: { mode: 'on', size: { width: 1366, height: 768 } },
				screenshot: 'on',
				trace: 'retain-on-failure'
			}
		}
	]
});
