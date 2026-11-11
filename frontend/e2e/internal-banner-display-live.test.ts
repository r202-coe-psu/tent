/**
 * TV screen against the real feed (issue #1299 §C, CR-162 FR-KBT): unlike
 * `internal-banner-display.test.ts`, nothing is mocked — the code goes through the BFF feed, the
 * registry `(type, tv_code)` index and the signed image route.
 *
 * Arrange: the CouchDB server admin provisions one `E2E` shelter through the staff UI, then a
 * group and one `tv` banner (image included) through the back-office BFF. Then:
 *   - typing the group's code on the keypad plays the banner, its image served for real
 *   - the same code under another shelter is refused like an unknown code
 *   - rotating the code: the old one is refused, the new one plays
 *
 * Data safety: the banner and group are deleted in afterAll, then the shelter by
 * `teardownShelter`. Every name carries the `E2E` marker and the run id.
 *
 * Local: `docker compose up -d`, `pnpm seed:master`, then
 *   pnpm exec vite build --mode test
 *   PLAYWRIGHT_TEST_BASE_URL=http://localhost:4173 pnpm exec playwright test e2e/internal-banner-display-live.test.ts
 */
import { test, expect, type Page } from '@playwright/test';
import { bootstrapAdminSession, couchReq } from './helpers/couch';
import { appBaseUrl, CAN_WRITE, LOCAL_RUN_ID as RUN_ID, READ_ONLY_REASON } from './helpers/e2e-env';
import { injectSession, routeBrowserCouchThroughApp } from './helpers/login';
import { recordCreatedShelter, teardownShelter } from './helpers/public-cleanup';
import { createShelterViaUi } from './helpers/staff-ui';

const LEDGER_SUITE = 'internal-banner-display-live';

test.describe.configure({ mode: 'serial' });

const MARKER = `E2E TV ${RUN_ID}`;
const BANNER_TITLE = `${MARKER} ประกาศ`;
const INVALID_CODE_MESSAGE = 'รหัสไม่ถูกต้องหรือถูกเปลี่ยนแล้ว';

/** A 1x1 PNG: the server only checks the magic bytes. */
const PNG_1X1 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let shelterCode: string | undefined;
let adminCookie = '';
let groupId = '';
let tvCode = '';
let liveWritesStarted = false;

/** One staff call to the app's own BFF with a session cookie (no browser involved). */
async function bff(
	method: string,
	path: string,
	body?: unknown
): Promise<{ status: number; data: unknown }> {
	const res = await fetch(`${appBaseUrl()}${path}`, {
		method,
		headers: { Cookie: `AuthSession=${adminCookie}`, 'Content-Type': 'application/json' },
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
	return { status: res.status, data: await res.json().catch(() => null) };
}

async function typeCode(page: Page, code: string): Promise<void> {
	await expect(page.getByRole('button', { name: 'ตัวเลข 1' })).toBeFocused();
	for (const digit of code) await page.keyboard.press(digit);
}

/** The slide's <img> actually loaded its bytes from the signed image route. */
async function expectBannerPlays(page: Page): Promise<void> {
	const img = page.getByRole('img', { name: BANNER_TITLE });
	await expect(img).toBeVisible({ timeout: 30_000 });
	await expect
		.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
		.toBe(true);
}

test.afterAll(async () => {
	test.setTimeout(180_000);
	if (!CAN_WRITE || !liveWritesStarted || !shelterCode) return;
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
});

test.describe('TV screen on the real feed (#1299)', { tag: ['@kiosk', '@critical'] }, () => {
	// eslint-disable-next-line no-empty-pattern -- Playwright needs a destructured first argument
	test.beforeEach(({}, testInfo) => {
		test.skip(!CAN_WRITE, READ_ONLY_REASON);
		test.skip(
			!tvCode && !testInfo.title.startsWith('arrange'),
			'no E2E group this run (arrange failed)'
		);
	});

	test('arrange: an E2E shelter with one group and one tv banner', async ({ page }) => {
		test.setTimeout(180_000);
		liveWritesStarted = true;
		const admin = await bootstrapAdminSession();
		adminCookie = admin.cookie;
		await routeBrowserCouchThroughApp(page);
		await injectSession(page, admin.user, admin.cookie);
		shelterCode = await createShelterViaUi(page, {
			name: `${MARKER} ศูนย์ทดสอบจอ TV`,
			siteKind: 'evacuation_center',
			lat: 7.006,
			lng: 100.498,
			subdistrict: 'คอหงส์',
			capacity: 60
		});
		recordCreatedShelter(shelterCode, LEDGER_SUITE);

		const group = await bff(
			'POST',
			`/api/back-office/kiosk-banner-groups?shelter_code=${shelterCode}`,
			{
				name: `${MARKER} กลุ่ม`,
				description: null
			}
		);
		expect(group.status, 'group create').toBe(201);
		const created = group.data as { _id: string; tv_code: string };
		expect(created.tv_code).toMatch(/^\d{6}$/);
		groupId = created._id;

		const now = Date.now();
		const banner = await bff('POST', `/api/back-office/kiosk-banners?shelter_code=${shelterCode}`, {
			title: BANNER_TITLE,
			start_at: new Date(now - 60 * 60_000).toISOString(),
			end_at: new Date(now + 2 * 24 * 60 * 60_000).toISOString(),
			duration_sec: 30,
			screen_type: 'tv',
			group_id: groupId,
			image: { content_type: 'image/png', data_base64: PNG_1X1 }
		});
		expect(banner.status, 'banner create').toBe(201);
		tvCode = created.tv_code;
	});

	test("typing the group's code plays its tv banner from the real feed", async ({ page }) => {
		await page.goto(`/banner/${shelterCode}/internal`);
		await typeCode(page, tvCode);

		await expect(page).toHaveURL(new RegExp(`/banner/${shelterCode}/internal\\?c=${tvCode}$`));
		await expectBannerPlays(page);
	});

	test('the same code under another shelter is refused like an unknown code', async ({ page }) => {
		const feed = await fetch(`${appBaseUrl()}/api/v1/kiosk/internal/SH001/banners?c=${tvCode}`);
		expect(feed.status).toBe(404);

		await page.goto(`/banner/SH001/internal?c=${tvCode}`);

		await expect(page.getByText(INVALID_CODE_MESSAGE)).toBeVisible({ timeout: 30_000 });
		await expect(page.getByRole('img', { name: BANNER_TITLE })).toHaveCount(0);
	});

	test('after rotating, the old code is refused and the new one plays', async ({ page }) => {
		const id = groupId.slice('kiosk_banner_group:'.length);
		const rotated = await bff('POST', `/api/back-office/kiosk-banner-groups/${id}/tv-code`);
		expect(rotated.status, 'rotate').toBe(200);
		const newCode = (rotated.data as { tv_code: string }).tv_code;
		expect(newCode).toMatch(/^\d{6}$/);
		expect(newCode).not.toBe(tvCode);

		await page.goto(`/banner/${shelterCode}/internal?c=${tvCode}`);
		await expect(page.getByText(INVALID_CODE_MESSAGE)).toBeVisible({ timeout: 30_000 });

		await typeCode(page, newCode);
		await expectBannerPlays(page);
		tvCode = newCode;
	});
});
