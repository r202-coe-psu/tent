/**
 * E2E Tests: Shelter Form (create/edit single-page) — UI Flow & Route Guard
 *
 * Strategy: real BFF for auth guard behavior; the shelter provisioning
 * endpoints (`POST`/`PATCH /api/back-office/shelter[/:code]`) are mocked —
 * unlike users, shelters have no delete endpoint, so a real `POST` here would
 * permanently provision a CouchDB database with no way to clean it up.
 * Mocking keeps this a repeatable test of the form's own behavior (single-page
 * sections, client validation, submit payload, edit prefill, food points)
 * without depending on or mutating real shelter data.
 *
 * Coverage:
 * [Guard]  non-admin is redirected away from the create page
 * [Create] client validation blocks submit when required fields are empty
 * [Create] SA can fill the form and submit a new shelter (incl. food point)
 * [Edit]   form pre-fills from the loaded shelter and PATCHes on save
 * [Nav]    all sections visible; sidebar click scrolls to section
 */

import { test, expect, type Page } from '@playwright/test';
import {
	createCouchUser,
	deleteCouchUser,
	couchLogin,
	SA_ROLES,
	SM_SH001_ROLES
} from './helpers/couch';
import { injectSession, clearSession } from './helpers/login';

const RUN_ID = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
const SA = {
	name: `shelter_form_sa_${RUN_ID}`,
	password: 'Password1!',
	roles: SA_ROLES,
	display_name: 'Shelter Form SA'
};
const SM = {
	name: `shelter_form_sm_${RUN_ID}`,
	password: 'Password1!',
	roles: SM_SH001_ROLES,
	display_name: 'Shelter Form SM'
};

const sessions: Record<string, string> = {};

test.beforeAll(async () => {
	await createCouchUser(SA);
	await createCouchUser(SM);
	sessions[SA.name] = await couchLogin(SA.name, SA.password);
	sessions[SM.name] = await couchLogin(SM.name, SM.password);
});

test.afterAll(async () => {
	await deleteCouchUser(SA.name);
	await deleteCouchUser(SM.name);
});

test.afterEach(async ({ page }) => {
	await clearSession(page);
});

/** Intercepts the create endpoint; never actually provisions a CouchDB database. */
async function mockCreate(
	page: Page,
	response: { ok: true; code: string }
): Promise<{ getBody: () => unknown; wasCalled: () => boolean }> {
	let body: unknown = null;
	let called = false;
	await page.route('**/api/back-office/shelter', async (route) => {
		if (route.request().method() === 'POST') {
			called = true;
			body = route.request().postDataJSON();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(response)
			});
		} else {
			await route.continue();
		}
	});
	return { getBody: () => body, wasCalled: () => called };
}

/**
 * Intercepts a single shelter for edit mode.
 *
 * The edit form's prefill (`useShelter`) reads through PouchDB/CouchDB
 * directly (`registry/_all_docs`), NOT the `/api/back-office/shelter` BFF —
 * only the create/update *mutations* go through the BFF. So GET is mocked at
 * the registry level (mirrors `mockShelters()` in users/ui-crud.test.ts) while
 * PATCH (the actual save) is mocked at the BFF route.
 */
async function mockShelterDetail(
	page: Page,
	code: string,
	shelter: Record<string, unknown>
): Promise<{ getPatchBody: () => unknown }> {
	await page.route('**/registry/_all_docs*', async (route) => {
		const rows = [
			{
				id: `shelter:${code}`,
				doc: { _id: `shelter:${code}`, type: 'shelter', schema_v: 6, code, ...shelter }
			}
		];
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ rows })
		});
	});

	let patchBody: unknown = null;
	await page.route(`**/api/back-office/shelter/${code}`, async (route) => {
		if (route.request().method() === 'PATCH') {
			patchBody = route.request().postDataJSON();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ ok: true, code })
			});
		} else {
			await route.continue();
		}
	});
	return { getPatchBody: () => patchBody };
}

const BASIC_INFO_HEADING = 'ข้อมูลพื้นฐานและที่ตั้ง';
const CAPACITY_HEADING = 'ข้อมูลความจุเชิงพื้นที่';
const FOOD_HEADING = 'จุดแจกอาหาร';
const PARKING_HEADING = 'นโยบายยานพาหนะ';

const SECTION_HEADINGS = [
	BASIC_INFO_HEADING,
	CAPACITY_HEADING,
	'การจัดการโซนและสิ่งอำนวยความสะดวก',
	FOOD_HEADING,
	'สถานะสาธารณูปโภคพื้นฐาน',
	'ข้อมูลการประเมินความเสี่ยงและโครงสร้าง',
	'นโยบายการรับผู้อพยพและกลุ่มเปราะบาง',
	'นโยบายทรัพย์สินมีค่า / สัมภาระ',
	'นโยบายยานพาหนะและการจอดรถ'
];

test.describe('Shelter Form — Access Guard', () => {
	test('a non-admin (shelter manager) is redirected away from the create page', async ({
		page
	}) => {
		await injectSession(page, SM, sessions[SM.name]);
		await page.goto('http://localhost:4173/back-office/shelters/create');

		await page.waitForURL((url) => !url.pathname.includes('/shelters/create'), { timeout: 8000 });
		await expect(page).toHaveURL('http://localhost:4173/portal');
	});
});

test.describe('Shelter Form — Create', () => {
	test('blocks submit and shows which fields/sections need fixing when required fields are empty', async ({
		page
	}) => {
		const { wasCalled } = await mockCreate(page, { ok: true, code: 'SH900' });

		await injectSession(page, SA, sessions[SA.name]);
		await page.goto('http://localhost:4173/back-office/shelters/create');
		await expect(page.getByRole('button', { name: BASIC_INFO_HEADING })).toBeVisible();

		await page.getByRole('button', { name: 'บันทึกข้อมูล' }).click();

		await expect(page.getByText('กรุณากรอกข้อมูลให้ครบถ้วนและถูกต้อง')).toBeVisible();
		await expect(page.getByRole('alert')).toContainText('ยังมีข้อมูลที่ต้องกรอกหรือแก้ไข');
		await expect(page.getByRole('alert')).toContainText('ชื่อศูนย์พักพิงต้องไม่ว่าง');
		await expect(page.getByRole('alert')).toContainText(/ความจุ|กรุณาระบุความจุ/);
		await expect(page.getByRole('heading', { name: new RegExp(BASIC_INFO_HEADING) })).toBeVisible();
		await expect(page.getByText('ชื่อศูนย์พักพิงต้องไม่ว่าง')).toBeVisible();
		expect(wasCalled()).toBe(false);
		await expect(page).toHaveURL(/\/back-office\/shelters\/create/);
	});

	test('SA fills the single-page form and creates a new shelter with a food point', async ({
		page
	}) => {
		const { getBody } = await mockCreate(page, { ok: true, code: 'SH901' });

		await injectSession(page, SA, sessions[SA.name]);
		await page.goto('http://localhost:4173/back-office/shelters/create');

		await expect(page.getByRole('heading', { name: new RegExp(BASIC_INFO_HEADING) })).toBeVisible();
		await page.getByLabel('ชื่อศูนย์พักพิง').fill('ศูนย์พักพิงทดสอบ E2E');

		await page.getByRole('button', { name: CAPACITY_HEADING }).click();
		await expect(page.getByLabel('ความจุสูงสุด')).toBeVisible();
		await page.getByLabel('ความจุสูงสุด').fill('120');

		await page.getByRole('button', { name: FOOD_HEADING }).click();
		await expect(page.getByRole('heading', { name: FOOD_HEADING })).toBeVisible();
		await page.getByRole('button', { name: /เพิ่มจุดแจกอาหาร/ }).click();
		await page.getByLabel('ชื่อจุดแจกอาหาร').fill('จุดแจกหน้าโรงครัว');

		await page.getByRole('button', { name: 'บันทึกข้อมูล' }).click();

		await page.waitForURL(
			(url) =>
				url.pathname === '/back-office/shelters' ||
				url.pathname.startsWith('/back-office/shelters/edit/'),
			{ timeout: 8000 }
		);

		const body = getBody() as {
			name: string;
			capacity: number;
			food_distribution_points: { name: string }[];
		};
		expect(body.name).toBe('ศูนย์พักพิงทดสอบ E2E');
		expect(body.capacity).toBe(120);
		expect(body.food_distribution_points).toHaveLength(1);
		expect(body.food_distribution_points[0].name).toBe('จุดแจกหน้าโรงครัว');
	});
});

test.describe('Shelter Form — Edit', () => {
	test('pre-fills from the loaded shelter and PATCHes the change on save', async ({ page }) => {
		const CODE = 'SH902';
		const { getPatchBody } = await mockShelterDetail(page, CODE, {
			name: 'ศูนย์พักพิงเดิม',
			operation_status: 'standby',
			capacity: 80,
			shelter_type: null,
			project_level: null,
			location: {},
			contact: {},
			facilities: {},
			common_areas: { sub_storage: [] },
			utilities: { communications: [] },
			risk: {},
			zones: [],
			food_distribution_points: []
		});

		await injectSession(page, SA, sessions[SA.name]);
		await page.goto(`http://localhost:4173/back-office/shelters/edit/${CODE}`);

		const nameInput = page.getByLabel('ชื่อศูนย์พักพิง');
		await expect(nameInput).toHaveValue('ศูนย์พักพิงเดิม');
		await nameInput.fill('ศูนย์พักพิงแก้ไขแล้ว');

		await page.getByRole('button', { name: CAPACITY_HEADING }).click();
		await expect(page.getByLabel('ความจุสูงสุด')).toHaveValue('80');

		await page.getByRole('button', { name: 'บันทึกข้อมูล' }).click();

		await page.waitForURL(
			(url) =>
				url.pathname === '/back-office/shelters' ||
				url.pathname.startsWith('/back-office/shelters/edit/'),
			{ timeout: 8000 }
		);

		const body = getPatchBody() as { name: string; capacity: number };
		expect(body.name).toBe('ศูนย์พักพิงแก้ไขแล้ว');
		expect(body.capacity).toBe(80);
	});
});

test.describe('Shelter Form — Single-page Navigation', () => {
	test('all sections are visible on one page; nav has no prev/next; sidebar scroll works', async ({
		page
	}) => {
		await injectSession(page, SA, sessions[SA.name]);
		await page.goto('http://localhost:4173/back-office/shelters/create');

		await expect(page.getByRole('button', { name: 'ก่อนหน้า' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'ถัดไป' })).toHaveCount(0);

		for (const heading of SECTION_HEADINGS) {
			await expect(page.getByRole('heading', { name: new RegExp(heading) })).toBeVisible();
		}

		await page.getByRole('button', { name: PARKING_HEADING }).click();
		await expect(page.locator('#parking-policy')).toBeInViewport();

		await page.getByRole('button', { name: FOOD_HEADING }).click();
		await expect(page.locator('#food-distribution')).toBeInViewport();
	});
});
