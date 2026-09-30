import { expect, test, type Page } from '@playwright/test';
import {
	KIOSK_CITIZEN_ID,
	KIOSK_QUERY,
	dispatchKioskEvent,
	mockKioskApi,
	tapDigits,
	type KioskMockOptions
} from './helpers/kiosk';

/**
 * /kiosk layout checks — docs/features/kiosk-portrait-layout-implementation-plan.md §7.
 * Flows run on the original 10.1" panel (1024×600); the portrait describe switches to the 24"
 * portrait monitor (1080×1920). Viewports are CSS pixels at DPR 1.
 */

const LANDSCAPE = { width: 1024, height: 600 };
// The 1024×600 panel run with DEVICE_SCALE_FACTOR=0.75.
const LANDSCAPE_DSF075 = { width: 1365, height: 800 };
const PORTRAIT = { width: 1080, height: 1920 };

test.use({
	viewport: LANDSCAPE,
	deviceScaleFactor: 1,
	hasTouch: true,
	locale: 'th-TH',
	timezoneId: 'Asia/Bangkok'
});

async function open(page: Page, path: string, options?: KioskMockOptions) {
	const mock = await mockKioskApi(page, options);
	await page.goto(`${path}${path.includes('?') ? '&' : '?'}${KIOSK_QUERY.slice(1)}`);
	return mock;
}

async function searchByPhone(page: Page) {
	await tapDigits(page, '0812345678');
	await page.getByRole('button', { name: 'ค้นหา', exact: true }).click();
}

test.describe('kiosk layout — method selector', () => {
	test('four methods', async ({ page }) => {
		await open(page, '/kiosk');
		await expect(page.getByRole('heading', { name: 'รายงานตัว' })).toBeVisible();
		await expect(page.locator('.method-card')).toHaveCount(4);
	});

	test('three methods (phone disabled)', async ({ page }) => {
		await open(page, '/kiosk', { phoneCheckInEnabled: false });
		await expect(page.getByRole('heading', { name: 'รายงานตัว' })).toBeVisible();
		await expect(page.locator('.method-card')).toHaveCount(3);
	});
});

test.describe('kiosk layout — phone entry', () => {
	test('empty', async ({ page }) => {
		await open(page, '/kiosk/phone');
		await expect(page.getByRole('group', { name: 'ปุ่มกดตัวเลข' })).toBeVisible();
	});

	test('partial number', async ({ page }) => {
		await open(page, '/kiosk/phone');
		await tapDigits(page, '08123');
		await expect(page.getByRole('button', { name: 'ค้นหา', exact: true })).toBeDisabled();
	});

	test('complete number', async ({ page }) => {
		await open(page, '/kiosk/phone');
		await tapDigits(page, '0812345678');
		await expect(page.getByRole('button', { name: 'ค้นหา', exact: true })).toBeEnabled();
	});
});

test.describe('kiosk layout — qr scan', () => {
	// Headless Chromium has no camera, so this is the stable "camera unavailable" state.
	test('camera unavailable', async ({ page }) => {
		await open(page, '/kiosk/qr');
		await expect(page.getByText('เปิดกล้องไม่ได้')).toBeVisible();
	});
});

test.describe('kiosk layout — scanner (smart card)', () => {
	test('waiting', async ({ page }) => {
		await open(page, '/kiosk/scanner/waiting');
		await expect(page.getByRole('heading', { name: 'เสียบบัตรประชาชน' })).toBeVisible();
	});

	test('reading', async ({ page }) => {
		await open(page, '/kiosk/scanner/reading');
		await expect(page.getByRole('heading', { name: 'กำลังอ่านบัตร' })).toBeVisible();
	});

	test('error', async ({ page }) => {
		await open(page, '/kiosk/scanner/error');
		await expect(page.getByRole('heading', { name: 'อ่านบัตรไม่สำเร็จ' })).toBeVisible();
	});

	test('remove card to confirm, then pick members', async ({ page }) => {
		await open(page, '/kiosk/scanner/remove-card', { lookup: { kind: 'household', members: 4 } });
		await page.locator('[data-kiosk-card-ready="true"]').waitFor({ state: 'attached' });
		await dispatchKioskEvent(page, 'kiosk:smart-card-read', { citizenId: KIOSK_CITIZEN_ID });
		await expect(page.getByRole('heading', { name: 'เลือกสมาชิก' })).toBeVisible();
		await expect(page.getByText('ถอดบัตรเพื่อยืนยัน').first()).toBeVisible();

		await dispatchKioskEvent(page, 'kiosk:smart-card-removed');
		await expect(page.getByRole('button', { name: /ยืนยัน · \d+ คน/ })).toBeEnabled();
	});
});

test.describe('kiosk layout — phone check-in flow', () => {
	test('household picker (several households share the number)', async ({ page }) => {
		await open(page, '/kiosk/phone', { lookup: { kind: 'candidates' } });
		await searchByPhone(page);
		await expect(page.getByRole('heading', { name: 'เลือกครัวเรือน' })).toBeVisible();
	});

	for (const size of [4, 10]) {
		test(`member selection (${size} people)`, async ({ page }) => {
			await open(page, '/kiosk/phone', { lookup: { kind: 'household', members: size } });
			await searchByPhone(page);
			await expect(page.getByRole('heading', { name: 'เลือกสมาชิก' })).toBeVisible();
		});
	}

	test('result and print overlay', async ({ page }) => {
		const mock = await open(page, '/kiosk/phone', {
			lookup: { kind: 'household', members: 4 },
			print: 'hold'
		});
		await searchByPhone(page);
		await page.getByRole('button', { name: /ยืนยัน · \d+ คน/ }).click();
		await expect(page.getByRole('heading', { name: 'ผลรายงานตัว', exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'พิมพ์ QR Code' })).toBeEnabled();

		await page.getByRole('button', { name: 'พิมพ์ QR Code' }).click();
		await expect(page.getByText('กำลังพิมพ์ QR Code')).toBeVisible();

		mock.releasePrint();
		await expect(page.getByText('พิมพ์เสร็จแล้ว')).toBeVisible();
	});

	test('lookup error (number not found)', async ({ page }) => {
		await open(page, '/kiosk/phone', {
			lookup: {
				kind: 'error',
				status: 404,
				code: 'PRE_REGISTRATION_NOT_FOUND',
				message: 'ไม่พบข้อมูลการลงทะเบียนล่วงหน้า'
			}
		});
		await searchByPhone(page);
		await expect(page.getByRole('heading', { name: 'ค้นหาไม่สำเร็จ' })).toBeVisible();
	});
});

test.describe('kiosk layout — walk-in registration', () => {
	test('consent, card and done', async ({ page }) => {
		await open(page, '/kiosk/scanner/remove-card', {
			lookup: {
				kind: 'error',
				status: 404,
				code: 'PRE_REGISTRATION_NOT_FOUND',
				message: 'ไม่พบข้อมูลการลงทะเบียนล่วงหน้า',
				canRegister: true
			}
		});
		await page.locator('[data-kiosk-card-ready="true"]').waitFor({ state: 'attached' });
		await dispatchKioskEvent(page, 'kiosk:smart-card-read', { citizenId: KIOSK_CITIZEN_ID });
		await page.getByRole('button', { name: 'ลงทะเบียนใหม่' }).click();

		await expect(
			page.getByRole('heading', { name: 'ยินยอมให้อ่านข้อมูลจากบัตรประชาชน' })
		).toBeVisible();

		await page.getByRole('button', { name: 'ยินยอมและดำเนินการ' }).click();
		await page.locator('[data-kiosk-register-ready="true"]').waitFor({ state: 'attached' });
		await expect(page.getByRole('heading', { name: 'เสียบบัตรประชาชน' })).toBeVisible();

		await dispatchKioskEvent(page, 'kiosk:smart-card-full-read-error');
		await expect(page.getByRole('alert')).toBeVisible();

		await dispatchKioskEvent(page, 'kiosk:smart-card-full-read', { citizen_id: KIOSK_CITIZEN_ID });
		await expect(page.getByRole('heading', { name: 'ลงทะเบียนสำเร็จ' })).toBeVisible();
	});
});

/** Finger taps (touch events), spaced out for the numpad's 80 ms debounce. */
async function tapKeys(page: Page, digits: string): Promise<void> {
	for (const digit of digits) {
		await page.getByRole('button', { name: `ตัวเลข ${digit}` }).tap();
		await page.waitForTimeout(100);
	}
}

// Whole visits from the home screen, one finger tap per step, on both kiosk screens.
// Watch one: `pnpm exec playwright test e2e/kiosk-layout.test.ts -g "journey" --headed --debug`.
for (const [name, viewport] of [
	['1024×600', LANDSCAPE],
	['1080×1920', PORTRAIT]
] as const) {
	test.describe(`kiosk journey ${name} — tap step by step`, () => {
		test.use({ viewport });

		test('phone: home → number → members → confirm → print → done', async ({ page }) => {
			const mock = await open(page, '/kiosk', {
				lookup: { kind: 'household', members: 4 },
				print: 'hold'
			});
			const search = page.getByRole('button', { name: 'ค้นหา', exact: true });
			const confirm = page.getByRole('button', { name: /ยืนยัน · \d+ คน/ });

			await test.step('1. หน้าแรก → แตะ "เบอร์โทรศัพท์"', async () => {
				await expect(page.locator('.method-card')).toHaveCount(4);
				await page.getByRole('link', { name: /^เบอร์โทรศัพท์/ }).tap();
				await expect(page).toHaveURL(/\/kiosk\/phone\?/);
				await expect(page.getByRole('group', { name: 'ปุ่มกดตัวเลข' })).toBeVisible();
			});

			await test.step('2. กดเบอร์ทีละตัว → ปุ่มค้นหากดได้เมื่อครบ', async () => {
				await expect(search).toBeDisabled();
				await tapKeys(page, '08123');
				await expect(search).toBeDisabled();
				await tapKeys(page, '45679');
				await page.getByRole('button', { name: 'ลบหนึ่งตัว' }).tap();
				await page.waitForTimeout(100);
				await tapKeys(page, '8');
				await expect(page.getByLabel('เบอร์โทรศัพท์ที่กรอก')).toHaveText('081-234-5678');
				await expect(search).toBeEnabled();
			});

			await test.step('3. แตะ "ค้นหา" → หน้าเลือกสมาชิก (เลือกคนที่รายงานได้ไว้ครบ)', async () => {
				await search.tap();
				await expect(page.getByRole('heading', { name: 'เลือกสมาชิก' })).toBeVisible();
				await expect(confirm).toHaveText(/ยืนยัน · 3\s+คน/);
			});

			await test.step('4. แตะเอาสมาชิกออก 1 คน → จำนวนในปุ่มยืนยันลดลง', async () => {
				await page.getByRole('checkbox', { name: /สมหญิง/ }).tap();
				await expect(confirm).toHaveText(/ยืนยัน · 2\s+คน/);
			});

			await test.step('5. แตะ "ยืนยัน" → หน้าผลรายงานตัว', async () => {
				await confirm.tap();
				await expect(page.getByRole('heading', { name: 'ผลรายงานตัว', exact: true })).toBeVisible();
				await expect(page.getByText(/รายงานตัวแล้ว 2 จาก 2 คน/)).toBeVisible();
			});

			await test.step('6. แตะ "พิมพ์ QR Code" → กำลังพิมพ์ → พิมพ์เสร็จ', async () => {
				await page.getByRole('button', { name: 'พิมพ์ QR Code' }).tap();
				await expect(page.getByText('กำลังพิมพ์ QR Code')).toBeVisible();
				mock.releasePrint();
				await expect(page.getByText('พิมพ์เสร็จแล้ว')).toBeVisible();
				await expect(page.getByText('พิมพ์เสร็จแล้ว')).toBeHidden({ timeout: 5_000 });
			});

			await test.step('7. แตะ "เสร็จสิ้น" → กลับหน้ากรอกเบอร์ (ช่องว่าง)', async () => {
				await page.getByRole('button', { name: 'เสร็จสิ้น' }).tap();
				await expect(page.getByLabel('เบอร์โทรศัพท์ที่กรอก')).toHaveText('เบอร์โทรศัพท์');
				await expect(search).toBeDisabled();
			});

			await test.step('8. แตะ "กลับ" → หน้าแรก', async () => {
				await page.getByRole('link', { name: 'กลับหน้าเริ่มต้น' }).tap();
				await expect(page).toHaveURL(/\/kiosk\?/);
				await expect(page.getByRole('heading', { name: 'รายงานตัว', exact: true })).toBeVisible();
			});
		});

		test('smart card: home → insert → remove card → confirm → done', async ({ page }) => {
			await open(page, '/kiosk', { lookup: { kind: 'household', members: 4 } });
			const confirm = page.getByRole('button', { name: /ยืนยัน · \d+ คน/ });

			await test.step('1. หน้าแรก → แตะ "บัตรประชาชน" → หน้ารอเสียบบัตร', async () => {
				await page.getByRole('link', { name: /^บัตรประชาชน/ }).tap();
				await expect(page).toHaveURL(/\/kiosk\/scanner\/waiting\?/);
				await expect(page.getByRole('heading', { name: 'เสียบบัตรประชาชน' })).toBeVisible();
			});

			await test.step('2. เสียบบัตร (scanner_client พาไปหน้าถอดบัตรแล้วส่งเลขบัตร)', async () => {
				// scanner_client drives this hop itself: it navigates, then fires the card event.
				await page.goto(`/kiosk/scanner/remove-card${KIOSK_QUERY}`);
				await page.locator('[data-kiosk-card-ready="true"]').waitFor({ state: 'attached' });
				await dispatchKioskEvent(page, 'kiosk:smart-card-read', { citizenId: KIOSK_CITIZEN_ID });
				await expect(page.getByRole('heading', { name: 'เลือกสมาชิก' })).toBeVisible();
				await expect(confirm).toHaveText(/ยืนยัน · 1\s+คน/);
				await expect(confirm).toBeDisabled();
			});

			await test.step('3. ถอดบัตร → ปุ่มยืนยันกดได้', async () => {
				await dispatchKioskEvent(page, 'kiosk:smart-card-removed');
				await expect(confirm).toBeEnabled();
			});

			await test.step('4. แตะ "ยืนยัน" → หน้าผลรายงานตัว', async () => {
				await confirm.tap();
				await expect(page.getByRole('heading', { name: 'ผลรายงานตัว', exact: true })).toBeVisible();
			});

			await test.step('5. แตะ "เสร็จสิ้น" → หน้าแรก', async () => {
				await page.getByRole('button', { name: 'เสร็จสิ้น' }).tap();
				await expect(page).toHaveURL(/\/kiosk\?/);
				await expect(page.getByRole('heading', { name: 'รายงานตัว', exact: true })).toBeVisible();
			});
		});
	});
}

// app.css `@layer base { html { font-size: 18px } }`
const BASE_ROOT_FONT_SIZE = 18;

async function horizontalOverflow(page: Page) {
	return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

async function rootFontSize(page: Page) {
	return page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
}

for (const [name, viewport] of [
	['1024×600', LANDSCAPE],
	['1365×800 (DSF 0.75)', LANDSCAPE_DSF075]
] as const) {
	test.describe(`kiosk landscape ${name} — original profile`, () => {
		test.use({ viewport });

		test('method selector keeps the base root font and no horizontal scroll', async ({ page }) => {
			await open(page, '/kiosk');
			await expect(page.locator('.method-card')).toHaveCount(4);
			expect(await rootFontSize(page)).toBe(BASE_ROOT_FONT_SIZE);
			expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
		});

		test('phone entry hides the portrait-only title and hint', async ({ page }) => {
			await open(page, '/kiosk/phone');
			await tapDigits(page, '08123');
			// sr-only: still in the accessibility tree, but a 1px clipped box on screen.
			const title = page.getByRole('heading', { name: 'กรอกเบอร์โทรศัพท์' });
			expect((await title.boundingBox())?.width ?? 0).toBeLessThanOrEqual(1);
			await expect(page.getByText('กรอกให้ครบ 9–10 หลัก ขึ้นต้นด้วย 0')).toBeHidden();
			expect(await rootFontSize(page)).toBe(BASE_ROOT_FONT_SIZE);
			expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
		});
	});
}

test.describe('kiosk portrait 1080×1920 — acceptance', () => {
	test.use({ viewport: PORTRAIT });

	const fractionOfHeight = (page: Page, value: number) =>
		page.evaluate((y) => y / window.innerHeight, value);

	async function pageMetrics(page: Page) {
		return page.evaluate(() => ({
			scrollWidth: document.documentElement.scrollWidth,
			scrollHeight: document.documentElement.scrollHeight,
			innerWidth: window.innerWidth,
			innerHeight: window.innerHeight,
			rootFontSize: parseFloat(getComputedStyle(document.documentElement).fontSize)
		}));
	}

	async function expectFits(page: Page) {
		const metrics = await pageMetrics(page);
		expect(metrics.scrollWidth, 'no horizontal scroll').toBeLessThanOrEqual(metrics.innerWidth);
		expect(metrics.scrollHeight, 'no vertical scroll').toBeLessThanOrEqual(metrics.innerHeight);
	}

	test('AC-L5 root font is 20px on kiosk screens and only while the shell is mounted', async ({
		page
	}) => {
		await open(page, '/kiosk');
		await expect(page.getByRole('heading', { name: 'รายงานตัว' })).toBeVisible();
		expect((await pageMetrics(page)).rootFontSize).toBeCloseTo(20, 0);

		await page.evaluate(() => document.querySelector('[data-kiosk-shell]')?.remove());
		expect((await pageMetrics(page)).rootFontSize).toBe(BASE_ROOT_FONT_SIZE);
	});

	test('AC-L3/L4 method selector fits the screen and keeps touch targets large', async ({
		page
	}) => {
		await open(page, '/kiosk');
		await expect(page.locator('.method-card')).toHaveCount(4);
		await expectFits(page);

		const { innerHeight } = await pageMetrics(page);
		const boxes = await Promise.all(
			(await page.locator('.method-card').all()).map(async (card) => (await card.boundingBox())!)
		);
		for (const box of boxes) expect(box.height).toBeGreaterThanOrEqual(72);

		// The stack as a whole sits in the middle of the screen (AC-L7).
		const top = boxes[0].y;
		const bottom = boxes.at(-1)!.y + boxes.at(-1)!.height;
		const centre = (top + bottom) / 2 / innerHeight;
		expect(centre).toBeGreaterThanOrEqual(0.4);
		expect(centre).toBeLessThanOrEqual(0.92);
	});

	test('every screen title uses the same size', async ({ page }) => {
		await mockKioskApi(page, { lookup: { kind: 'household', members: 4 } });
		const sizes: Record<string, number> = {};
		const titleSize = () =>
			page
				.locator('h1')
				.first()
				.evaluate((node) => parseFloat(getComputedStyle(node).fontSize));

		for (const path of [
			'/kiosk',
			'/kiosk/phone',
			'/kiosk/qr',
			'/kiosk/scanner/waiting',
			'/kiosk/scanner/reading',
			'/kiosk/scanner/error'
		]) {
			await page.goto(`${path}${KIOSK_QUERY}`);
			await expect(page.locator('h1').first()).toBeVisible();
			sizes[path] = await titleSize();
		}

		await page.goto(`/kiosk/phone${KIOSK_QUERY}`);
		await searchByPhone(page);
		await expect(page.getByRole('heading', { name: 'เลือกสมาชิก' })).toBeVisible();
		sizes['check-in'] = await titleSize();

		expect(new Set(Object.values(sizes)), JSON.stringify(sizes)).toEqual(new Set([45]));
	});

	test('AC-L3/L4/L6/L7/L9/L15 phone entry is a fixed, mid-screen numpad', async ({ page }) => {
		await open(page, '/kiosk/phone');
		await expect(page.getByRole('group', { name: 'ปุ่มกดตัวเลข' })).toBeVisible();
		await expectFits(page);

		const { innerHeight } = await pageMetrics(page);
		for (const digit of '0123456789') {
			const box = (await page.getByRole('button', { name: `ตัวเลข ${digit}` }).boundingBox())!;
			expect(box.height, `key ${digit} height`).toBeGreaterThanOrEqual(100);
			expect(box.width, `key ${digit} width`).toBeGreaterThanOrEqual(200);
		}

		const pad = (await page.getByRole('group', { name: 'ปุ่มกดตัวเลข' }).boundingBox())!;
		expect(await fractionOfHeight(page, pad.y)).toBeGreaterThanOrEqual(0.25);
		expect(await fractionOfHeight(page, pad.y + pad.height)).toBeLessThanOrEqual(0.78);

		const output = (await page.getByLabel('เบอร์โทรศัพท์ที่กรอก').boundingBox())!;
		expect(output.y + output.height).toBeLessThanOrEqual(pad.y);

		const search = page.getByRole('button', { name: 'ค้นหา', exact: true });
		const searchBox = (await search.boundingBox())!;
		expect(searchBox.height).toBeGreaterThanOrEqual(72);
		const centre = (searchBox.y + searchBox.height / 2) / innerHeight;
		expect(centre).toBeGreaterThanOrEqual(0.4);
		expect(centre).toBeLessThanOrEqual(0.92);

		const hintSize = await page
			.getByText('ใช้เบอร์ที่กรอกตอนลงทะเบียนล่วงหน้า')
			.evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
		expect(hintSize).toBeGreaterThanOrEqual(20);
	});

	test('AC-L15 incomplete numbers explain why search is disabled, complete ones enable it', async ({
		page
	}) => {
		await open(page, '/kiosk/phone');
		const hint = page.getByText('กรอกให้ครบ 9–10 หลัก ขึ้นต้นด้วย 0');
		const search = page.getByRole('button', { name: 'ค้นหา', exact: true });

		await expect(hint).toBeHidden();
		await tapDigits(page, '08123');
		await expect(hint).toBeVisible();
		await expect(search).toBeDisabled();

		await tapDigits(page, '45678');
		await expect(hint).toBeHidden();
		await expect(search).toBeEnabled();
	});

	test('AC-L10 a small portrait screen keeps the original layout', async ({ page }) => {
		await page.setViewportSize({ width: 600, height: 1024 });
		await open(page, '/kiosk');
		await expect(page.getByRole('heading', { name: 'รายงานตัว' })).toBeVisible();
		const metrics = await pageMetrics(page);
		expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
		expect(metrics.rootFontSize).toBe(BASE_ROOT_FONT_SIZE);
	});
});
