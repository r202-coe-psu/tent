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
/** `_rev` the mocked registry serves; the form must send it back on PATCH (CR-230 A1). */
const E2E_REV = '4-e2e';

async function mockShelterDetail(
	page: Page,
	code: string,
	shelter: Record<string, unknown>
): Promise<{ getPatchBody: () => unknown }> {
	let stored: Record<string, unknown> = {
		_id: `shelter:${code}`,
		_rev: E2E_REV,
		type: 'shelter',
		schema_v: 6,
		code,
		...shelter
	};
	await page.route('**/registry/_all_docs*', async (route) => {
		const rows = [{ id: `shelter:${code}`, doc: stored }];
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
			// Persist like the server: a later save then reloads the doc this one wrote.
			const { _rev, common_areas, ...patch } = patchBody as Record<string, unknown> & {
				common_areas?: Record<string, unknown>;
			};
			stored = {
				...stored,
				...patch,
				common_areas: { ...(stored.common_areas as object), ...common_areas },
				_rev: `${Number.parseInt(String(_rev ?? E2E_REV), 10) + 1}-e2e`
			};
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ ok: true, code, rev: stored._rev })
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
		await expect(page.getByText('ประเภทอาคาร', { exact: true })).toBeVisible();
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

		// An untouched `sub_storage` is left out of the PATCH (CR-230 A1), so edit the point to send it.
		await page.getByLabel('ชื่อจุดเก็บของ').fill('ห้องยาเดิม (แก้ไข)');
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

type DropOffPatch = {
	common_areas: {
		sub_storage: {
			accepts_donations: boolean;
			lat: number | null;
			lng: number | null;
			location_note: string | null;
		}[];
	};
};

test.describe('Shelter Form — Donation drop-off points (CR-205)', () => {
	const gym = { id: 'sp-1', name: 'โรงยิม', types: ['general'], area_m2: null };

	async function openStorage(page: import('@playwright/test').Page, code: string) {
		await injectSession(page, SA, sessions[SA.name]);
		await page.goto(`http://localhost:4173/back-office/shelters/edit/${code}`);
		await sectionNav(page, STORAGE_HEADING).click();
	}

	async function pin(page: import('@playwright/test').Page, lat: string, lng: string) {
		await page.getByRole('button', { name: 'ปักหมุดตำแหน่ง' }).click();
		const dialog = page.getByRole('dialog');
		await dialog.getByLabel('ละติจูด (Latitude)').fill(lat);
		await dialog.getByLabel('ลองจิจูด (Longitude)').fill(lng);
		await page.getByRole('button', { name: 'ยืนยันปักหมุด' }).click();
	}

	const save = (page: import('@playwright/test').Page, code: string) => {
		const patched = page.waitForResponse(
			(res) =>
				res.request().method() === 'PATCH' && res.url().endsWith(`/api/back-office/shelter/${code}`)
		);
		return page
			.getByRole('button', { name: 'บันทึกข้อมูล' })
			.click()
			.then(() => patched);
	};

	test('saving without touching the storage points leaves sub_storage out of the PATCH (CR-230 A1)', async ({
		page
	}) => {
		const CODE = 'SH914';
		const { getPatchBody } = await mockShelterDetail(page, CODE, storageShelter([gym]));
		await openStorage(page, CODE);

		await save(page, CODE);
		const body = getPatchBody() as { _rev?: string; common_areas?: Record<string, unknown> };
		expect(body.common_areas).not.toHaveProperty('sub_storage');
		expect(body._rev).toBe(E2E_REV);
		expect(body).not.toHaveProperty('_loaded_sub_storage');
	});

	test('a save refused as stale reloads the form, so the next save cannot drop a point added elsewhere (CR-230 A1)', async ({
		page
	}) => {
		const CODE = 'SH915';
		const added = { id: 'sp-2', name: 'โกดังคลัง', types: ['general'], area_m2: null };
		// What the registry serves now; the warehouse adds a point after the form has loaded.
		let served = { rev: E2E_REV, points: [gym] };
		await page.route('**/registry/_all_docs*', async (route) => {
			const doc = {
				_id: `shelter:${CODE}`,
				_rev: served.rev,
				type: 'shelter',
				schema_v: 8,
				code: CODE,
				...storageShelter(served.points, 8)
			};
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ rows: [{ id: doc._id, doc }] })
			});
		});
		const patches: { status: number; body: Record<string, unknown> }[] = [];
		await page.route(`**/api/back-office/shelter/${CODE}`, async (route) => {
			if (route.request().method() !== 'PATCH') return route.continue();
			const body = route.request().postDataJSON();
			const stale = body._rev !== served.rev;
			patches.push({ status: stale ? 409 : 200, body });
			await route.fulfill({
				status: stale ? 409 : 200,
				contentType: 'application/json',
				body: JSON.stringify(
					stale
						? { error: { code: 'CONFLICT', message: 'ข้อมูลศูนย์ถูกแก้ไขโดยผู้อื่น' } }
						: { ok: true, code: CODE, rev: '6-e2e' }
				)
			});
		});
		await openStorage(page, CODE);
		const pointNames = page.locator('input[name^="common_areas.sub_storage["][name$=".name"]');
		await expect(pointNames).toHaveCount(1);

		served = { rev: '5-e2e', points: [gym, added] };
		await page.getByLabel('ชื่อจุดเก็บของ').fill('โรงยิม (แก้ไข)');
		await save(page, CODE);
		expect(patches[0]).toMatchObject({ status: 409, body: { _rev: E2E_REV } });

		// The form reloads the latest doc (fields and `_rev` together) instead of staying stale.
		await expect(pointNames).toHaveCount(2);
		await expect(pointNames.nth(1)).toHaveValue('โกดังคลัง');

		await save(page, CODE);
		expect(patches).toHaveLength(2);
		expect(patches[1].status).toBe(200);
		expect(patches[1].body._rev).toBe('5-e2e');
		const sent = (patches[1].body.common_areas as { sub_storage?: { name: string }[] }).sub_storage;
		if (sent) expect(sent.map((p) => p.name)).toContain('โกดังคลัง');
	});

	type Served = { rev: string; name: string; points: unknown[]; status?: string };

	/** Serves `get()` as the registry shelter doc and lets the test fire the registry `_changes` feed. */
	async function serveWithFeed(page: Page, code: string, get: () => Served) {
		await page.route('**/registry/_all_docs*', async (route) => {
			const served = get();
			const doc = {
				_id: `shelter:${code}`,
				_rev: served.rev,
				type: 'shelter',
				schema_v: 8,
				code,
				...storageShelter(served.points, 8),
				// Set, so the master-data default seeding does not edit the form on load.
				shelter_type: 'school',
				name: served.name,
				operation_status: served.status ?? 'standby'
			};
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ rows: [{ id: doc._id, doc }] })
			});
		});
		let feedDue = false;
		await page.route('**/registry/_changes*', async (route) => {
			for (let waited = 0; !feedDue && waited < 2000; waited += 50) {
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			const results = feedDue ? [{ id: `shelter:${code}`, doc: { type: 'shelter' } }] : [];
			feedDue = false;
			await route
				.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ results, last_seq: String(Date.now()) })
				})
				.catch(() => {});
		});
		// The feed reports the shelter doc as changed, which refetches the detail query.
		return async () => {
			feedDue = true;
			await expect.poll(() => feedDue, { timeout: 8000 }).toBe(false);
		};
	}

	test('an unsaved edit survives a registry refresh and a notice offers the latest (#1224)', async ({
		page
	}) => {
		const CODE = 'SH916';
		let served: Served = { rev: E2E_REV, name: 'ศูนย์พักพิงจุดเก็บของ', points: [gym] };
		const refresh = await serveWithFeed(page, CODE, () => served);
		await openStorage(page, CODE);
		const pointName = page.getByLabel('ชื่อจุดเก็บของ');
		await expect(pointName).toHaveValue('โรงยิม');
		// Untouched form: the new doc is taken silently.
		served = { rev: '5-e2e', name: 'ชื่อจากคนอื่น', points: [gym] };
		await refresh();
		await expect(page.getByLabel('ชื่อศูนย์พักพิง')).toHaveValue('ชื่อจากคนอื่น');
		await expect(page.getByText('มีข้อมูลใหม่')).toHaveCount(0);

		// Edited form: the typed value stays and the notice appears.
		await pointName.fill('โรงยิม (แก้ไข)');
		served = { rev: '6-e2e', name: 'ชื่อจากคนอื่นอีกครั้ง', points: [gym] };
		await refresh();
		await expect(page.getByText('มีข้อมูลใหม่')).toBeVisible();
		await expect(pointName).toHaveValue('โรงยิม (แก้ไข)');
		await expect(page.getByLabel('ชื่อศูนย์พักพิง')).toHaveValue('ชื่อจากคนอื่น');

		await page.getByRole('button', { name: 'โหลดข้อมูลล่าสุด' }).click();
		await expect(page.getByLabel('ชื่อศูนย์พักพิง')).toHaveValue('ชื่อจากคนอื่นอีกครั้ง');
		await expect(pointName).toHaveValue('โรงยิม');
		await expect(page.getByText('มีข้อมูลใหม่')).toHaveCount(0);
	});

	test('two saves in a row without a reload: the second sends the rev the first returned (#1224)', async ({
		page
	}) => {
		const CODE = 'SH917';
		const { getPatchBody } = await mockShelterDetail(page, CODE, storageShelter([gym]));
		await openStorage(page, CODE);

		await page.getByLabel('ชื่อจุดเก็บของ').fill('โรงยิม 1');
		const first = await save(page, CODE);
		expect(first.status()).toBe(200);
		expect((getPatchBody() as { _rev?: string })._rev).toBe(E2E_REV);

		await page.getByLabel('ชื่อจุดเก็บของ').fill('โรงยิม 2');
		const second = await save(page, CODE);
		expect(second.status()).toBe(200);
		const body = getPatchBody() as {
			_rev?: string;
			common_areas: { sub_storage: { name: string }[] };
		};
		expect(body._rev).toBe('5-e2e');
		expect(body.common_areas.sub_storage[0].name).toBe('โรงยิม 2');
	});

	test('closing is refused when points edited here changed in the doc since load (#1224)', async ({
		page
	}) => {
		const CODE = 'SH918';
		const NAME = 'ศูนย์พักพิงจุดเก็บของ';
		const added = { id: 'sp-2', name: 'โกดังคลัง', types: ['general'], area_m2: null };
		let served: Served = { rev: E2E_REV, name: NAME, points: [gym] };
		const refresh = await serveWithFeed(page, CODE, () => served);
		const patches: unknown[] = [];
		await page.route(`**/api/back-office/shelter/${CODE}`, async (route) => {
			if (route.request().method() === 'PATCH') patches.push(route.request().postDataJSON());
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ ok: true, code: CODE, rev: '9-e2e' })
			});
		});
		await page.route(`**/api/back-office/shelter/${CODE}/close`, async (route) => {
			const closed = route.request().method() === 'POST';
			// The close route rewrites the doc (new `_rev`, closed) but not the points.
			if (closed) served = { ...served, rev: '7-e2e', status: 'closed' };
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(
					closed
						? { closed: true, checked_out: 0, cancelled: 0, failed: [] }
						: { total: 0, by_status: {} }
				)
			});
		});
		await openStorage(page, CODE);
		const pointNames = page.locator('input[name^="common_areas.sub_storage["][name$=".name"]');
		await page.getByLabel('ชื่อจุดเก็บของ').fill('โรงยิม (แก้ไข)');

		// The warehouse adds a point; the feed refetches the doc, the typed rename stays.
		served = { rev: '5-e2e', name: NAME, points: [gym, added] };
		await refresh();
		await expect(page.getByText('มีข้อมูลใหม่')).toBeVisible();
		await expect(pointNames).toHaveCount(1);

		await sectionNav(page, BASIC_INFO_HEADING).click();
		await page.getByRole('button', { name: 'สถานะการปฏิบัติการ (Operating Status)' }).click();
		await page.getByRole('option', { name: 'ปิดศูนย์ (Closed)' }).click();
		await page.getByRole('button', { name: 'บันทึกข้อมูล' }).click();
		await page.getByLabel('พิมพ์ข้อความต่อไปนี้เพื่อยืนยัน').fill(`${CODE} ${NAME}`);
		await page.getByRole('button', { name: 'เช็คเอาต์ทั้งหมดและปิดศูนย์' }).click();

		await expect(
			page.getByText('ข้อมูลศูนย์ถูกแก้ไขโดยผู้อื่น โหลดข้อมูลล่าสุดให้แล้ว กรุณาแก้ไขซ้ำอีกครั้ง')
		).toBeVisible();
		// Nothing was written over the new point, and the form now shows the latest doc.
		expect(patches).toHaveLength(0);
		await expect(pointNames).toHaveCount(2);
		await expect(pointNames.nth(0)).toHaveValue('โรงยิม');
	});

	test('a schema_v 8 point with no new keys saves as not accepting donations', async ({ page }) => {
		const CODE = 'SH910';
		const { getPatchBody } = await mockShelterDetail(page, CODE, storageShelter([gym]));
		await openStorage(page, CODE);
		await expect(page.getByRole('checkbox', { name: 'ใช้เป็นจุดรับบริจาค' })).not.toBeChecked();

		// An untouched `sub_storage` is left out of the PATCH (CR-230 A1), so edit the point to send it.
		await page.getByLabel('ชื่อจุดเก็บของ').fill('โรงยิม (แก้ไข)');
		await save(page, CODE);
		const body = getPatchBody() as DropOffPatch;
		expect(body.common_areas.sub_storage[0]).toMatchObject({
			accepts_donations: false,
			lat: null,
			lng: null,
			location_note: null
		});
	});

	test('tick + pin + note saves all four fields; unticking keeps the pin', async ({ page }) => {
		const CODE = 'SH911';
		const { getPatchBody } = await mockShelterDetail(page, CODE, storageShelter([gym]));
		await openStorage(page, CODE);

		await page.getByRole('checkbox', { name: 'ใช้เป็นจุดรับบริจาค' }).click();
		await pin(page, '7.0086', '100.4747');
		await expect(page.getByText('พิกัดปัจจุบัน: 7.0086, 100.4747')).toBeVisible();
		await page.getByLabel('คำอธิบายตำแหน่งสำหรับผู้มาส่ง').fill('  ประตู 2 ข้างโรงยิม ');

		await save(page, CODE);
		expect((getPatchBody() as DropOffPatch).common_areas.sub_storage[0]).toMatchObject({
			accepts_donations: true,
			lat: 7.0086,
			lng: 100.4747,
			location_note: 'ประตู 2 ข้างโรงยิม'
		});

		await page.getByRole('checkbox', { name: 'ใช้เป็นจุดรับบริจาค' }).click();
		await save(page, CODE);
		expect((getPatchBody() as DropOffPatch).common_areas.sub_storage[0]).toMatchObject({
			accepts_donations: false,
			lat: 7.0086,
			lng: 100.4747,
			location_note: 'ประตู 2 ข้างโรงยิม'
		});
	});

	test('ticking without a pin blocks save with the error on that row', async ({ page }) => {
		const CODE = 'SH912';
		const { getPatchBody } = await mockShelterDetail(page, CODE, storageShelter([gym]));
		await openStorage(page, CODE);

		await page.getByRole('checkbox', { name: 'ใช้เป็นจุดรับบริจาค' }).click();
		await page.getByRole('button', { name: 'บันทึกข้อมูล' }).click();
		await expect(
			page.locator('[data-fs-field-error]').filter({ hasText: 'จุดรับบริจาคต้องปักหมุดตำแหน่ง' })
		).toBeVisible();
		expect(getPatchBody()).toBeNull();
	});

	test('a (0, 0) pin is refused with the error on that row', async ({ page }) => {
		const CODE = 'SH913';
		const { getPatchBody } = await mockShelterDetail(page, CODE, storageShelter([gym]));
		await openStorage(page, CODE);

		await page.getByRole('checkbox', { name: 'ใช้เป็นจุดรับบริจาค' }).click();
		await pin(page, '0', '0');
		await page.getByRole('button', { name: 'บันทึกข้อมูล' }).click();
		await expect(
			page.locator('[data-fs-field-error]').filter({ hasText: 'พิกัด 0, 0 ไม่ใช่ตำแหน่งจริง' })
		).toBeVisible();
		expect(getPatchBody()).toBeNull();
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
