import { test, expect, type Page } from '@playwright/test';

const TAGS = { tag: ['@regression', '@kiosk'] };

type PrintSnapshot = {
	area: { display: string; width: number; height: number; parentIsBody: boolean } | null;
	/** Computed `display` of every other child of <body>. */
	others: { tag: string; display: string }[];
};

declare global {
	interface Window {
		__printSnapshots: PrintSnapshot[];
	}
}

/**
 * Replaces `window.print` with a stub that records the computed styles at call time. The label
 * sheets unmount as soon as `print()` returns, so they cannot be inspected afterwards.
 */
async function stubPrint(page: Page) {
	await page.addInitScript(() => {
		window.__printSnapshots = [];
		window.print = () => {
			const area = document.querySelector('.kiosk-print-area');
			const rect = area?.getBoundingClientRect();
			window.__printSnapshots.push({
				area:
					area && rect
						? {
								display: getComputedStyle(area).display,
								width: rect.width,
								height: rect.height,
								parentIsBody: area.parentElement === document.body
							}
						: null,
				others: [...document.body.children]
					.filter((child) => child !== area)
					.map((child) => ({ tag: child.tagName, display: getComputedStyle(child).display }))
			});
		};
	});
}

async function expectPrintedSheet(page: Page) {
	await expect.poll(() => page.evaluate(() => window.__printSnapshots.length)).toBe(1);
	const [snapshot] = await page.evaluate(() => window.__printSnapshots);

	// Mounted straight on <body> and still on screen: a display:none here prints a blank page.
	expect(snapshot.area?.parentIsBody).toBe(true);
	expect(snapshot.area?.display).not.toBe('none');
	expect(snapshot.area?.width).toBeGreaterThan(0);
	expect(snapshot.area?.height).toBeGreaterThan(0);
	// The kiosk screen around it is dropped so it does not print as extra pages.
	expect(snapshot.others.length).toBeGreaterThan(0);
	for (const other of snapshot.others) expect(other.display, other.tag).toBe('none');
}

/** The kiosk label's global print rules must be in this build's CSS, or the checks prove nothing. */
async function kioskPrintRulesLoaded(page: Page) {
	return page.evaluate(() =>
		[...document.styleSheets].some((sheet) => {
			try {
				return [...sheet.cssRules].some((rule) => rule.cssText.includes('kiosk-print-area'));
			} catch {
				return false; // cross-origin sheet (fonts)
			}
		})
	);
}

/** Answer the config and hardware calls; a 404 print makes the kiosk fall back to window.print. */
async function mockKioskBackend(page: Page) {
	await page.route('**/api/v1/kiosk/config', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				phone_check_in_enabled: true,
				walk_in_registration_enabled: false,
				thaid_check_in_enabled: false
			})
		})
	);
	await page.route('**/api/v1/kiosk/hardware', (route) =>
		route.fulfill({ status: 404, body: '{}' })
	);
	await page.route('**/api/v1/kiosk/banners', (route) =>
		route.fulfill({ status: 404, body: '{}' })
	);
	await page.route('**/api/v1/kiosk/print', (route) => route.fulfill({ status: 404, body: '{}' }));
}

test.describe('Kiosk label sheets under print media', () => {
	test.beforeEach(async ({ page }) => {
		await stubPrint(page);
		await mockKioskBackend(page);
	});

	test(
		'the volunteer label stays visible and the kiosk screen is hidden',
		TAGS,
		async ({ page }) => {
			await page.route('**/api/v1/kiosk/volunteer-card', (route) =>
				route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						shelter_code: 'SH001',
						volunteer: {
							display_name: 'สมหญิง ใจดี',
							volunteer_code: 'VOL-0001',
							qr_payload: 'volunteer:VOL-0001'
						}
					})
				})
			);

			await page.goto('/kiosk/volunteer?shelter_code=SH001');
			for (const digit of '0812345678') {
				await page.locator(`button[aria-label="ตัวเลข ${digit}"]`).click();
				// The numpad ignores taps closer together than 80 ms.
				await page.waitForTimeout(100);
			}
			await page.getByRole('button', { name: 'ค้นหา' }).click();

			await expect(page.getByRole('button', { name: 'พิมพ์ QR' })).toBeVisible();
			expect(await kioskPrintRulesLoaded(page)).toBe(true);
			await page.emulateMedia({ media: 'print' });
			await page.getByRole('button', { name: 'พิมพ์ QR' }).click();

			await expectPrintedSheet(page);
		}
	);

	test('the kiosk label stays visible and the kiosk screen is hidden', TAGS, async ({ page }) => {
		await page.route('**/api/v1/kiosk/device-info', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					device: {
						device_id: 'kiosk-01',
						name: 'Kiosk หน้าประตู',
						station_name: 'ลงทะเบียน',
						screen_type: 'portrait'
					},
					shelter: { code: 'SH001', name: 'ศูนย์พักพิง A' },
					staff_pin: { is_default: false, updated_at: null },
					banner_group: null
				})
			})
		);
		await page.route('**/api/v1/kiosk/host-info', (route) =>
			route.fulfill({ status: 404, body: '{}' })
		);

		await page.goto('/kiosk?shelter_code=SH001');
		// Boot lands on the language picker first; Thai keeps the labels below.
		await expect(page).toHaveURL(/\/kiosk\/language\?shelter_code=SH001$/);
		await page.locator('[data-language="th"]').click();
		await expect(page).toHaveURL(/\/kiosk\?shelter_code=SH001$/);
		await page.getByRole('button', { name: 'ข้อมูลเครื่อง' }).click();
		for (const digit of '123456') await page.keyboard.press(digit);
		await page.getByRole('button', { name: 'ยืนยัน', exact: true }).click();
		await expect(page.getByTestId('kiosk-device-info-panel')).toBeVisible();

		expect(await kioskPrintRulesLoaded(page)).toBe(true);
		await page.emulateMedia({ media: 'print' });
		await page.getByTestId('kiosk-device-info-test-print').click();

		await expectPrintedSheet(page);
	});
});
