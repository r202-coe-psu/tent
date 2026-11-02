/**
 * E2E: staff hide/show a person in the public relative search (#790, T-40) — real CouchDB →
 * sync worker → Mongo → FastAPI → BFF path, nothing mocked.
 *
 * Arrange: a per-run `E2E …` shelter is created through the UI and two active evacuees are
 * seeded into its database (a checked-in person is the precondition of the household wizard,
 * not what this suite tests). Flow: hide from the detail page → public search no longer finds
 * the person → the household wizard still offers them → show again → found again.
 *
 * Requires the full stack (see public-search-flow.test.ts). Teardown removes the shelter.
 */
import { test, expect } from '@playwright/test';
import { bootstrapAdminSession, couchReq } from './helpers/couch';
import { CAN_WRITE, READ_ONLY_REASON } from './helpers/e2e-env';
import { injectSession, routeBrowserCouchThroughApp } from './helpers/login';
import { mockSystemBanner } from './helpers/pre-register';
import { publicSearchCount, teardownShelter, waitForProjection } from './helpers/public-cleanup';
import { createShelterViaUi, selectActiveShelter } from './helpers/staff-ui';

const RUN_ID = Date.now().toString(36);
const LAST_NAME = `ซ่อนค้นหา${RUN_ID}`;
const HEAD_NAME = `หัวหน้าซ่อน${RUN_ID}`;
const MEMBER_NAME = `สมาชิกซ่อน${RUN_ID}`;
const SEARCH_PLACEHOLDER = 'เลขบัตรประชาชน / เบอร์โทร / ชื่อ-นามสกุล...';

let shelterCode: string | undefined;
let memberId = '';
let headId = '';

function evacueeDoc(id: string, firstName: string, code: string, n: number) {
	const now = new Date().toISOString();
	return {
		_id: id,
		type: 'evacuee',
		schema_v: 10,
		shelter_code: code,
		created_at: now,
		updated_at: now,
		created_by: 'e2e',
		first_name: firstName,
		last_name: LAST_NAME,
		gender: 'male',
		phone: null,
		person_id: { cardType: 'national_id', number: `3${String(Date.now()).slice(-7)}${n}0000` },
		religion: 'buddhist',
		country: 'THAILAND',
		vulnerable_groups: [],
		special_needs: [],
		household_id: null,
		current_stay: { status: 'active', zone: null, since: now },
		privacy: { search_excluded: false },
		registered_via: 'staff'
	};
}

test.afterAll(async () => {
	test.setTimeout(120_000);
	if (shelterCode) await teardownShelter(shelterCode);
});

test.describe('Search visibility toggle', { tag: ['@critical'] }, () => {
	test.describe.configure({ mode: 'serial' });
	test.skip(!CAN_WRITE, READ_ONLY_REASON);

	test.beforeEach(async ({ page }) => {
		await mockSystemBanner(page, false);
	});

	test('hide, still groupable into a household, show again', async ({ page }) => {
		test.setTimeout(240_000);
		const admin = await bootstrapAdminSession();
		await routeBrowserCouchThroughApp(page);
		await injectSession(page, admin.user, admin.cookie);

		shelterCode = await createShelterViaUi(page, {
			name: `E2E ศูนย์ซ่อนค้นหา ${RUN_ID}`,
			siteKind: 'evacuation_center',
			lat: 7.0,
			lng: 100.47,
			subdistrict: 'คอหงส์',
			capacity: 50
		});
		await selectActiveShelter(page, shelterCode);

		headId = `evacuee:E2EVIS${RUN_ID.toUpperCase()}HEAD`;
		memberId = `evacuee:E2EVIS${RUN_ID.toUpperCase()}MEMBER`;
		const db = `/shelter_${shelterCode.toLowerCase()}`;
		const seeded = await couchReq('POST', `${db}/_bulk_docs`, {
			docs: [
				evacueeDoc(headId, HEAD_NAME, shelterCode, 1),
				evacueeDoc(memberId, MEMBER_NAME, shelterCode, 2)
			]
		});
		expect(seeded.status).toBeLessThan(300);

		await waitForProjection(
			'member visible in public search',
			async () => (await publicSearchCount(MEMBER_NAME)) === 1,
			{ timeoutMs: 75_000, intervalMs: 3_000 }
		);

		const toggle = page.getByRole('switch', { name: 'แสดงในระบบค้นหาญาติ' });
		const dialog = page.getByRole('alertdialog');
		await page.goto(`/onsite/people/evacuee-profile-view/${encodeURIComponent(memberId)}`);
		await expect(toggle).toBeChecked();

		await toggle.click();
		await expect(dialog).toContainText('เจ้าตัวเป็นผู้ขอ');
		await dialog.getByRole('button', { name: 'ยืนยัน', exact: true }).click();
		await expect(page.getByText('ซ่อนจากระบบค้นหาญาติแล้ว')).toBeVisible();
		await expect(toggle).not.toBeChecked();

		await waitForProjection(
			'member gone from public search',
			async () => (await publicSearchCount(MEMBER_NAME)) === 0,
			{ timeoutMs: 20_000, intervalMs: 3_000 }
		);
		expect(await publicSearchCount(HEAD_NAME)).toBe(1);

		await page.goto('/back-office/households/new');
		await page.getByPlaceholder(SEARCH_PLACEHOLDER).fill(`${HEAD_NAME} ${LAST_NAME}`);
		await page
			.locator('div.justify-between')
			.filter({ has: page.getByText(`${HEAD_NAME} ${LAST_NAME}`, { exact: true }) })
			.getByRole('button', { name: 'เลือกเป็นหัวหน้า' })
			.click();
		await page.getByRole('button', { name: 'ขั้นตอนถัดไป' }).click();
		await page.getByPlaceholder(SEARCH_PLACEHOLDER).fill(`${MEMBER_NAME} ${LAST_NAME}`);
		const hit = page
			.locator('div.justify-between')
			.filter({ has: page.getByText(`${MEMBER_NAME} ${LAST_NAME}`, { exact: true }) })
			.first();
		await hit.getByRole('button', { name: 'เพิ่มสมาชิก' }).click();
		await expect(hit.getByRole('button', { name: 'เพิ่มแล้ว ✓' })).toBeDisabled();

		await page.goto(`/onsite/people/evacuee-profile-view/${encodeURIComponent(memberId)}`);
		await expect(toggle).not.toBeChecked();
		await toggle.click();
		await dialog.getByRole('button', { name: 'ยืนยัน', exact: true }).click();
		await expect(page.getByText('เปิดการแสดงในระบบค้นหาญาติแล้ว')).toBeVisible();

		await waitForProjection(
			'member visible again',
			async () => (await publicSearchCount(MEMBER_NAME)) === 1,
			{ timeoutMs: 20_000, intervalMs: 3_000 }
		);
	});
});
