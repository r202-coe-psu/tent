import { expect, test, type Page, type Route } from '@playwright/test';
import {
	KIOSK_CITIZEN_ID,
	KIOSK_QUERY,
	dispatchKioskEvent,
	mockKioskApi,
	type KioskMockOptions
} from './helpers/kiosk';

/**
 * Face check on the kiosk (docs/plans/kiosk-face-verification-implementation-plan.md §7). The scanner
 * client's `/face/*` answers are mocked; the camera is Chromium's synthetic test video, so the real
 * getUserMedia -> canvas -> JPEG path runs.
 */
test.use({
	viewport: { width: 1024, height: 600 },
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

async function insertCard(page: Page, options: KioskMockOptions) {
	const mock = await mockKioskApi(page, options);
	await page.goto(`/kiosk/scanner/remove-card${KIOSK_QUERY}`);
	await page.locator('[data-kiosk-card-ready="true"]').waitFor({ state: 'attached' });
	await dispatchKioskEvent(page, 'kiosk:smart-card-read', { citizenId: KIOSK_CITIZEN_ID });
	return mock;
}

/** New walk-in up to the point where the chip has been read. */
async function walkInUntilCardRead(page: Page, options: KioskMockOptions) {
	const mock = await insertCard(page, { lookup: NO_PRE_REGISTRATION, ...options });
	await page.getByRole('button', { name: 'ลงทะเบียนใหม่' }).click();
	await page.getByRole('button', { name: 'ยินยอมและดำเนินการ' }).click();
	await page.locator('[data-kiosk-register-ready="true"]').waitFor({ state: 'attached' });
	await dispatchKioskEvent(page, 'kiosk:smart-card-reading');
	await dispatchKioskEvent(page, 'kiosk:smart-card-full-read', { citizen_id: KIOSK_CITIZEN_ID });
	return mock;
}

const agree = (page: Page) => page.getByRole('button', { name: 'ยินยอม เริ่มตรวจใบหน้า' });
const skip = (page: Page) => page.getByRole('button', { name: 'ข้าม ให้เจ้าหน้าที่ตรวจแทน' });
const guide = (page: Page) => page.getByTestId('kiosk-face-guide');

function json(route: Route, body: unknown) {
	return route.fulfill({
		status: 200,
		contentType: 'application/json',
		body: JSON.stringify(body)
	});
}

/** The person stays at the camera: the preview never says "well framed", so no verdict is asked. */
async function holdAtCamera(page: Page, reply: Record<string, unknown> = {}) {
	await page.route('**/api/v1/scanner/kiosk/face/frame', (route) =>
		json(route, { face: true, hint: 'too_far', ready: false, ...reply })
	);
}

test.describe('face check — walk-in registration', () => {
	test('consent, check, then the registration goes ahead', async ({ page }) => {
		const mock = await walkInUntilCardRead(page, { face: { mode: 'on' } });

		await expect(page.getByRole('heading', { name: 'ตรวจใบหน้าเทียบกับรูปในบัตร' })).toBeVisible();
		expect(mock.calls).not.toContain('register'); // held back until the check ends
		expect(mock.calls).not.toContain('face/start'); // and nothing runs before consent

		await agree(page).click();
		await expect(page.getByRole('heading', { name: 'ยืนยันตัวตนเรียบร้อย' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'ลงทะเบียนสำเร็จ' })).toBeVisible();

		// (leaving the lookup page sends one harmless cancel first)
		const steps = mock.calls.filter((call) => call !== 'face/cancel');
		expect(steps.slice(0, 3)).toEqual(['face/start', 'face/frame', 'face/frame']);
		expect(steps).toContain('face/verify');
		expect(steps.at(-1)).toBe('register');
	});

	test('the check is wiped on the scanner client once the person is registered', async ({
		page
	}) => {
		const mock = await walkInUntilCardRead(page, { face: { mode: 'on' } });

		await agree(page).click();
		await expect(page.getByRole('heading', { name: 'ลงทะเบียนสำเร็จ' })).toBeVisible();

		await expect.poll(() => mock.calls.at(-1)).toBe('face/cancel');
		expect(mock.calls.lastIndexOf('register')).toBeLessThan(mock.calls.lastIndexOf('face/cancel'));
	});

	test('cancelling after a failed registration wipes the check and goes home', async ({ page }) => {
		const mock = await walkInUntilCardRead(page, { face: { mode: 'on' } });
		await page.route('**/api/v1/scanner/kiosk/register', (route) =>
			route.fulfill({
				status: 500,
				contentType: 'application/json',
				body: JSON.stringify({
					error: { code: 'KIOSK_REGISTER_FAILED', message: 'บันทึกไม่สำเร็จ' }
				})
			})
		);
		await agree(page).click();
		await expect(page.getByRole('alert')).toBeVisible();
		// Still on the page so the person can try again: nothing is wiped yet.
		const wipedBefore = mock.calls.filter((call) => call === 'face/cancel').length;

		await page.getByRole('button', { name: 'ยกเลิก' }).click();

		await expect(page.getByRole('heading', { name: 'รายงานตัว', exact: true })).toBeVisible();
		await expect
			.poll(() => mock.calls.filter((call) => call === 'face/cancel').length)
			.toBeGreaterThan(wipedBefore);
	});

	test('declining skips the camera and still registers', async ({ page }) => {
		const mock = await walkInUntilCardRead(page, { face: { mode: 'on' } });

		await page.getByRole('button', { name: 'ไม่ยินยอม ให้เจ้าหน้าที่ตรวจแทน' }).click();

		await expect(page.getByRole('heading', { name: 'ลงทะเบียนสำเร็จ' })).toBeVisible();
		expect(mock.calls).not.toContain('face/start');
		expect(mock.calls).not.toContain('face/frame');
		expect(mock.calls).toContain('face/cancel'); // wipes the photo the scanner client set aside
	});

	test('a face that is not confirmed is passed to staff, not refused', async ({ page }) => {
		const mock = await walkInUntilCardRead(page, {
			face: {
				mode: 'on',
				verdicts: [{ result: 'not_confirmed', reason: 'retry_exhausted', attempt: 3 }]
			}
		});

		await agree(page).click();

		await expect(page.getByRole('heading', { name: 'ระบบยืนยันไม่ได้ในขณะนี้' })).toBeVisible();
		await expect(page.getByText('เจ้าหน้าที่จะช่วยตรวจสอบตัวตนให้ท่าน')).toBeVisible();
		expect(mock.calls).not.toContain('register'); // waits for the person to continue
		await page.getByRole('button', { name: 'ดำเนินการต่อ' }).click();
		await expect(page.getByRole('heading', { name: 'ลงทะเบียนสำเร็จ' })).toBeVisible();
	});

	test('a retry verdict asks again and then finishes', async ({ page }) => {
		const mock = await walkInUntilCardRead(page, {
			face: {
				mode: 'on',
				verdicts: [
					{ result: 'retry', hint: 'ok', attempt: 1 },
					{ result: 'match', attempt: 2 }
				]
			}
		});

		await agree(page).click();

		await expect(page.getByTestId('kiosk-face-message')).toContainText('ลองอีกครั้ง');
		await expect(page.getByRole('heading', { name: 'ลงทะเบียนสำเร็จ' })).toBeVisible();
		expect(mock.calls.filter((call) => call === 'face/verify')).toHaveLength(2);
	});

	test('shadow mode asks for consent but never shows a result', async ({ page }) => {
		const mock = await walkInUntilCardRead(page, {
			face: {
				mode: 'shadow',
				verdicts: [{ result: 'not_confirmed', reason: 'retry_exhausted', attempt: 3 }]
			}
		});

		await agree(page).click();

		await expect(page.getByRole('heading', { name: 'ลงทะเบียนสำเร็จ' })).toBeVisible();
		await expect(page.getByText('ระบบยืนยันไม่ได้ในขณะนี้')).toHaveCount(0);
		expect(mock.calls).toContain('face/verify');
	});

	test('a face check switched off for walk-in registers straight away', async ({ page }) => {
		const mock = await walkInUntilCardRead(page, { face: { mode: 'on', flows: ['check_in'] } });

		await expect(page.getByRole('heading', { name: 'ลงทะเบียนสำเร็จ' })).toBeVisible();
		// Nothing of the check ran (the lookup page only sends a harmless cancel as it is left).
		expect(mock.calls.filter((call) => /face\/(start|frame|verify)/.test(call))).toEqual([]);
	});

	test('skipping at the camera registers without a result screen', async ({ page }) => {
		const mock = await walkInUntilCardRead(page, { face: { mode: 'on' } });
		await holdAtCamera(page);

		await agree(page).click();
		await expect(guide(page)).toBeVisible();
		await skip(page).click();

		await expect(page.getByRole('heading', { name: 'ลงทะเบียนสำเร็จ' })).toBeVisible();
		await expect(page.getByText('ระบบยืนยันไม่ได้ในขณะนี้')).toHaveCount(0);
		expect(mock.calls).not.toContain('face/verify');
		expect(mock.calls).toContain('face/cancel');
		expect(mock.calls).toContain('register');
	});

	test('there is no skip button before the person agrees', async ({ page }) => {
		await walkInUntilCardRead(page, { face: { mode: 'on' } });

		await expect(agree(page)).toBeVisible();
		await expect(skip(page)).toHaveCount(0);
	});

	test('the card notice is for check-in only', async ({ page }) => {
		await walkInUntilCardRead(page, { face: { mode: 'on' } });
		await holdAtCamera(page);

		await expect(agree(page)).toBeVisible();
		await expect(page.getByTestId('kiosk-face-card-notice')).toHaveCount(0);
		await agree(page).click();
		await expect(guide(page)).toBeVisible();
		await expect(page.getByTestId('kiosk-face-card-notice')).toHaveCount(0);
	});

	test('the guide outline is amber with an alert icon while a fix is asked for', async ({
		page
	}) => {
		await walkInUntilCardRead(page, { face: { mode: 'on' } });
		await holdAtCamera(page);

		await agree(page).click();

		await expect(guide(page)).toHaveAttribute('data-face-guide', 'problem');
		await expect(page.getByTestId('kiosk-face-guide-icon')).toBeVisible();
		await expect(page.getByTestId('kiosk-face-message')).toContainText('ขยับเข้าใกล้');
	});

	test('the guide outline turns emerald with a check when the face is well placed', async ({
		page
	}) => {
		await walkInUntilCardRead(page, { face: { mode: 'on' } });
		await page.route('**/api/v1/scanner/kiosk/face/verify', () => {
			// never answered: the person stays on the camera step with a well-framed face
		});

		await agree(page).click();

		await expect(guide(page)).toHaveAttribute('data-face-guide', 'ready');
		await expect(page.getByTestId('kiosk-face-guide-icon')).toBeVisible();
	});

	test('says the system is getting ready while the hardware answer is awaited', async ({
		page
	}) => {
		const mock = await mockKioskApi(page, { lookup: NO_PRE_REGISTRATION, face: { mode: 'on' } });
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => (release = resolve));
		await page.route('**/api/v1/scanner/kiosk/hardware', async (route) => {
			// Only the face step waits: the pages before it need the answer to get there.
			if (page.url().includes('/kiosk/register/face')) await gate;
			await json(route, {
				qr_input: 'camera',
				camera_label: null,
				reader_max_gap_ms: 50,
				face_check: { mode: 'on', flows: ['check_in', 'walk_in'] }
			});
		});
		await page.goto(`/kiosk/scanner/remove-card${KIOSK_QUERY}`);
		await page.locator('[data-kiosk-card-ready="true"]').waitFor({ state: 'attached' });
		await dispatchKioskEvent(page, 'kiosk:smart-card-read', { citizenId: KIOSK_CITIZEN_ID });
		await page.getByRole('button', { name: 'ลงทะเบียนใหม่' }).click();
		await page.getByRole('button', { name: 'ยินยอมและดำเนินการ' }).click();
		await page.locator('[data-kiosk-register-ready="true"]').waitFor({ state: 'attached' });
		await dispatchKioskEvent(page, 'kiosk:smart-card-reading');
		await dispatchKioskEvent(page, 'kiosk:smart-card-full-read', { citizen_id: KIOSK_CITIZEN_ID });

		await expect(page.getByRole('status').filter({ hasText: 'กำลังเตรียมระบบ…' })).toBeVisible();
		await expect(agree(page)).toHaveCount(0);

		release();
		await expect(agree(page)).toBeVisible();
		await expect(page.getByText('กำลังเตรียมระบบ…')).toHaveCount(0);
		expect(mock.calls).not.toContain('register');
	});

	test('after a result that is not a match, the done page says staff will check again', async ({
		page
	}) => {
		await walkInUntilCardRead(page, {
			face: { mode: 'on', verdicts: [{ result: 'not_confirmed', reason: 'x', attempt: 3 }] }
		});

		await agree(page).click();
		await page.getByRole('button', { name: 'ดำเนินการต่อ' }).click();

		await expect(page.getByRole('heading', { name: 'ลงทะเบียนสำเร็จ' })).toBeVisible();
		await expect(page.getByText('เจ้าหน้าที่จะตรวจสอบตัวตนของท่านอีกครั้ง')).toBeVisible();
	});

	test('the done page says nothing extra after a match', async ({ page }) => {
		await walkInUntilCardRead(page, { face: { mode: 'on' } });

		await agree(page).click();

		await expect(page.getByRole('heading', { name: 'ลงทะเบียนสำเร็จ' })).toBeVisible();
		await expect(page.getByText('เจ้าหน้าที่จะตรวจสอบตัวตนของท่านอีกครั้ง')).toHaveCount(0);
	});

	test('shadow mode never adds the staff line to the done page', async ({ page }) => {
		await walkInUntilCardRead(page, {
			face: {
				mode: 'shadow',
				verdicts: [{ result: 'not_confirmed', reason: 'x', attempt: 3 }]
			}
		});

		await agree(page).click();

		await expect(page.getByRole('heading', { name: 'ลงทะเบียนสำเร็จ' })).toBeVisible();
		await expect(page.getByText('เจ้าหน้าที่จะตรวจสอบตัวตนของท่านอีกครั้ง')).toHaveCount(0);
	});

	test('fits the portrait monitor without scrolling', async ({ page }) => {
		await page.setViewportSize({ width: 1080, height: 1920 });
		await walkInUntilCardRead(page, { face: { mode: 'on' } });

		await expect(agree(page)).toBeInViewport({ ratio: 1 });
		await agree(page).click();
		await expect(page.getByRole('heading', { name: 'ลงทะเบียนสำเร็จ' })).toBeVisible();
	});
});

test.describe('face check — pre-registered check-in', () => {
	test('the member list waits for the face check, then appears', async ({ page }) => {
		const mock = await insertCard(page, {
			lookup: { kind: 'household', members: 4 },
			face: { mode: 'on' }
		});

		await expect(page.getByRole('button', { name: 'ยินยอม เริ่มตรวจใบหน้า' })).toBeVisible();
		await expect(page.getByRole('button', { name: /ยืนยัน · \d+ คน/ })).toHaveCount(0);
		expect(mock.calls).not.toContain('face/start');

		await agree(page).click();

		await expect(page.getByRole('button', { name: /ยืนยัน · \d+ คน/ })).toBeEnabled();
		expect(mock.calls.slice(0, 1)).toEqual(['face/start']);
		expect(mock.calls).toContain('face/verify');
	});

	test('an unconfirmed face still lets the person on to the member list', async ({ page }) => {
		await insertCard(page, {
			lookup: { kind: 'household', members: 4 },
			face: {
				mode: 'on',
				verdicts: [{ result: 'skipped', reason: 'no_chip_photo', attempt: 0 }]
			}
		});

		await agree(page).click();
		await page.getByRole('button', { name: 'ดำเนินการต่อ' }).click();

		await expect(page.getByRole('heading', { name: 'เลือกสมาชิก' })).toBeVisible();
	});

	test('leaving the check-in page wipes the check on the scanner client', async ({ page }) => {
		const mock = await insertCard(page, {
			lookup: { kind: 'household', members: 4 },
			face: { mode: 'on' }
		});
		await agree(page).click();
		await expect(page.getByRole('button', { name: /ยืนยัน · \d+ คน/ })).toBeEnabled();
		const before = mock.calls.filter((call) => call === 'face/cancel').length;

		await page.getByRole('link', { name: 'กลับหน้าเริ่มต้น' }).click();

		await expect(page.getByRole('heading', { name: 'รายงานตัว', exact: true })).toBeVisible();
		await expect
			.poll(() => mock.calls.filter((call) => call === 'face/cancel').length)
			.toBeGreaterThan(before);
	});

	test('asks to keep the card in, then says when it may come out', async ({ page }) => {
		await insertCard(page, { lookup: { kind: 'household', members: 4 }, face: { mode: 'on' } });
		await holdAtCamera(page, { hint: 'ok', reference: 'reading' });
		const notice = page.getByTestId('kiosk-face-card-notice');

		await expect(notice).toContainText('กรุณาเสียบบัตรค้างไว้จนกว่าระบบจะบอกให้ถอด');
		await agree(page).click();
		await expect(guide(page)).toBeVisible();
		await expect(notice).toHaveAttribute('data-card-removable', 'false');

		await page.unroute('**/api/v1/scanner/kiosk/face/frame');
		await holdAtCamera(page, { hint: 'ok', reference: 'ready' });

		await expect(notice).toHaveAttribute('data-card-removable', 'true');
		await expect(notice).toContainText('ถอดบัตรได้แล้ว');
	});

	test('skipping at the camera goes straight on to the member list', async ({ page }) => {
		const mock = await insertCard(page, {
			lookup: { kind: 'household', members: 4 },
			face: { mode: 'on' }
		});
		await holdAtCamera(page);

		await agree(page).click();
		await skip(page).click();

		await expect(page.getByRole('heading', { name: 'เลือกสมาชิก' })).toBeVisible();
		await expect(page.getByText('ระบบยืนยันไม่ได้ในขณะนี้')).toHaveCount(0);
		expect(mock.calls).not.toContain('face/verify');
	});

	test('with the face check off the member list shows at once', async ({ page }) => {
		await insertCard(page, { lookup: { kind: 'household', members: 4 } });

		await expect(page.getByRole('heading', { name: 'เลือกสมาชิก' })).toBeVisible();
	});

	test('the page has one h1 while the check is on screen', async ({ page }) => {
		await insertCard(page, { lookup: { kind: 'household', members: 4 }, face: { mode: 'on' } });

		await expect(agree(page)).toBeVisible();
		await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
	});
});
