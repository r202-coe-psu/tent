import { expect, test, type Page } from '@playwright/test';
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
