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
 * [Edit]   optional zone short name pre-fills, edits (≤10 chars) and PATCHes
 * [Storage] storage point types: multi-select saved in enum order (mouse + keyboard), the last
 *          type cannot be cleared, a legacy single `type` reads back as one chip, a new point
 *          starts with none and blocks save (#647, CR-199)
 * [Nav]    all sections visible; sidebar click scrolls to section
 */

import { test, expect, type Page } from '@playwright/test';
import {
	createCouchUser,
	deleteCouchUser,
	couchLogin,
	seedSecurityQuestion,
	SA_ROLES,
	SM_SH001_ROLES
} from './helpers/couch';
import { injectSession, clearSession, routeBrowserCouchThroughApp } from './helpers/login';

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
	await seedSecurityQuestion(SA.name);
	await seedSecurityQuestion(SM.name);
	sessions[SA.name] = await couchLogin(SA.name, SA.password);
	sessions[SM.name] = await couchLogin(SM.name, SM.password);
});

test.afterAll(async () => {
	await deleteCouchUser(SA.name);
	await deleteCouchUser(SM.name);
});

// The test build calls CouchDB cross-origin, so the back-office "Offline" banner shows in the
// sticky header and intercepts clicks on buttons scrolled beneath it (e.g. "บันทึกข้อมูล").
// Registered first so each test's own registry/BFF mocks still take precedence.
test.beforeEach(async ({ page }) => {
	await routeBrowserCouchThroughApp(page);
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
const CAPACITY_HEADING = 'ความจุ โซน และสิ่งอำนวยความสะดวก';
const FOOD_HEADING = 'จุดแจกอาหาร';
const PARKING_HEADING = 'นโยบายยานพาหนะ';

const SECTION_HEADINGS = [
	BASIC_INFO_HEADING,
	CAPACITY_HEADING,
	FOOD_HEADING,
	'จุดเก็บของ',
	'สถานะสาธารณูปโภคพื้นฐาน',
	'ข้อมูลการประเมินความเสี่ยงและโครงสร้าง',
	'นโยบายการรับผู้อพยพและกลุ่มเปราะบาง',
	'นโยบายทรัพย์สินมีค่า / สัมภาระ',
	'นโยบายยานพาหนะและการจอดรถ'
];

/** Desktop sidebar nav button (its name is prefixed with the section number). */
function sectionNav(page: Page, label: string) {
	return page
		.locator('nav')
		.filter({ hasText: 'สารบัญหมวดหมู่' })
		.getByRole('button', { name: label });
}

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
		const formAlert = page
			.getByRole('alert')
			.filter({ hasText: 'ยังมีข้อมูลที่ต้องกรอกหรือแก้ไข' });
		await expect(formAlert).toBeVisible();
		await expect(formAlert).toContainText('ชื่อศูนย์พักพิงต้องไม่ว่าง');
		await expect(formAlert).toContainText(/ความจุ|กรุณาระบุความจุ/);
		await expect(page.getByRole('heading', { name: new RegExp(BASIC_INFO_HEADING) })).toBeVisible();
		await expect(
			page.locator('[data-fs-field-error]', { hasText: 'ชื่อศูนย์พักพิงต้องไม่ว่าง' })
		).toBeVisible();
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

		await sectionNav(page, CAPACITY_HEADING).click();
		await expect(page.getByLabel('ความจุสูงสุด')).toBeVisible();
		await page.getByLabel('ความจุสูงสุด').fill('120');

		await sectionNav(page, FOOD_HEADING).click();
		await expect(page.getByRole('heading', { level: 2, name: FOOD_HEADING })).toBeVisible();
		await page.getByRole('button', { name: /เพิ่มจุดแจกอาหาร/ }).click();
		await page.getByLabel('ชื่อจุดแจกอาหาร').fill('จุดแจกหน้าโรงครัว');

		await expect(page.getByText(/Offline — ไม่สามารถเชื่อมต่อ/)).toBeHidden();
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

		await sectionNav(page, CAPACITY_HEADING).click();
		await expect(page.getByLabel('ความจุสูงสุด')).toHaveValue('80');

		const patched = page.waitForResponse(
			(res) =>
				res.request().method() === 'PATCH' && res.url().endsWith(`/api/back-office/shelter/${CODE}`)
		);
		await page.getByRole('button', { name: 'บันทึกข้อมูล' }).click();
		await patched;

		const body = getPatchBody() as { name: string; capacity: number };
		expect(body.name).toBe('ศูนย์พักพิงแก้ไขแล้ว');
		expect(body.capacity).toBe(80);
	});

	test('pre-fills, edits and PATCHes the optional zone short name', async ({ page }) => {
		const CODE = 'SH903';
		const { getPatchBody } = await mockShelterDetail(page, CODE, {
			name: 'ศูนย์พักพิงชื่อย่อโซน',
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
			zones: [
				{
					code: 'Z1',
					name: 'โซนหญิง',
					capacity: 30,
					type: 'female',
					status: 'active',
					short_name: 'F1'
				},
				{ code: 'Z2', name: 'โซนชาย', capacity: 20, type: 'male', status: 'active' }
			],
			food_distribution_points: []
		});

		await injectSession(page, SA, sessions[SA.name]);
		await page.goto(`http://localhost:4173/back-office/shelters/edit/${CODE}`);

		await sectionNav(page, CAPACITY_HEADING).click();
		const shortNames = page.getByRole('textbox', { name: 'ชื่อย่อโซน' });
		await expect(shortNames).toHaveCount(2);
		await expect(shortNames.nth(0)).toHaveValue('F1');
		await expect(shortNames.nth(1)).toHaveValue('');

		// typing key by key keeps inner/trailing spaces (no trim while editing)
		await shortNames.nth(0).clear();
		await shortNames.nth(0).pressSequentially('A 1 ');
		await expect(shortNames.nth(0)).toHaveValue('A 1 ');
		await shortNames.nth(0).fill('');
		// maxlength caps the input at 10 characters
		await shortNames.nth(1).fill('M1ABCDEFGHIJ');
		await expect(shortNames.nth(1)).toHaveValue('M1ABCDEFGH');

		const patched = page.waitForResponse(
			(res) =>
				res.request().method() === 'PATCH' && res.url().endsWith(`/api/back-office/shelter/${CODE}`)
		);
		await page.getByRole('button', { name: 'บันทึกข้อมูล' }).click();
		await patched;

		const body = getPatchBody() as { zones: { code: string; short_name?: string | null }[] };
		expect(body.zones.find((z) => z.code === 'Z1')?.short_name ?? null).toBe(null);
		expect(body.zones.find((z) => z.code === 'Z2')?.short_name).toBe('M1ABCDEFGH');
	});
});

const STORAGE_HEADING = 'จุดเก็บของ';

/** A shelter in edit mode with the given storage points (schema_v 8 unless overridden). */
function storageShelter(subStorage: unknown[], schemaV = 8): Record<string, unknown> {
	return {
		schema_v: schemaV,
		name: 'ศูนย์พักพิงจุดเก็บของ',
		operation_status: 'standby',
		capacity: 80,
		shelter_type: null,
		project_level: null,
		location: {},
		contact: {},
		facilities: {},
		common_areas: { sub_storage: subStorage },
		utilities: { communications: [] },
		risk: {},
		zones: [],
		food_distribution_points: []
	};
}

type StoragePatch = { common_areas: { sub_storage: { id: string; types: string[] }[] } };

test.describe('Shelter Form — Storage point types (#647)', () => {
	test('multi-select saves types in enum order, whatever the click order', async ({ page }) => {
		const CODE = 'SH904';
		const { getPatchBody } = await mockShelterDetail(
			page,
			CODE,
			storageShelter([{ id: 'sp-1', name: 'ห้องเก็บของ 1', types: ['general'], area_m2: null }])
		);
		await injectSession(page, SA, sessions[SA.name]);
		await page.goto(`http://localhost:4173/back-office/shelters/edit/${CODE}`);
		await sectionNav(page, STORAGE_HEADING).click();

		const group = page.getByRole('group', { name: /ประเภทของที่เก็บได้/ });
		await expect(group.getByRole('button', { name: 'ทั่วไป' })).toHaveAttribute(
			'aria-pressed',
			'true'
		);

		// Click in reverse table order: น้ำดื่ม → ยา → อาหารเด็ก
		await group.getByRole('button', { name: 'น้ำดื่ม' }).click();
		await group.getByRole('button', { name: 'ยา', exact: true }).click();
		await group.getByRole('button', { name: 'อาหารเด็ก' }).click();
		// Keyboard: Space toggles the focused chip off
		await group.getByRole('button', { name: 'ทั่วไป' }).focus();
		await page.keyboard.press('Space');
		await expect(group.getByRole('button', { name: 'ทั่วไป' })).toHaveAttribute(
			'aria-pressed',
			'false'
		);

		const patched = page.waitForResponse(
			(res) =>
				res.request().method() === 'PATCH' && res.url().endsWith(`/api/back-office/shelter/${CODE}`)
		);
		await page.getByRole('button', { name: 'บันทึกข้อมูล' }).click();
		await patched;

		const body = getPatchBody() as StoragePatch;
		expect(body.common_areas.sub_storage[0].types).toEqual([
			'baby_food',
			'medical_supplies',
			'drinking_water'
		]);
	});

	test('the last type cannot be cleared — a toast says why and the chip stays on', async ({
		page
	}) => {
		const CODE = 'SH905';
		await mockShelterDetail(
			page,
			CODE,
			storageShelter([{ id: 'sp-1', name: 'ห้องเก็บของ 1', types: ['food_dry'], area_m2: null }])
		);
		await injectSession(page, SA, sessions[SA.name]);
		await page.goto(`http://localhost:4173/back-office/shelters/edit/${CODE}`);
		await sectionNav(page, STORAGE_HEADING).click();

		const chip = page
			.getByRole('group', { name: /ประเภทของที่เก็บได้/ })
			.getByRole('button', { name: 'อาหารแห้ง' });
		await chip.click();
		await expect(page.getByText('ต้องเลือกอย่างน้อย 1 ประเภท')).toBeVisible();
		await expect(chip).toHaveAttribute('aria-pressed', 'true');

		// Same refusal from the keyboard
		await chip.focus();
		await page.keyboard.press('Enter');
		await expect(chip).toHaveAttribute('aria-pressed', 'true');
	});

	test('a legacy single `type` (schema_v 7) reads back as one chip and saves as `types`', async ({
		page
	}) => {
		const CODE = 'SH906';
		const { getPatchBody } = await mockShelterDetail(
			page,
			CODE,
			storageShelter(
				[{ id: 'sp-1', name: 'ห้องยาเดิม', type: 'medical_supplies', area_m2: null }],
				7
			)
		);
		await injectSession(page, SA, sessions[SA.name]);
		await page.goto(`http://localhost:4173/back-office/shelters/edit/${CODE}`);
		await sectionNav(page, STORAGE_HEADING).click();

		const group = page.getByRole('group', { name: /ประเภทของที่เก็บได้/ });
		await expect(group.getByRole('button', { name: 'ยา', exact: true })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		await expect(group.locator('[aria-pressed="true"]')).toHaveCount(1);

		const patched = page.waitForResponse(
			(res) =>
				res.request().method() === 'PATCH' && res.url().endsWith(`/api/back-office/shelter/${CODE}`)
		);
		await page.getByRole('button', { name: 'บันทึกข้อมูล' }).click();
		await patched;

		const point = (getPatchBody() as StoragePatch).common_areas.sub_storage[0];
		expect(point.types).toEqual(['medical_supplies']);
		expect(point).not.toHaveProperty('type');
	});

	test('a new point starts with no type and blocks save until one is picked', async ({ page }) => {
		const CODE = 'SH907';
		const { getPatchBody } = await mockShelterDetail(page, CODE, storageShelter([]));
		await injectSession(page, SA, sessions[SA.name]);
		await page.goto(`http://localhost:4173/back-office/shelters/edit/${CODE}`);
		await sectionNav(page, STORAGE_HEADING).click();

		await page.getByRole('button', { name: 'เพิ่มจุดเก็บของ' }).click();
		await page.getByLabel('ชื่อจุดเก็บของ').fill('ห้องเรียน 3');
		const group = page.getByRole('group', { name: /ประเภทของที่เก็บได้/ });
		await expect(group.locator('[aria-pressed="true"]')).toHaveCount(0);

		await page.getByRole('button', { name: 'บันทึกข้อมูล' }).click();
		await expect(
			page.locator('[data-fs-field-error]').filter({ hasText: 'เลือกอย่างน้อย 1 ประเภท' })
		).toBeVisible();
		expect(getPatchBody()).toBeNull();

		await group.getByRole('button', { name: 'อาหารปรุงสุก' }).click();
		const patched = page.waitForResponse(
			(res) =>
				res.request().method() === 'PATCH' && res.url().endsWith(`/api/back-office/shelter/${CODE}`)
		);
		await page.getByRole('button', { name: 'บันทึกข้อมูล' }).click();
		await patched;
		const point = (getPatchBody() as StoragePatch).common_areas.sub_storage[0];
		expect(point.types).toEqual(['cooked_food']);
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
			await expect(
				page.getByRole('heading', { level: 2, name: new RegExp(heading) })
			).toBeVisible();
		}

		await sectionNav(page, PARKING_HEADING).click();
		await expect(page.locator('#parking-policy')).toBeInViewport();

		await sectionNav(page, FOOD_HEADING).click();
		await expect(page.locator('#food-distribution')).toBeInViewport();
	});
});
