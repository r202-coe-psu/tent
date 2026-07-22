/**
 * E2E Tests: Master Data Config pages (registration-config, shelter-config,
 * household-master-data) — CR-010 UI on top of `MasterDataConfigPage`.
 *
 * Strategy: real auth (CouchDB session cookies via injectSession), but the
 * `/api/back-office/master-data/*` BFF is fully mocked (`mockMasterData`).
 * Reason: unlike per-test users, master_data docs are 1 global doc per
 * `master_type` — real writes would race across parallel test workers/files.
 *
 * Coverage per page:
 * [Guard]  non-admin (registration_staff) is redirected away from the page
 * [Header] page-specific ConsoleBanner title + only its allowed master types
 * [CRUD]   add → edit → delete an item round-trips through the mocked BFF
 */

import { test, expect, type Page, type Route } from '@playwright/test';
import {
	createCouchUser,
	deleteCouchUser,
	couchLogin,
	SA_ROLES,
	STAFF_SH001_ROLES
} from './helpers/couch';
import { injectSession, clearSession } from './helpers/login';

const BASE = 'http://localhost:4173';
const API_PATTERN = '**/api/back-office/master-data**';

// Thai + English labels for the master_type enum (mirrors
// `MASTER_DATA_TYPE_LABELS` in `$lib/features/master-data/domain/master-data.ts`).
const TYPE_LABELS: Record<string, string> = {
	vulnerable_group: 'ประเภทกลุ่มเปราะบาง (Vulnerable Group)',
	health_condition: 'โรคประจำตัวและอาการแพ้ (Health Condition)',
	dietary_restrictions: 'ศาสนาและข้อจำกัดอาหาร (Dietary Restrictions)',
	pet_types: 'ประเภทสัตว์เลี้ยง (Pet Types)',
	house_damage: 'สถานะความเสียหายของบ้าน (House Damage)',
	municipality_zone: 'เขตเทศบาล (Municipality Zone)',
	community: 'ชุมชน (Community)',
	shelter_type: 'ประเภทศูนย์พักพิง (Shelter Type)'
};

type MockItem = { code: string; label: string; is_default: boolean };
type MockStore = Map<string, MockItem[]>;

/**
 * Mocks the master-data BFF entirely (GET list/detail, PUT replace, DELETE
 * item) against an in-memory store, keyed by `master_type`. Returns the store
 * so a test can assert on the persisted shape after a UI action.
 */
async function mockMasterData(page: Page, seed: Record<string, MockItem[]>): Promise<MockStore> {
	const store: MockStore = new Map(Object.entries(seed));

	await page.route(API_PATTERN, async (route: Route) => {
		const req = route.request();
		const url = new URL(req.url());
		const method = req.method();
		const rest = url.pathname.replace(/^.*\/api\/back-office\/master-data\/?/, '');
		const segments = rest.split('/').filter(Boolean).map(decodeURIComponent);

		if (segments.length === 0 && method === 'GET') {
			const body = [...store.entries()].map(([type, items]) => ({
				_id: `master_data:${type}`,
				master_type: type,
				items
			}));
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(body)
			});
			return;
		}

		const [type, sub, code] = segments;

		if (segments.length === 1 && method === 'GET') {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					_id: `master_data:${type}`,
					master_type: type,
					items: store.get(type) ?? []
				})
			});
			return;
		}

		if (segments.length === 1 && method === 'PUT') {
			const body = req.postDataJSON() as { items: MockItem[] };
			store.set(type, body.items);
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ ok: true, rev: '1-mock' })
			});
			return;
		}

		if (segments.length === 3 && sub === 'items' && method === 'DELETE') {
			store.set(
				type,
				(store.get(type) ?? []).filter((i) => i.code !== code)
			);
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ ok: true, rev: '2-mock' })
			});
			return;
		}

		await route.continue();
	});

	return store;
}

// ─── fixture accounts (shared across all page describes) ──────────────────────

const RUN_ID = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
const SA = {
	name: `md_sa_${RUN_ID}`,
	password: 'Password1!',
	roles: SA_ROLES,
	display_name: 'MD SA'
};
const STAFF = {
	name: `md_staff_${RUN_ID}`,
	password: 'Password1!',
	roles: STAFF_SH001_ROLES,
	display_name: 'MD Staff'
};

const sessions: Record<string, string> = {};

test.beforeAll(async () => {
	await createCouchUser(SA);
	await createCouchUser(STAFF);
	sessions[SA.name] = await couchLogin(SA.name, SA.password);
	sessions[STAFF.name] = await couchLogin(STAFF.name, STAFF.password);
});

test.afterAll(async () => {
	await deleteCouchUser(SA.name);
	await deleteCouchUser(STAFF.name);
});

test.afterEach(async ({ page }) => {
	await clearSession(page);
});

// ─── per-page config ────────────────────────────────────────────────────────────

const PAGES = [
	{
		name: 'registration-config',
		path: '/back-office/registration-config',
		title: '1. ข้อมูลหลักบุคคล (Person Master Data)',
		allowedTypes: [
			'vulnerable_group',
			'health_condition',
			'dietary_restrictions',
			'pet_types',
			'house_damage'
		],
		foreignTypes: ['shelter_type', 'municipality_zone', 'community'],
		primaryType: 'pet_types'
	},
	{
		name: 'shelter-config',
		path: '/back-office/shelter-config',
		title: '2. ตั้งค่าศูนย์พักพิง (Shelter Master Data)',
		allowedTypes: ['shelter_type'],
		foreignTypes: ['vulnerable_group', 'municipality_zone'],
		primaryType: 'shelter_type'
	},
	{
		name: 'household-master-data',
		path: '/back-office/household-master-data',
		title: '3. ตั้งค่าครัวเรือน (Household Master Data)',
		allowedTypes: ['municipality_zone', 'community'],
		foreignTypes: ['vulnerable_group', 'shelter_type'],
		primaryType: 'community'
	}
];

for (const cfg of PAGES) {
	test.describe(`Master Data Config — ${cfg.name}`, () => {
		test('redirects a non-admin user away from the page', async ({ page }) => {
			await injectSession(page, STAFF, sessions[STAFF.name]);
			await mockMasterData(page, {});
			await page.goto(`${BASE}${cfg.path}`);
			await expect(page).toHaveURL(`${BASE}/portal`, { timeout: 8000 });
		});

		test('renders the page-specific header and only its allowed master types', async ({ page }) => {
			await injectSession(page, SA, sessions[SA.name]);
			const seed = Object.fromEntries(
				[...cfg.allowedTypes, ...cfg.foreignTypes].map((t) => [t, []])
			);
			await mockMasterData(page, seed);
			await page.goto(`${BASE}${cfg.path}`);

			await expect(page.getByRole('heading', { level: 2, name: cfg.title })).toBeVisible();

			for (const type of cfg.allowedTypes) {
				await expect(page.locator('nav button', { hasText: TYPE_LABELS[type] })).toBeVisible();
			}
			for (const type of cfg.foreignTypes) {
				await expect(page.locator('nav button', { hasText: TYPE_LABELS[type] })).not.toBeVisible();
			}
		});

		test('supports add, edit, and delete of an item', async ({ page }) => {
			await injectSession(page, SA, sessions[SA.name]);
			const seed = Object.fromEntries(cfg.allowedTypes.map((t) => [t, []]));
			await mockMasterData(page, seed);
			await page.goto(`${BASE}${cfg.path}?type=${cfg.primaryType}`);

			// Add
			await page.getByRole('button', { name: 'เพิ่มข้อมูล' }).click();
			await expect(page.getByRole('dialog')).toBeVisible();
			await page.locator('#master-data-label').fill('รายการทดสอบ Add');
			await page.getByRole('button', { name: 'บันทึก' }).click();
			await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 8000 });
			await expect(page.getByText('รายการทดสอบ Add')).toBeVisible();

			// Edit
			await page.getByRole('button', { name: 'จัดการ รายการทดสอบ Add' }).click();
			await expect(page.getByRole('dialog')).toBeVisible();
			await page.locator('#master-data-label').fill('รายการทดสอบ Edited');
			await page.getByRole('button', { name: 'บันทึก' }).click();
			await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 8000 });
			await expect(page.getByText('รายการทดสอบ Edited')).toBeVisible();
			await expect(page.getByText('รายการทดสอบ Add')).not.toBeVisible();

			// Delete (native `confirm()` dialog)
			page.once('dialog', (d) => d.accept());
			await page.getByRole('button', { name: 'ลบ รายการทดสอบ Edited' }).click();
			await expect(page.getByText('รายการทดสอบ Edited')).not.toBeVisible({ timeout: 8000 });
		});
	});
}
