import { expect, test, type Page } from '@playwright/test';
import {
	couchLogin,
	couchReq,
	createCouchUser,
	deleteCouchUser,
	COUCH_BASE,
	SM_SH001_ROLES,
	STAFF_SH001_ROLES,
	type TestUser
} from './helpers/couch';
import { clearSession, injectSession } from './helpers/login';

type CouchDocument = { _id: string; _rev: string; [key: string]: unknown };
type AllDocsResult = { rows?: Array<{ doc?: CouchDocument }> };

const SHELTER_DB = 'shelter_sh001';
const APP_BASE_URL = 'http://localhost:4173';

/**
 * Keep T-42's browser transport self-contained when the shared test environment
 * intentionally leaves PUBLIC_COUCH_PROXY empty. Requests still reach the real
 * CouchDB through Vite's existing /couch proxy; no response data is mocked.
 */
async function routeBrowserCouchThroughApp(page: Page) {
	await page.route(`${COUCH_BASE}/**`, async (route) => {
		const request = route.request();
		const origin = new URL(request.url());
		const allowOrigin = new URL(APP_BASE_URL).origin;
		const corsHeaders = {
			'access-control-allow-origin': allowOrigin,
			'access-control-allow-credentials': 'true',
			'access-control-allow-methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
			'access-control-allow-headers':
				request.headers()['access-control-request-headers'] ?? 'Content-Type, Accept',
			'access-control-expose-headers': 'ETag, Location, Content-Type'
		};

		if (request.method() === 'OPTIONS') {
			await route.fulfill({ status: 204, headers: corsHeaders });
			return;
		}

		const response = await route.fetch({
			url: `${APP_BASE_URL}/couch${origin.pathname}${origin.search}`
		});
		await route.fulfill({
			response,
			headers: { ...response.headers(), ...corsHeaders }
		});
	});
}

function uniqueUser(prefix: string, roles: string[]): TestUser {
	const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
	return {
		name: `${prefix}_${suffix}`,
		password: 'Password1!',
		roles,
		display_name: `T-42 ${prefix}`
	};
}

async function openAs(page: Page, user: TestUser, path: string) {
	await routeBrowserCouchThroughApp(page);
	await createCouchUser(user);
	const session = await couchLogin(user.name, user.password);
	await injectSession(page, user, session);
	await page.goto(path);
}

async function documentsWithPrefix(prefix: string): Promise<CouchDocument[]> {
	const start = encodeURIComponent(JSON.stringify(`${prefix}:`));
	const end = encodeURIComponent(JSON.stringify(`${prefix};`));
	const response = await couchReq(
		'GET',
		`/${SHELTER_DB}/_all_docs?include_docs=true&startkey=${start}&endkey=${end}`
	);
	if (response.status !== 200) throw new Error(`Could not list ${prefix} documents`);
	return ((response.data as AllDocsResult).rows ?? [])
		.flatMap((row) => (row.doc ? [row.doc] : []))
		.sort((left, right) => left._id.localeCompare(right._id));
}

async function deleteDocument(document: CouchDocument | null) {
	if (!document) return;
	const response = await couchReq(
		'DELETE',
		`/${SHELTER_DB}/${encodeURIComponent(document._id)}?rev=${encodeURIComponent(document._rev)}`
	);
	if (response.status !== 200 && response.status !== 202 && response.status !== 404) {
		throw new Error(`Could not clean up ${document._id} (HTTP ${response.status})`);
	}
}

async function findScenarioByName(name: string): Promise<CouchDocument | null> {
	const scenarios = await documentsWithPrefix('simulation');
	return (
		scenarios.find(
			(document) =>
				(document.result as { input?: { name?: string } } | undefined)?.input?.name === name
		) ?? null
	);
}

async function waitForWorkspace(page: Page) {
	await expect(
		page.getByRole('heading', { name: 'จำลองสถานการณ์ SOP (SOP What-if Simulation)' })
	).toBeVisible();
	await expect(page.getByRole('button', { name: 'รันสถานการณ์' })).toBeVisible();
}

test.describe('T-42 SOP what-if simulation', () => {
	test.afterEach(async ({ page }) => {
		await clearSession(page);
	});

	test('blocks a user without manager permission', async ({ page }) => {
		const user = uniqueUser('t42_staff', STAFF_SH001_ROLES);
		try {
			await openAs(page, user, '/back-office/sop-simulation');
			await expect(page).toHaveURL(/\/portal$/, { timeout: 8_000 });
		} finally {
			await deleteCouchUser(user.name);
		}
	});

	test('keeps an override draft but excludes it from general mode', async ({ page }) => {
		const user = uniqueUser('t42_mode', SM_SH001_ROLES);
		try {
			await openAs(page, user, '/back-office/sop-simulation');
			await waitForWorkspace(page);

			await page.getByRole('tab', { name: /ปรับเกณฑ์ใน Scenario/ }).click();
			await page.getByRole('button', { name: 'เลือกค่าที่จะปรับ' }).click();
			await page.getByRole('switch', { name: 'เปลี่ยนค่า น้ำ (รวม)' }).click();
			await page.getByLabel('อัตราใน Scenario').fill('18');
			await page.getByRole('button', { name: 'เสร็จสิ้น' }).click();

			await page.getByRole('tab', { name: /จำลองทั่วไป/ }).click();
			await page.getByLabel(/ชื่อสถานการณ์/).fill(`โหมดทั่วไป ${Date.now()}`);
			await page.getByLabel('ผู้พักพิงในสถานการณ์').fill('2000');
			await page.getByLabel('ระยะเวลาสถานการณ์').fill('14');
			await page.getByRole('button', { name: 'รันสถานการณ์' }).click();

			const output = page.getByRole('region', { name: 'ผลเทียบกับปัจจุบัน' });
			await expect(output.getByText('จำลองทั่วไป', { exact: true })).toBeVisible();
			await expect(output.getByText('ใช้เกณฑ์ SOP ปัจจุบันทั้งหมด')).toBeVisible();
		} finally {
			await deleteCouchUser(user.name);
		}
	});

	test('submits enabled ratio overrides when the form is submitted with Enter', async ({
		page
	}) => {
		const user = uniqueUser('t42_enter', SM_SH001_ROLES);
		try {
			await openAs(page, user, '/back-office/sop-simulation');
			await waitForWorkspace(page);

			await page.getByRole('tab', { name: /ปรับเกณฑ์ใน Scenario/ }).click();
			await page.getByRole('button', { name: 'เลือกค่าที่จะปรับ' }).click();
			await page.getByRole('switch', { name: 'เปลี่ยนค่า น้ำ (รวม)' }).click();
			await page.getByLabel('อัตราใน Scenario').fill('18');
			await page.getByRole('button', { name: 'เสร็จสิ้น' }).click();
			await page.getByLabel(/ชื่อสถานการณ์/).fill(`กด Enter ${Date.now()}`);
			await page.getByLabel('ผู้พักพิงในสถานการณ์').fill('2000');
			await page.getByLabel('ระยะเวลาสถานการณ์').fill('14');
			await page.getByLabel('ระยะเวลาสถานการณ์').press('Enter');

			const output = page.getByRole('region', { name: 'ผลเทียบกับปัจจุบัน' });
			await expect(output.getByText('ปรับเกณฑ์ใน Scenario', { exact: true })).toBeVisible();
			await expect(output.getByText('ปรับอัตราเฉพาะผลจำลอง 1 รายการ')).toBeVisible();
		} finally {
			await deleteCouchUser(user.name);
		}
	});

	test('rejects an enabled ratio override whose value is empty', async ({ page }) => {
		const user = uniqueUser('t42_empty_ratio', SM_SH001_ROLES);
		try {
			await openAs(page, user, '/back-office/sop-simulation');
			await waitForWorkspace(page);

			await page.getByRole('tab', { name: /ปรับเกณฑ์ใน Scenario/ }).click();
			await page.getByRole('button', { name: 'เลือกค่าที่จะปรับ' }).click();
			await page.getByRole('switch', { name: 'เปลี่ยนค่า น้ำ (รวม)' }).click();
			await page.getByLabel('อัตราใน Scenario').fill('');
			await page.getByRole('button', { name: 'เสร็จสิ้น' }).click();
			await page.getByLabel(/ชื่อสถานการณ์/).fill(`ค่าว่าง ${Date.now()}`);
			await page.getByRole('button', { name: 'รันสถานการณ์' }).click();

			await expect(
				page.getByText('ตรวจสอบชื่อสถานการณ์ จำนวนผู้พักพิง จำนวนวัน และอัตรามาตรฐาน')
			).toBeVisible();
			await expect(page.getByText('คำนวณสถานการณ์แล้ว')).not.toBeVisible();
		} finally {
			await deleteCouchUser(user.name);
		}
	});

	test('runs, saves, reloads and opens a flood scenario without changing daily_calc', async ({
		page
	}) => {
		const user = uniqueUser('t42_flow', SM_SH001_ROLES);
		const scenarioName = `น้ำท่วม 2,000 คน 14 วัน ${Date.now()}`;
		let savedScenario: CouchDocument | null = null;
		try {
			const dailyCalcBefore = await documentsWithPrefix('daily_calc');
			await openAs(page, user, '/back-office/sop-simulation');
			await waitForWorkspace(page);

			await page.getByLabel(/ชื่อสถานการณ์/).fill(scenarioName);
			await page.getByLabel('ผู้พักพิงในสถานการณ์').fill('2000');
			await page.getByLabel('ระยะเวลาสถานการณ์').fill('14');
			await page.getByRole('button', { name: 'รันสถานการณ์' }).click();

			const output = page.getByRole('region', { name: 'ผลเทียบกับปัจจุบัน' });
			await expect(output.getByRole('heading', { name: scenarioName })).toBeVisible();
			await output.getByRole('button', { name: 'บันทึกผล' }).click();
			await expect(output.getByText('บันทึกแล้ว')).toBeVisible();

			savedScenario = await findScenarioByName(scenarioName);
			expect(savedScenario).not.toBeNull();

			await page.reload();
			await page.getByRole('button', { name: /ผลที่บันทึก/ }).click();
			await page.getByRole('button', { name: `เปิดผล ${scenarioName}` }).click();
			await expect(output.getByRole('heading', { name: scenarioName })).toBeVisible();
			await expect(output.getByText('ผลที่บันทึกไว้ · เปิดดูโดยไม่คำนวณใหม่')).toBeVisible();

			const dailyCalcAfter = await documentsWithPrefix('daily_calc');
			expect(dailyCalcAfter).toEqual(dailyCalcBefore);
		} finally {
			await deleteDocument(savedScenario ?? (await findScenarioByName(scenarioName)));
			await deleteCouchUser(user.name);
		}
	});

	for (const width of [320, 375, 414, 768]) {
		test(`keeps the scenario controls usable at ${width}px`, async ({ page }) => {
			const user = uniqueUser(`t42_${width}`, SM_SH001_ROLES);
			try {
				await page.setViewportSize({ width, height: 800 });
				await openAs(page, user, '/back-office/sop-simulation');
				await waitForWorkspace(page);
				await expect(page.getByRole('tablist', { name: 'รูปแบบการจำลอง' })).toBeVisible();
				await expect(page.getByRole('button', { name: 'รันสถานการณ์' })).toBeVisible();
				const overflows = await page.evaluate(
					() => document.documentElement.scrollWidth > window.innerWidth
				);
				expect(overflows).toBe(false);
			} finally {
				await deleteCouchUser(user.name);
			}
		});
	}
});
