/**
 * E2E: registration back-office pages on a phone (#1347) — mocked Couch + mocked overview API;
 * `@regression`. At 390x844 the household flows and the pre-registration overview stay inside
 * the viewport, and the pre-registration list renders cards instead of a 9-column table.
 *
 * Run (rebuild first — matches package.json test:e2e):
 *   pnpm exec vite build --mode test && pnpm playwright test e2e/registration-mobile.test.ts
 */

import { test, expect, type Page } from '@playwright/test';
import {
	createCouchUser,
	seedSecurityQuestion,
	deleteCouchUser,
	couchLogin,
	SA_ROLES,
	SM_SH001_ROLES
} from './helpers/couch';
import { injectSession, clearSession } from './helpers/login';
import { mockCouchRoutes } from './helpers/mock-couch';

const RUN_ID = Date.now().toString(36);

const ADMIN = {
	name: `reg_mobile_sa_${RUN_ID}`,
	password: 'Password1!',
	roles: SA_ROLES,
	display_name: 'Registration Mobile Admin E2E'
};

const MANAGER = {
	name: `reg_mobile_sm_${RUN_ID}`,
	password: 'Password1!',
	roles: SM_SH001_ROLES,
	display_name: 'Registration Mobile Manager E2E'
};

const LONG_NAME =
	'ประสิทธิ์ภาพความเจริญรุ่งเรืองยั่งยืนมั่นคงศรีสวัสดิ์พิพัฒน์ วงศ์สกุลเจริญสุขสมบูรณ์พูนผล';

function preRegItem(id: string, source: 'unassigned' | 'bound') {
	return {
		id,
		source,
		display_name: LONG_NAME,
		household_id: 'household:01MOBILEPREREGHH000000001',
		household_name: `ครอบครัว${LONG_NAME}`,
		province: 'สงขลา',
		district: 'หาดใหญ่',
		subdistrict: 'คอหงส์',
		country: 'TH',
		birth_year: 1990,
		age: 36,
		age_band: '20-59',
		queue_status: 'pending',
		stay_status: 'pre_registered',
		registered_via: 'web',
		shelter_code: source === 'bound' ? 'SH001' : null,
		shelter_name: source === 'bound' ? 'ศูนย์พักพิงมหาวิทยาลัยสงขลานครินทร์ วิทยาเขตหาดใหญ่' : null,
		registered_at: '2026-09-09T03:00:00.000Z',
		profile_href: `/system-management/pre-registrations/unassigned/${id}`,
		registration_id: id,
		evacuee_id: null
	};
}

const PRE_REG_ITEMS = [preRegItem('prereg-1', 'unassigned'), preRegItem('prereg-2', 'bound')];

const PRE_REG_PROFILE = {
	source: 'unassigned',
	display_name: LONG_NAME,
	person_id_masked: '123***123',
	phone: '0811111111',
	country: 'TH',
	birth_year: 1990,
	age: 36,
	vulnerable_groups: ['elderly'],
	special_needs: [],
	queue_status: 'pending',
	shelter_code: null,
	shelter_name: null,
	shelter_href: null,
	registered_via: 'web',
	registered_at: '2026-09-09T03:00:00.000Z',
	residence: {
		housing_type: 'house',
		landmark: `ใกล้${LONG_NAME}`,
		address_no: '99/999',
		province: 'สงขลา',
		district: 'หาดใหญ่',
		subdistrict: 'คอหงส์'
	},
	members: [
		{ id: 'm1', display_name: LONG_NAME, status: 'open', country: 'TH', birth_year: 1990 },
		{
			id: 'm2',
			display_name: `${LONG_NAME} จูเนียร์`,
			status: 'open',
			country: 'TH',
			birth_year: 2015
		}
	]
};

async function mockOverviewApi(page: Page) {
	await page.route('**/api/back-office/overview/**', async (route) => {
		const { pathname } = new URL(route.request().url());
		let body: unknown = { items: [] };
		if (pathname.endsWith('/overview/pre-registrations')) {
			body = { items: PRE_REG_ITEMS, total: PRE_REG_ITEMS.length, limit: 50, offset: 0 };
		} else if (pathname.includes('/overview/pre-registrations/unassigned/')) {
			body = PRE_REG_PROFILE;
		}
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(body)
		});
	});
}

async function expectNoSidewaysOverflow(page: Page) {
	const dimensions = await page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth
	}));
	expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

test.describe('Registration pages on mobile (#1347)', { tag: ['@regression'] }, () => {
	let adminSession: string;
	let managerSession: string;

	test.beforeAll(async () => {
		await createCouchUser(ADMIN);
		await seedSecurityQuestion(ADMIN.name);
		adminSession = await couchLogin(ADMIN.name, ADMIN.password);
		await createCouchUser(MANAGER);
		await seedSecurityQuestion(MANAGER.name);
		managerSession = await couchLogin(MANAGER.name, MANAGER.password);
	});

	test.afterAll(async () => {
		await deleteCouchUser(ADMIN.name);
		await deleteCouchUser(MANAGER.name);
	});

	test.afterEach(async ({ page }) => {
		await clearSession(page);
	});

	test('pre-registration list shows cards and stays within a 390px viewport', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await mockCouchRoutes(page, { withRegistryShelter: true });
		await mockOverviewApi(page);
		await injectSession(page, ADMIN, adminSession);

		await page.goto('/system-management/pre-registrations');
		const cards = page.getByTestId('prereg-cards').getByRole('listitem');
		await expect(cards).toHaveCount(PRE_REG_ITEMS.length, { timeout: 15_000 });
		await expect(cards.first()).toBeVisible();
		await expect(page.locator('table')).toBeHidden();
		await expectNoSidewaysOverflow(page);
	});

	test('pre-registration list keeps the table on desktop', async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await mockCouchRoutes(page, { withRegistryShelter: true });
		await mockOverviewApi(page);
		await injectSession(page, ADMIN, adminSession);

		await page.goto('/system-management/pre-registrations');
		await expect(page.locator('table tbody tr')).toHaveCount(PRE_REG_ITEMS.length, {
			timeout: 15_000
		});
		await expect(page.getByTestId('prereg-cards')).toBeHidden();
	});

	test('pre-registration profile stays within a 390px viewport', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await mockCouchRoutes(page, { withRegistryShelter: true });
		await mockOverviewApi(page);
		await injectSession(page, ADMIN, adminSession);

		await page.goto('/system-management/pre-registrations/unassigned/prereg-1');
		await expect(page.getByText(`${LONG_NAME} จูเนียร์`)).toBeVisible({ timeout: 15_000 });
		await expectNoSidewaysOverflow(page);
	});

	for (const path of [
		'/back-office/households/new',
		'/back-office/households/pre-register',
		'/back-office/households/import'
	]) {
		test(`${path} stays within a 390px viewport`, async ({ page }) => {
			await page.setViewportSize({ width: 390, height: 844 });
			await mockCouchRoutes(page, { withRegistryShelter: true });
			await injectSession(page, MANAGER, managerSession);

			await page.goto(path);
			await expect(page.getByRole('main')).toBeVisible({ timeout: 15_000 });
			await page.waitForLoadState('networkidle');
			expect(new URL(page.url()).pathname).toBe(path);
			await expectNoSidewaysOverflow(page);
		});
	}
});
