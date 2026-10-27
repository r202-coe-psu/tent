/**
 * Playwright fixtures for the Distribution suite.
 *
 * - `shelter` (worker): one `E2E Distribution …` shelter per worker, created through
 *   the system-management UI as the CouchDB admin, recorded in the purge ledger, and
 *   torn down with a zero-leak check when the worker ends (README §4.2/§4.3/§4.6).
 * - `scenarioAs(label, roles?)`: a scenario user on that shelter (default SM), the page
 *   signed in as it; its users and catalog items are deleted after the test.
 */

import { writeFileSync } from 'node:fs';
import { test as base } from '@playwright/test';
import { ulid } from '../../src/lib/db/ulid';
import { bootstrapAdminSession, routeBrowserCouchThroughApp } from '../helpers/couch';
import { clearSession, injectSession } from '../helpers/login';
import { recordCreatedShelter } from '../helpers/public-cleanup';
import { createShelterViaUi } from '../helpers/staff-ui';
import {
	assertCentralDbAccessReady,
	assertRunLeftNothing,
	cleanupDistributionScenario,
	createDistributionScenario,
	DISTRIBUTION_SHELTER_PREFIX,
	setShelterStoragePoints,
	teardownDistributionShelter,
	useShelter,
	warmShelterIndexes,
	type DistributionScenario,
	type StoragePointSeed
} from './distribution';

export { expect } from '@playwright/test';
export type { StoragePointSeed } from './distribution';

export interface DistributionShelter {
	code: string;
	name: string;
}

interface DistributionFixtures {
	/** Create a scenario user with `roles` (default SM on the run's shelter) and sign in as it. */
	scenarioAs: (label: string, roles?: string[]) => Promise<DistributionScenario>;
}

interface DistributionWorkerFixtures {
	shelter: DistributionShelter;
	/**
	 * Storage points (CR-139) written onto the run's own shelter right after it is created.
	 * Default none: the shelter then receives into the main store ("คลังหลัก"). A spec sets it with
	 * `test.use({ shelterStoragePoints: [[...points], { scope: 'worker' }] })` at the top level of
	 * the spec (a bare array would be read as Playwright's `[value, options]` pair); Playwright
	 * starts a separate worker (and so a separate shelter) for every distinct value.
	 */
	shelterStoragePoints: StoragePointSeed[];
}

export const test = base.extend<DistributionFixtures, DistributionWorkerFixtures>({
	shelterStoragePoints: [[], { scope: 'worker', option: true }],

	shelter: [
		async ({ browser, shelterStoragePoints }, use) => {
			const name = `${DISTRIBUTION_SHELTER_PREFIX} ${ulid().toLowerCase()}`;
			const admin = await bootstrapAdminSession();
			const context = await browser.newContext();
			let code: string;
			try {
				const page = await context.newPage();
				await routeBrowserCouchThroughApp(page);
				await injectSession(page, admin.user, admin.cookie);
				code = await createShelterViaUi(page, {
					name,
					siteKind: 'evacuation_center',
					lat: 7.006,
					lng: 100.498,
					subdistrict: 'คอหงส์',
					capacity: 40
				});
				recordCreatedShelter(code);
			} finally {
				await context.close();
			}
			useShelter(code);
			// Before any test page loads, so the app never caches a point-less shelter doc.
			if (shelterStoragePoints.length > 0) {
				try {
					await setShelterStoragePoints(code, shelterStoragePoints);
				} catch (error) {
					// The shelter exists already; do not strand it because setup failed.
					await teardownDistributionShelter(code);
					throw error;
				}
			}
			await warmShelterIndexes(code);
			await assertCentralDbAccessReady();

			await use({ code, name });

			await teardownDistributionShelter(code);
			await assertRunLeftNothing(code);
		},
		{ scope: 'worker', timeout: 60_000 }
	],

	scenarioAs: async ({ page, shelter }, use, testInfo) => {
		useShelter(shelter.code);
		await routeBrowserCouchThroughApp(page);
		const created: DistributionScenario[] = [];
		// README §5 hygiene: keep failed calls, page errors and console errors; attached on failure.
		const failedCalls: string[] = [];
		page.on('response', (res) => {
			if (res.status() >= 400) {
				failedCalls.push(`${res.status()} ${res.request().method()} ${res.url()}`);
			}
		});
		page.on('pageerror', (error) => failedCalls.push(`pageerror ${error.stack ?? error.message}`));
		page.on('console', (msg) => {
			if (msg.type() === 'error') failedCalls.push(`console.error ${msg.text()}`);
		});

		await use(async (label, roles) => {
			const scenario = await createDistributionScenario(label, roles ? { roles } : {});
			created.push(scenario);
			await injectSession(page, scenario.user, scenario.session);
			return scenario;
		});

		if (testInfo.status !== testInfo.expectedStatus) {
			const path = testInfo.outputPath('failed-calls.txt');
			writeFileSync(path, [`final url: ${page.url()}`, ...failedCalls].join('\n'));
			await testInfo.attach('failed-calls', { path, contentType: 'text/plain' });
		}
		// Unroute first: a long-poll `_changes` still in flight must not reach a disposed context.
		await page.unrouteAll({ behavior: 'ignoreErrors' });
		await clearSession(page).catch(() => undefined);
		const failures: unknown[] = [];
		for (const scenario of created) {
			try {
				await cleanupDistributionScenario(scenario);
			} catch (error) {
				failures.push(error);
			}
		}
		if (failures.length > 0) {
			throw new AggregateError(failures, 'Distribution scenario cleanup failed');
		}
	}
});
