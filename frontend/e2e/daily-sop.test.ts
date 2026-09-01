import { expect, test, type Page } from '@playwright/test';
import {
	couchLogin,
	couchReq,
	COUCH_BASE,
	SA_ROLES,
	SM_SH001_ROLES,
	type TestUser
} from './helpers/couch';
import { clearSession, injectSession } from './helpers/login';

const APP_BASE_URL = 'http://localhost:4173';
const APP_COUCH_PATTERN = `${APP_BASE_URL}/couch/**`;
const SHELTER_DB = 'shelter_sh001';

async function routeBrowserCouchThroughApp(page: Page): Promise<void> {
	await page.route(`${COUCH_BASE}/**`, async (route) => {
		const request = route.request();
		const origin = new URL(request.url());
		const corsHeaders = {
			'access-control-allow-origin': APP_BASE_URL,
			'access-control-allow-credentials': 'true',
			'access-control-allow-methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
			'access-control-allow-headers':
				request.headers()['access-control-request-headers'] ?? 'Content-Type, Accept'
		};
		if (request.method() === 'OPTIONS') {
			await route.fulfill({ status: 204, headers: corsHeaders });
			return;
		}
		const response = await route.fetch({
			url: `${APP_BASE_URL}/couch${origin.pathname}${origin.search}`
		});
		await route.fulfill({ response, headers: { ...response.headers(), ...corsHeaders } });
	});
}

function todayIso(): string {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Asia/Bangkok',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(new Date());
	const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
	return `${values.year}-${values.month}-${values.day}`;
}

async function deleteAssessment(id: string): Promise<void> {
	const current = await couchReq('GET', `/${SHELTER_DB}/${encodeURIComponent(id)}`);
	if (current.status !== 200) return;
	const doc = current.data as { _rev?: string };
	if (!doc._rev) return;
	await couchReq(
		'DELETE',
		`/${SHELTER_DB}/${encodeURIComponent(id)}?rev=${encodeURIComponent(doc._rev)}`
	);
}

test.describe('Daily SOP — Design workflow', () => {
	test.describe.configure({ mode: 'serial' });
	const user: TestUser = {
		name: 'staff03',
		password: '!Q2w3e4r5t',
		roles: SM_SH001_ROLES,
		display_name: 'staff03'
	};
	const admin: TestUser = {
		name: 'sa01',
		password: '!Q2w3e4r5t',
		roles: SA_ROLES,
		display_name: 'System Admin'
	};
	let session = '';
	let adminSession = '';
	let ownsTodayAssessment = false;
	let editedSeedOriginal: Record<string, unknown> | null = null;

	test.beforeAll(async () => {
		session = await couchLogin(user.name, user.password);
		adminSession = await couchLogin(admin.name, admin.password);
	});

	test.beforeEach(async ({ page }) => {
		await routeBrowserCouchThroughApp(page);
		await injectSession(page, user, session);
	});

	test.afterEach(async ({ page }) => {
		if (ownsTodayAssessment) {
			await deleteAssessment(`daily_sop_assessment:SH001:${todayIso()}`);
			ownsTodayAssessment = false;
		}
		await clearSession(page);
		await page.unrouteAll({ behavior: 'ignoreErrors' });
	});

	test.afterAll(async () => {
		if (editedSeedOriginal?._id) {
			const current = await couchReq(
				'GET',
				`/${SHELTER_DB}/${encodeURIComponent(String(editedSeedOriginal._id))}`
			);
			if (current.status === 200) {
				await couchReq(
					'PUT',
					`/${SHELTER_DB}/${encodeURIComponent(String(editedSeedOriginal._id))}`,
					{
						...editedSeedOriginal,
						_rev: (current.data as { _rev: string })._rev
					}
				);
			}
		}
		if (ownsTodayAssessment) {
			await deleteAssessment(`daily_sop_assessment:SH001:${todayIso()}`);
		}
	});

	test('Resource Dashboard remains on its original route', async ({ page }) => {
		await injectSession(page, admin, adminSession);
		await page.goto('/back-office/resource-dashboard');
		await expect(page).toHaveURL(/\/back-office\/resource-dashboard/);
		await expect(page.getByRole('heading', { name: 'วิเคราะห์ความต้องการเสบียง' })).toBeVisible();
	});

	test('History shows seeded records and the approved 11 June snapshot', async ({ page }) => {
		await page.goto('/back-office/dailysop');
		await expect(page.getByTestId('history-row')).toHaveCount(3);
		const row = page.getByTestId('history-row').first();
		await expect(row).toContainText('11 มิ.ย. 2569');
		await expect(row).toContainText('15:00');
		await expect(row).toContainText('พนักงานประจำศูนย์ หาดใหญ่');
		await expect(row).toContainText('100%');
		await expect(row).toContainText('Completed');
		await expect(page.getByRole('columnheader', { name: 'ผ่าน', exact: true })).toHaveCount(0);
		await expect(page.getByRole('columnheader', { name: 'ความเสี่ยง' })).toHaveCount(0);
		await expect(page.getByText('Online', { exact: true })).toBeVisible();
	});

	test('Saving one answer creates an in-progress history row', async ({
		page
	}) => {
		ownsTodayAssessment = true;
		await page.goto('/back-office/dailysop');
		await page.getByRole('button', { name: 'เริ่มการประเมิน' }).click();
		await expect(page.getByTestId('sop-card')).toHaveCount(7);

		await page.getByRole('button', { name: /1\. ระบบลงทะเบียนผู้ประสบภัย/ }).click();
		await page.getByTestId('status-select').first().selectOption('Pass');
		await page.getByRole('button', { name: 'บันทึกและกลับสู่เมนู' }).click();
		await expect(page).toHaveURL(/view=history/);
		await expect(page.getByTestId('history-row')).toHaveCount(4);
		await expect(page.getByTestId('history-row').first()).toContainText('In Progress');
	});

	test('Connection controls report a real outage and preserve the in-memory draft after retry', async ({
		page
	}) => {
		await page.goto('/back-office/dailysop');
		await page.getByRole('button', { name: 'เริ่มการประเมิน' }).click();
		await page.getByRole('button', { name: /1\. ระบบลงทะเบียนผู้ประสบภัย/ }).click();
		await page.getByTestId('status-select').first().selectOption('Pass');

		await page.route(APP_COUCH_PATTERN, (route) => route.abort('internetdisconnected'));
		await page.getByRole('button', { name: 'ตรวจสอบการเชื่อมต่อและซิงค์ข้อมูลอีกครั้ง' }).click();
		await expect(page.getByText('ออฟไลน์', { exact: true })).toBeVisible();
		await expect(page.getByText('LOCAL OFFLINE MODE ACTIVE')).toBeVisible();

		await page.unroute(APP_COUCH_PATTERN);
		await page.getByRole('button', { name: 'ตรวจสอบการเชื่อมต่อและซิงค์ข้อมูลอีกครั้ง' }).click();
		await expect(page.getByText('Online', { exact: true })).toBeVisible();
		await expect(page.getByTestId('status-select').first()).toHaveValue('Pass');
	});

	test('Daily SOP stays within a 390px viewport', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/back-office/dailysop');
		const dimensions = await page.evaluate(() => ({
			scrollWidth: document.documentElement.scrollWidth,
			clientWidth: document.documentElement.clientWidth
		}));
		expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
	});

	test('Manage edits every status, persists evaluator metadata, and keeps one history row', async ({
		page
	}) => {
		const seedId = 'daily_sop_assessment:SH001:2026-06-09';
		const original = await couchReq('GET', `/${SHELTER_DB}/${encodeURIComponent(seedId)}`);
		expect(original.status).toBe(200);
		editedSeedOriginal = original.data as Record<string, unknown>;
		await page.goto('/back-office/dailysop');
		await page.getByRole('button', { name: 'จัดการ' }).nth(2).click();
		await expect(page.getByTestId('sop-card')).toHaveCount(7);
		await page.getByRole('button', { name: /1\. ระบบลงทะเบียนผู้ประสบภัย/ }).click();
		await expect(page.getByTestId('status-select')).toHaveCount(3);
		await page.getByTestId('status-select').first().selectOption('Fail');
		await page.getByRole('button', { name: 'กลับสู่เมนู' }).click();
		await page.getByRole('button', { name: /7\. สถานะสาธารณูปโภค/ }).click();
		await page.getByTestId('lifeline-select').first().selectOption('Critical');
		await page.getByRole('button', { name: 'กลับสู่เมนู' }).click();
		await expect(page.getByTestId('save-edited-assessment')).toBeVisible();
		await page.getByTestId('save-edited-assessment').click();
		await expect(page).toHaveURL(/\/back-office\/dailysop\?view=history/);
		await expect(
			page.locator('[data-sonner-toast]').filter({ hasText: 'บันทึกการแก้ไขสำเร็จ' })
		).toBeVisible();
		await expect(page.getByTestId('history-row')).toHaveCount(3);
		await page.reload();
		await page.getByRole('button', { name: 'จัดการ' }).nth(2).click();
		await page.getByRole('button', { name: /1\. ระบบลงทะเบียนผู้ประสบภัย/ }).click();
		await expect(page.getByTestId('status-select').first()).toHaveValue('Fail');
		await expect(page.getByText(/ประเมินโดย staff03/).first()).toBeVisible();
	});

	test('Selected Pending creates an in-progress record', async ({
		page
	}) => {
		ownsTodayAssessment = true;
		await page.goto('/back-office/dailysop');
		await page.getByRole('button', { name: 'เริ่มการประเมิน' }).click();
		await page.getByRole('button', { name: /1\. ระบบลงทะเบียนผู้ประสบภัย/ }).click();
		await page.getByTestId('status-select').first().selectOption('Pending');
		await page.getByRole('button', { name: 'บันทึกและกลับสู่เมนู' }).click();
		await expect(page.getByTestId('history-row').first()).toContainText('In Progress');
	});

	test('Happy path creates one Completed snapshot and does not duplicate today', async ({
		page
	}) => {
		const id = `daily_sop_assessment:SH001:${todayIso()}`;
		const existing = await couchReq('GET', `/${SHELTER_DB}/${encodeURIComponent(id)}`);
		test.skip(existing.status === 200, 'today already has a Completed snapshot');
		ownsTodayAssessment = true;

		await page.goto('/back-office/dailysop');
		await page.getByRole('button', { name: 'เริ่มการประเมิน' }).click();
		const sections = [
			/1\. ระบบลงทะเบียนผู้ประสบภัย/,
			/2\. การดูแลกลุ่มเปราะบาง/,
			/3\. การบริหารจัดการอาสาสมัคร/,
			/4\. ระบบสาธารณูปโภคและอาหาร/,
			/5\. ระบบสื่อสารและแจ้งเตือน/,
			/6\. การเชื่อมต่อกับ One Data Platform/
		];
		for (const [index, name] of sections.entries()) {
			if (index > 0) {
				await page.getByRole('button', { name: 'จัดการ' }).first().click();
			}
			await page.getByRole('button', { name }).click();
			await page.getByTestId('status-select').evaluateAll((selects) => {
				for (const select of selects) (select as HTMLSelectElement).value = 'Pass';
			});
			await page.getByTestId('status-select').evaluateAll((selects) => {
				for (const select of selects) select.dispatchEvent(new Event('change', { bubbles: true }));
			});
			await page.getByTestId(index === 0 ? 'save-section-draft' : 'save-edited-section').click();
		}
		await page.getByRole('button', { name: 'จัดการ' }).first().click();
		await page.getByRole('button', { name: /7\. สถานะสาธารณูปโภค/ }).click();
		await page.getByTestId('lifeline-select').evaluateAll((selects) => {
			for (const select of selects) (select as HTMLSelectElement).value = 'Operational';
		});
		await page.getByTestId('lifeline-select').evaluateAll((selects) => {
			for (const select of selects) select.dispatchEvent(new Event('change', { bubbles: true }));
		});
		await page.getByTestId('save-edited-section').click();
		await expect(page).toHaveURL(/view=history/);
		await page.goto('/back-office/dailysop');
		await expect(page.getByTestId('history-row')).toHaveCount(4);
		await expect(page.getByTestId('history-row').first()).toContainText('Completed');
	});
});
