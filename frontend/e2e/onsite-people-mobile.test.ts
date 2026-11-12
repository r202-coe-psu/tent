/**
 * E2E: Station 1 queue on a phone (#1347) — mocked Couch (`mock-couch`); `@regression`.
 * At 390x844 each tab of /onsite/people renders cards (not a sideways-scrolling table) and the
 * whole page stays inside the viewport, even with very long Thai names.
 *
 * Run (rebuild first — matches package.json test:e2e):
 *   pnpm exec vite build --mode test && pnpm playwright test e2e/onsite-people-mobile.test.ts
 */

import { test, expect, type Page } from '@playwright/test';
import {
	createCouchUser,
	seedSecurityQuestion,
	deleteCouchUser,
	couchLogin,
	SM_SH001_ROLES
} from './helpers/couch';
import { injectSession, clearSession } from './helpers/login';
import { mockCouchRoutes } from './helpers/mock-couch';

const RUN_ID = Date.now().toString(36);

const MANAGER = {
	name: `people_mobile_sm_${RUN_ID}`,
	password: 'Password1!',
	roles: SM_SH001_ROLES,
	display_name: 'People Mobile Manager E2E'
};

const LONG_FIRST = 'ประสิทธิ์ภาพความเจริญรุ่งเรืองยั่งยืนมั่นคงศรีสวัสดิ์พิพัฒน์';
const LONG_LAST = 'วงศ์สกุลเจริญสุขสมบูรณ์พูนผลมหาศาลนิรันดร์กาล';
const LONG_HOUSEHOLD = 'ครอบครัวประสิทธิ์ภาพความเจริญรุ่งเรืองยั่งยืนมั่นคงศรีสวัสดิ์พิพัฒน์';

const HOUSEHOLD = {
	_id: 'household:01MOBILEQUEUEHH000000001',
	_rev: '1-mock',
	type: 'household',
	schema_v: 10,
	label: LONG_HOUSEHOLD,
	shelter_code: 'SH001'
};

function evacuee(id: string, status: string, extra: Record<string, unknown> = {}) {
	return {
		_id: `evacuee:01MOBILEQUEUE${id}`,
		_rev: '1-mock',
		type: 'evacuee',
		schema_v: 10,
		first_name: LONG_FIRST,
		last_name: LONG_LAST,
		nickname: 'น้องสมศักดิ์',
		gender: 'male',
		phone: '0811111111',
		person_id: { cardType: 'national_id', number: '1234567890123' },
		household_id: HOUSEHOLD._id,
		special_needs: [],
		registered_via: 'web',
		current_stay: { status, zone: null, since: '2026-09-09T00:00:00.000Z' },
		privacy: { search_excluded: false },
		shelter_code: 'SH001',
		updated_at: '2026-09-09T03:00:00.000Z',
		...extra
	};
}

const SEED_DOCS = [
	HOUSEHOLD,
	evacuee('PRE00000000001', 'pre_registered'),
	evacuee('PRE00000000002', 'kiosk_registered'),
	evacuee('ARR00000000001', 'arriving'),
	evacuee('ACT00000000001', 'active', {
		current_stay: { status: 'active', zone: 'z1', since: '2026-09-09T00:00:00.000Z' }
	})
];

const TABS = [
	{ name: /รอรายงานตัว/, cards: 2 },
	{ name: /รอส่งต่อเข้าพัก/, cards: 1 },
	{ name: /ผู้ประสบภัยทั้งหมด/, cards: 4 }
];

async function expectNoSidewaysOverflow(page: Page) {
	const dimensions = await page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth
	}));
	expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

test.describe('Station 1 queue on mobile (#1347)', { tag: ['@onsite', '@regression'] }, () => {
	let managerSession: string;

	test.beforeAll(async () => {
		await createCouchUser(MANAGER);
		await seedSecurityQuestion(MANAGER.name);
		managerSession = await couchLogin(MANAGER.name, MANAGER.password);
	});

	test.afterAll(async () => {
		await deleteCouchUser(MANAGER.name);
	});

	test.afterEach(async ({ page }) => {
		await clearSession(page);
	});

	test('each tab shows cards, hides the table and stays within a 390px viewport', async ({
		page
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await mockCouchRoutes(page, {
			withRegistryShelter: true,
			enableMedicalScreening: true,
			seedDocs: SEED_DOCS
		});
		await injectSession(page, MANAGER, managerSession);

		await page.goto('/onsite/people');
		await expect(page.getByRole('heading', { name: 'ทะเบียนผู้ประสบภัย' })).toBeVisible({
			timeout: 15_000
		});
		const tabs = page.getByRole('navigation', { name: 'แท็บกระบวนการลงทะเบียน' });

		for (const tab of TABS) {
			await tabs.getByRole('button', { name: tab.name }).click();
			const cards = page.getByTestId('queue-card');
			await expect(cards).toHaveCount(tab.cards);
			await expect(cards.first()).toBeVisible();
			await expect(page.locator('table')).toBeHidden();

			await expectNoSidewaysOverflow(page);
			// The tab container clips (overflow-hidden), so also check no card spills past the viewport.
			for (const box of await cards.evaluateAll((els) =>
				els.map((el) => {
					const r = el.getBoundingClientRect();
					return { left: r.left, right: r.right, overflow: el.scrollWidth - el.clientWidth };
				})
			)) {
				expect(box.left).toBeGreaterThanOrEqual(0);
				expect(box.right).toBeLessThanOrEqual(390);
				expect(box.overflow).toBeLessThanOrEqual(0);
			}
		}
	});

	test('desktop keeps the table and hides the cards', async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await mockCouchRoutes(page, {
			withRegistryShelter: true,
			enableMedicalScreening: true,
			seedDocs: SEED_DOCS
		});
		await injectSession(page, MANAGER, managerSession);

		await page.goto('/onsite/people');
		await expect(page.getByRole('heading', { name: 'ทะเบียนผู้ประสบภัย' })).toBeVisible({
			timeout: 15_000
		});
		await expect(page.locator('table tbody tr')).toHaveCount(2);
		// Cards stay in the DOM but are display:none from md up.
		await expect(page.getByTestId('queue-card').first()).toBeHidden();
	});

	for (const station of [
		{ path: '/onsite/medical-screening', cards: 'screening-cards', medical: true },
		{ path: '/onsite/zoning', cards: 'zoning-cards', medical: false }
	]) {
		test(`${station.path} shows cards and stays within a 390px viewport`, async ({ page }) => {
			await page.setViewportSize({ width: 390, height: 844 });
			await mockCouchRoutes(page, {
				withRegistryShelter: true,
				enableMedicalScreening: station.medical,
				seedDocs: SEED_DOCS
			});
			await injectSession(page, MANAGER, managerSession);

			await page.goto(station.path);
			// Inactive tab panels stay mounted, so look at the visible list only.
			const cards = page.locator(`[data-testid="${station.cards}"]:visible > li`);
			await expect(cards.first()).toBeVisible({ timeout: 15_000 });
			await expect(page.locator('table:visible')).toHaveCount(0);
			await expectNoSidewaysOverflow(page);
		});
	}
});
