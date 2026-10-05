import { expect, test, type Page, type Route } from '@playwright/test';
import {
	KIOSK_CITIZEN_ID,
	KIOSK_QUERY,
	dispatchKioskEvent,
	mockKioskApi,
	type KioskMockOptions
} from './helpers/kiosk';

/**
 * Face check layout on the two kiosk monitors (docs/plans/kiosk-face-verification-ui-flow-plan.md
 * §7, G4): every step must fit the screen with no scrolling and no button below the fold.
 * The scanner client's `/face/*` answers are mocked; the camera is Chromium's synthetic video.
 */
const LANDSCAPE = { width: 1024, height: 600 };
const PORTRAIT = { width: 1080, height: 1920 };

test.use({
	viewport: LANDSCAPE,
	deviceScaleFactor: 1,
	hasTouch: true,
	locale: 'th-TH',
	timezoneId: 'Asia/Bangkok',
	permissions: ['camera'],
	launchOptions: {
		args: [
			'--no-sandbox',
			'--disable-setuid-sandbox',
			'--use-fake-device-for-media-stream',
			'--use-fake-ui-for-media-stream'
		]
	}
});

const NO_PRE_REGISTRATION = {
	kind: 'error',
	status: 404,
	code: 'PRE_REGISTRATION_NOT_FOUND',
	message: 'ไม่พบข้อมูลการลงทะเบียนล่วงหน้า',
	canRegister: true
} as const;

const NOT_CONFIRMED = [{ result: 'not_confirmed', reason: 'retry_exhausted', attempt: 3 }] as const;

function json(route: Route, body: unknown) {
	return route.fulfill({
		status: 200,
		contentType: 'application/json',
		body: JSON.stringify(body)
	});
}

/**
 * Keep the person at the camera: previews are never well framed (so no verdict is asked for),
 * saying `hint`. With `retryOnce` the first two previews are fine, the verdict asks for another try,
 * and the person is back at the camera on "attempt 2 of 3".
 */
async function holdAtCamera(
	page: Page,
	{ hint = 'too_far', retryOnce = false }: { hint?: string; retryOnce?: boolean } = {}
) {
	let previews = 0;
	await page.route('**/api/v1/scanner/kiosk/face/frame', (route) => {
		previews += 1;
		const ready = retryOnce && previews <= 2;
		return json(route, { face: true, hint: ready ? 'ok' : hint, ready, reference: 'reading' });
	});
	if (retryOnce) {
		await page.route('**/api/v1/scanner/kiosk/face/verify', (route) =>
			json(route, { result: 'retry', hint: 'ok', attempt: 1 })
		);
	}
}

async function mockCheckIn(page: Page, options: KioskMockOptions = {}) {
	await mockKioskApi(page, { lookup: { kind: 'household', members: 4 }, ...options });
}

async function insertCard(page: Page) {
	await page.goto(`/kiosk/scanner/remove-card${KIOSK_QUERY}`);
	await page.locator('[data-kiosk-card-ready="true"]').waitFor({ state: 'attached' });
	await dispatchKioskEvent(page, 'kiosk:smart-card-read', { citizenId: KIOSK_CITIZEN_ID });
}

async function mockWalkIn(page: Page, options: KioskMockOptions = {}) {
	await mockKioskApi(page, { lookup: NO_PRE_REGISTRATION, face: { mode: 'on' }, ...options });
}

async function walkInToFaceStep(page: Page) {
	await page.goto(`/kiosk/scanner/remove-card${KIOSK_QUERY}`);
	await page.locator('[data-kiosk-card-ready="true"]').waitFor({ state: 'attached' });
	await dispatchKioskEvent(page, 'kiosk:smart-card-read', { citizenId: KIOSK_CITIZEN_ID });
	await page.getByRole('button', { name: 'ลงทะเบียนใหม่' }).click();
	await page.getByRole('button', { name: 'ยินยอมและดำเนินการ' }).click();
	await page.locator('[data-kiosk-register-ready="true"]').waitFor({ state: 'attached' });
	await dispatchKioskEvent(page, 'kiosk:smart-card-reading');
	await dispatchKioskEvent(page, 'kiosk:smart-card-full-read', { citizen_id: KIOSK_CITIZEN_ID });
}

const agree = (page: Page) => page.getByRole('button', { name: 'ยินยอม เริ่มตรวจใบหน้า' });
const skip = (page: Page) => page.getByRole('button', { name: 'ข้าม ให้เจ้าหน้าที่ตรวจแทน' });

/** No scroll in either direction, and no visible button or link whose bottom edge is off screen. */
async function expectFits(page: Page) {
	const metrics = await page.evaluate(() => {
		const bottoms = [...document.querySelectorAll('button, a[href]')]
			.map((node) => node.getBoundingClientRect())
			.filter((box) => box.width > 0 && box.height > 0)
			.map((box) => box.bottom);
		return {
			scrollHeight: document.documentElement.scrollHeight,
			scrollWidth: document.documentElement.scrollWidth,
			innerHeight: window.innerHeight,
			innerWidth: window.innerWidth,
			lowestControl: Math.max(0, ...bottoms)
		};
	});
	expect(metrics.scrollHeight, 'no vertical scroll').toBeLessThanOrEqual(metrics.innerHeight);
	expect(metrics.scrollWidth, 'no horizontal scroll').toBeLessThanOrEqual(metrics.innerWidth);
	expect(metrics.lowestControl, 'no button below the screen').toBeLessThanOrEqual(
		metrics.innerHeight
	);
}

for (const [name, viewport] of [
	['1024×600', LANDSCAPE],
	['1080×1920', PORTRAIT]
] as const) {
	test.describe(`face check layout ${name} — pre-registered check-in`, () => {
		test.use({ viewport });

		test('S1 consent, with the keep-the-card-in notice', async ({ page }) => {
			await mockCheckIn(page, { face: { mode: 'on' } });
			await insertCard(page);

			await expect(agree(page)).toBeInViewport({ ratio: 1 });
			await expect(page.getByText('กรุณาเสียบบัตรค้างไว้จนกว่าระบบจะบอกให้ถอด')).toBeVisible();
			await expectFits(page);
		});

		test('S3 positioning with the notice, a framing problem and the skip button', async ({
			page
		}) => {
			await mockCheckIn(page, { face: { mode: 'on' } });
			await holdAtCamera(page, { hint: 'too_far' });
			await insertCard(page);
			await agree(page).click();

			await expect(page.getByTestId('kiosk-face-message')).toContainText('ขยับเข้าใกล้');
			await expect(page.getByTestId('kiosk-face-guide')).toHaveAttribute(
				'data-face-guide',
				'problem'
			);
			await expect(page.getByText('กรุณาเสียบบัตรค้างไว้จนกว่าระบบจะบอกให้ถอด')).toBeVisible();
			await expect(skip(page)).toBeInViewport({ ratio: 1 });
			await expectFits(page);
		});

		test('S5 second attempt shows "attempt 2 of 3" and still fits', async ({ page }) => {
			await mockCheckIn(page, { face: { mode: 'on' } });
			await holdAtCamera(page, { retryOnce: true });
			await insertCard(page);
			await agree(page).click();

			await expect(page.getByText('ครั้งที่ 2 จาก 3')).toBeVisible();
			await expect(skip(page)).toBeInViewport({ ratio: 1 });
			await expectFits(page);
		});

		test('S3 after a long wait adds the "staff will help" line and still fits', async ({
			page
		}) => {
			await page.clock.install();
			await mockCheckIn(page, { face: { mode: 'on' } });
			await holdAtCamera(page, { hint: 'no_face' });
			await insertCard(page);
			await agree(page).click();
			await expect(page.getByTestId('kiosk-face-check')).toHaveAttribute(
				'data-face-phase',
				'positioning'
			);
			await expect(page.getByTestId('kiosk-face-message')).toContainText('ยังไม่พบใบหน้า');

			await page.clock.fastForward(31_000);

			await expect(page.getByTestId('kiosk-face-slow')).toBeVisible();
			await expect(skip(page)).toBeInViewport({ ratio: 1 });
			await expectFits(page);
		});

		test('S7 result with the continue button', async ({ page }) => {
			await mockCheckIn(page, { face: { mode: 'on', verdicts: [...NOT_CONFIRMED] } });
			await insertCard(page);
			await agree(page).click();

			await expect(page.getByRole('heading', { name: 'ระบบยืนยันไม่ได้ในขณะนี้' })).toBeVisible();
			await expect(page.getByRole('button', { name: 'ดำเนินการต่อ' })).toBeInViewport({
				ratio: 1
			});
			await expectFits(page);
		});
	});

	test.describe(`face check layout ${name} — walk-in registration`, () => {
		test.use({ viewport });

		test('S1 consent', async ({ page }) => {
			await mockWalkIn(page);
			await walkInToFaceStep(page);

			await expect(agree(page)).toBeInViewport({ ratio: 1 });
			await expect(page.getByText('กรุณาเสียบบัตรค้างไว้')).toHaveCount(0);
			await expectFits(page);
		});

		test('S3 positioning with the skip button', async ({ page }) => {
			await mockWalkIn(page);
			await holdAtCamera(page, { hint: 'too_dark' });
			await walkInToFaceStep(page);
			await agree(page).click();

			await expect(page.getByTestId('kiosk-face-message')).toContainText('แสงน้อย');
			await expect(skip(page)).toBeInViewport({ ratio: 1 });
			await expectFits(page);
		});

		test('S7 result with the continue button', async ({ page }) => {
			await mockWalkIn(page, { face: { mode: 'on', verdicts: [...NOT_CONFIRMED] } });
			await walkInToFaceStep(page);
			await agree(page).click();

			await expect(page.getByRole('heading', { name: 'ระบบยืนยันไม่ได้ในขณะนี้' })).toBeVisible();
			await expect(page.getByRole('button', { name: 'ดำเนินการต่อ' })).toBeInViewport({
				ratio: 1
			});
			await expectFits(page);
		});
	});
}
