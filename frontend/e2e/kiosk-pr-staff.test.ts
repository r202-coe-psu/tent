/**
 * `pr_staff` (เจ้าหน้าที่ประชาสัมพันธ์, issue #930) — a PR officer of one shelter runs the kiosk
 * banners and nothing else.
 *
 * One serial suite on its own `E2E` shelter (never SH001). Arrange: the CouchDB server admin
 * provisions the shelter through the staff UI, the one device through the device API (the only
 * writer — SA / SM) and one `pr_staff` account through CouchDB `_users`. Then, as that account:
 *   - portal: only the department "ฝ่ายประชาสัมพันธ์" with the single tile "ข่าวสารบน Kiosk"
 *   - banners: creates a group and a banner (image included) in the UI, binds the group to the
 *     device from the group page; the device chip offers "ดู PIN" and the dialog is read-only
 *     (no set / regenerate button)
 *   - confinement: /back-office/kiosks and /back-office/users bounce back to the portal
 *   - the device's own banner feed (device id + secret, no staff session) now returns the banner
 *
 * Data safety: the device (and its PIN in `scanner_secrets`), the group and the banner are deleted
 * in afterAll, then the shelter by `teardownShelter`; the account is removed too. Every name
 * carries the `E2E` marker and the run id.
 *
 * Tags: `@kiosk` + `@critical` (+ `@back-office`). Runs locally, or on a remote target with
 * `ALLOW_REMOTE_WRITES=true`; skipped (read-only) otherwise.
 *
 * Local: `docker compose up -d`, `pnpm seed:master`, then
 *   pnpm exec vite build --mode test
 *   PLAYWRIGHT_TEST_BASE_URL=http://localhost:4173 pnpm exec playwright test e2e/kiosk-pr-staff.test.ts
 */
import { test, expect, type Page } from '@playwright/test';
import {
	bootstrapAdminSession,
	couchLogin,
	couchReq,
	createCouchUser,
	deleteCouchUser,
	seedSecurityQuestion,
	type TestUser
} from './helpers/couch';
import { appBaseUrl, CAN_WRITE, LOCAL_RUN_ID as RUN_ID, READ_ONLY_REASON } from './helpers/e2e-env';
import { clearSession, injectSession, routeBrowserCouchThroughApp } from './helpers/login';
import { recordCreatedShelter, teardownShelter } from './helpers/public-cleanup';
import { createShelterViaUi } from './helpers/staff-ui';
import { bangkokToday } from '../src/lib/utils/date';

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 15_000 });

const PASSWORD = 'Password1!';
const MARKER = `E2E PR ${RUN_ID}`;
const DEVICE_ID = `e2e-pr-${RUN_ID}`;
const DEVICE_NAME = `${MARKER} ตู้หน้าประตู`;
const GROUP_NAME = `${MARKER} กลุ่ม`;
const BANNER_TITLE = `${MARKER} ประกาศ`;

/** A 1x1 PNG: the server only checks the magic bytes, the form only the type and size. */
const PNG_1X1 = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64'
);

/** `YYYY-MM-DD` shifted by whole days (Asia/Bangkok calendar, like the banner form). */
function shiftDays(date: string, delta: number): string {
	const day = new Date(`${date}T12:00:00+07:00`);
	day.setUTCDate(day.getUTCDate() + delta);
	return bangkokToday(day);
}

/** `YYYY-MM-DD` -> the `DD/MM/YYYY` the date picker accepts. */
const dmy = (iso: string) => iso.split('-').reverse().join('/');

let shelterCode: string | undefined;
let prStaff: TestUser | undefined;
let prSession = '';
let deviceSecret = '';
let adminCookie = '';
let liveWritesStarted = false;

/** One staff call to the app's own BFF with a session cookie (no browser involved). */
async function bff(
	cookie: string,
	method: string,
	path: string,
	body?: unknown
): Promise<{ status: number; data: unknown }> {
	const res = await fetch(`${appBaseUrl()}${path}`, {
		method,
		headers: { Cookie: `AuthSession=${cookie}`, 'Content-Type': 'application/json' },
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
	return { status: res.status, data: await res.json().catch(() => null) };
}

/** Pick `hour` o'clock (minutes stay 00) in the time picker of the field `เริ่ม` / `สิ้นสุด`. */
async function pickHour(page: Page, field: 'เริ่ม' | 'สิ้นสุด', hour: string): Promise<void> {
	await page.getByRole('button', { name: `เวลา${field}`, exact: true }).click();
	await page.getByRole('button', { name: /ชั่วโมง/ }).click();
	await page.getByRole('option', { name: hour, exact: true }).click();
	await page.keyboard.press('Escape');
}

test.afterAll(async () => {
	test.setTimeout(180_000);
	if (!CAN_WRITE || !liveWritesStarted) return;
	if (shelterCode) {
		// Device first: its DELETE also drops the staff PIN from `scanner_secrets`.
		await bff(adminCookie, 'DELETE', `/api/v1/kiosk/devices/${DEVICE_ID}`).catch(() => undefined);
		// Banners and groups live in `registry`, which dropping the shelter does not touch.
		const found = await couchReq('POST', '/registry/_find', {
			selector: {
				type: { $in: ['kiosk_banner', 'kiosk_banner_group'] },
				shelter_code: shelterCode
			},
			limit: 100
		});
		const docs = (found.data as { docs?: { _id: string; _rev: string }[] })?.docs ?? [];
		if (docs.length > 0) {
			await couchReq('POST', '/registry/_bulk_docs', {
				docs: docs.map((d) => ({ _id: d._id, _rev: d._rev, _deleted: true }))
			});
		}
		await teardownShelter(shelterCode).catch(() => undefined);
	}
	if (prStaff) await deleteCouchUser(prStaff.name).catch(() => undefined);
});

test.describe(
	'pr_staff runs the kiosk banners of their shelter and nothing else (#930)',
	{ tag: ['@kiosk', '@critical', '@back-office'] },
	() => {
		// eslint-disable-next-line no-empty-pattern -- Playwright needs a destructured first argument
		test.beforeEach(({}, testInfo) => {
			test.skip(!CAN_WRITE, READ_ONLY_REASON);
			test.skip(
				!shelterCode && !testInfo.title.startsWith('arrange'),
				'no E2E shelter this run (arrange failed)'
			);
		});

		test('arrange: an E2E shelter with one kiosk device and one pr_staff account', async ({
			page
		}) => {
			test.setTimeout(180_000);
			liveWritesStarted = true;
			const admin = await bootstrapAdminSession();
			adminCookie = admin.cookie;
			await routeBrowserCouchThroughApp(page);
			await injectSession(page, admin.user, admin.cookie);
			shelterCode = await createShelterViaUi(page, {
				name: `${MARKER} ศูนย์ทดสอบประชาสัมพันธ์`,
				siteKind: 'evacuation_center',
				lat: 7.006,
				lng: 100.498,
				subdistrict: 'คอหงส์',
				capacity: 60
			});
			recordCreatedShelter(shelterCode);

			const created = await bff(adminCookie, 'POST', '/api/v1/kiosk/devices', {
				device_id: DEVICE_ID,
				name: DEVICE_NAME,
				shelter_code: shelterCode
			});
			expect(created.status, 'device create').toBe(201);
			deviceSecret = (created.data as { plaintext_secret: string }).plaintext_secret;

			prStaff = {
				name: `pr_staff_${RUN_ID}`,
				password: PASSWORD,
				roles: [`shelter:${shelterCode}`, `${shelterCode}:pr_staff`],
				display_name: `${MARKER} เจ้าหน้าที่ประชาสัมพันธ์`
			};
			await createCouchUser(prStaff);
			await seedSecurityQuestion(prStaff.name);
			prSession = await couchLogin(prStaff.name, prStaff.password);
		});

		test('pr_staff sees only the PR department and its one tile, which opens the banners', async ({
			page
		}) => {
			await routeBrowserCouchThroughApp(page);
			await injectSession(page, prStaff!, prSession);
			await page.goto('/portal');

			await expect(page.getByRole('heading', { name: 'ฝ่ายประชาสัมพันธ์' })).toBeVisible({
				timeout: 30_000
			});
			const tile = page.getByRole('link', { name: /ข่าวสารบน Kiosk/ });
			await expect(tile).toHaveCount(1);
			// The only link into back-office: no other department, no other tile.
			await expect(page.locator('main a[href^="/back-office"]')).toHaveCount(1);
			await expect(page.locator('main a[href^="/system-management"]')).toHaveCount(0);

			await tile.click();
			await expect(page).toHaveURL(/\/back-office\/kiosks\/banners$/);
		});

		test('pr_staff creates a group and a banner, binds the group to the device and can view its PIN', async ({
			page
		}) => {
			test.setTimeout(180_000);
			await routeBrowserCouchThroughApp(page);
			await injectSession(page, prStaff!, prSession);
			await page.goto('/back-office/kiosks/banners');

			// Group
			await page.getByRole('link', { name: 'สร้างกลุ่ม' }).first().click();
			await page.getByLabel(/ชื่อกลุ่ม/).fill(GROUP_NAME);
			await page.getByRole('button', { name: 'ถัดไป: เลือกเครื่อง' }).click();
			await page.getByRole('button', { name: 'สร้างกลุ่ม' }).click();
			await expect(page).toHaveURL(/\/banners\/groups\/kiosk_banner_group/);
			await expect(page.getByRole('heading', { name: GROUP_NAME })).toBeVisible();
			await expect(page.getByText('ยังไม่มีเครื่องในกลุ่ม')).toBeVisible();
			const groupUrl = page.url();

			// Banner (image via the real file input; the dates are typed, the hour is picked)
			await page.getByRole('link', { name: 'สร้างแบนเนอร์' }).click();
			await page.getByLabel(/^ชื่อ/).fill(BANNER_TITLE);
			const today = bangkokToday();
			await page.getByRole('textbox', { name: 'วันที่เริ่ม' }).fill(dmy(shiftDays(today, -1)));
			await pickHour(page, 'เริ่ม', '00');
			await page.getByRole('textbox', { name: 'วันที่สิ้นสุด' }).fill(dmy(shiftDays(today, 2)));
			await pickHour(page, 'สิ้นสุด', '12');
			await page
				.locator('#banner-image')
				.setInputFiles({ name: 'e2e-banner.png', mimeType: 'image/png', buffer: PNG_1X1 });
			await expect(page.getByTestId('banner-new-image')).toBeVisible();
			await page.getByRole('button', { name: 'บันทึก', exact: true }).click();
			await expect(page.getByText('สร้างแบนเนอร์แล้ว')).toBeVisible();
			await expect(page.getByText(BANNER_TITLE).first()).toBeVisible();

			// Bind the group to the device from the group page
			await page.goto(groupUrl);
			await page.getByRole('button', { name: 'จัดการเครื่อง' }).click();
			await page.getByRole('checkbox', { name: new RegExp(DEVICE_NAME) }).check();
			await page.getByRole('button', { name: 'บันทึก', exact: true }).click();
			await expect(page.getByText('บันทึกเครื่องของกลุ่มแล้ว')).toBeVisible();

			// The member chip offers "ดู PIN"; the dialog only reveals, it never sets or regenerates.
			await page.getByRole('button', { name: `ดู PIN เจ้าหน้าที่ของ ${DEVICE_NAME}` }).click();
			const dialog = page.getByRole('dialog', { name: /PIN เจ้าหน้าที่ของเครื่อง/ });
			await expect(dialog).toBeVisible();
			await expect(dialog.getByText(DEVICE_NAME)).toBeVisible();
			await dialog.getByRole('button', { name: /แสดง/ }).click();
			await expect(dialog.locator('output')).toHaveText(/^\d{6}$/);
			await expect(
				dialog.getByRole('button', { name: /ตั้ง PIN|เปลี่ยน PIN|สร้าง PIN ใหม่/ })
			).toHaveCount(0);
			await expect(dialog.getByRole('button', { name: /คัดลอก/ })).toBeVisible();
		});

		test('every other back-office page bounces pr_staff back to the portal', async ({ page }) => {
			await routeBrowserCouchThroughApp(page);
			await injectSession(page, prStaff!, prSession);
			for (const path of ['/back-office/kiosks', '/back-office/users']) {
				await page.goto(path);
				await expect(page, path).toHaveURL(/\/portal$/, { timeout: 30_000 });
			}
			await clearSession(page);
		});

		test('the bound kiosk now receives the new banner on its own feed', async () => {
			const res = await fetch(`${appBaseUrl()}/api/v1/kiosk/banners`, {
				method: 'POST',
				headers: { 'x-device-id': DEVICE_ID, 'x-device-secret': deviceSecret }
			});
			expect(res.status).toBe(200);
			const { banners } = (await res.json()) as { banners: { title: string }[] };
			expect(banners.map((b) => b.title)).toEqual([BANNER_TITLE]);
		});

		test('device writes stay closed to pr_staff', async () => {
			const res = await bff(prSession, 'PATCH', `/api/v1/kiosk/devices/${DEVICE_ID}`, {
				name: `${DEVICE_NAME} แก้`
			});
			expect(res.status).toBe(403);
		});
	}
);
