import { test, expect } from '@playwright/test';

const SHELTERS = {
	shelters: [
		{
			code: 'SH001',
			name: 'ศูนย์พักพิง เทศบาลนครหาดใหญ่',
			status: 'open',
			capacity: 200,
			province: 'สงขลา',
			district: 'หาดใหญ่',
			subdistrict: 'หาดใหญ่'
		},
		{
			code: 'SH002',
			name: 'ศูนย์พักพิง โรงเรียนวัดโคกสมานคุณ',
			status: 'closed',
			capacity: 100,
			province: 'สงขลา',
			district: 'หาดใหญ่',
			subdistrict: 'คอหงส์'
		}
	],
	count: 2,
	as_of: '2026-08-20T03:00:00.000Z'
};

const BOOKING_CODE = '01JABCDEFGHJKMNPQRSTVWXYZ0';

const TICKET = {
	success: true,
	code: BOOKING_CODE,
	shelter_code: 'SH001',
	shelter_name: 'ศูนย์พักพิง เทศบาลนครหาดใหญ่',
	first_name: 'สมชาย',
	status: 'pre_registered',
	booked_at: '2026-08-20T03:00:00.000Z'
};

async function mockShelters(page: import('@playwright/test').Page) {
	await page.route('**/api/public/v1/shelters**', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(SHELTERS)
		});
	});
}

test.describe('Public shelter booking (T-71 / CR-070)', () => {
	test('books a place end to end and shows the QR ticket', async ({ page }) => {
		await mockShelters(page);

		let submitted: Record<string, unknown> | null = null;
		await page.route('**/api/public/v1/registrations', async (route) => {
			submitted = route.request().postDataJSON();
			await route.fulfill({
				status: 201,
				contentType: 'application/json',
				body: JSON.stringify(TICKET)
			});
		});

		await page.goto('/register');
		await page.evaluate(() => {
			(window as Window & { __captchaToken?: string }).__captchaToken = 'e2e-captcha-token';
		});

		// Step 1 — closed shelters must not be offered at all.
		await expect(
			page.getByRole('heading', { name: 'เลือกศูนย์พักพิงที่ต้องการเข้าพัก' })
		).toBeVisible();
		await expect(page.getByRole('button', { name: /เทศบาลนครหาดใหญ่/ })).toBeVisible();
		await expect(page.getByRole('button', { name: /โรงเรียนวัดโคกสมานคุณ/ })).toHaveCount(0);

		await page.getByRole('button', { name: /เทศบาลนครหาดใหญ่/ }).click();
		await page.getByRole('button', { name: 'ถัดไป' }).click();

		// Step 2 — the T-48 minimum.
		await expect(page.getByRole('heading', { name: 'ข้อมูลผู้จอง' })).toBeVisible();
		await page.getByLabel('ชื่อ', { exact: true }).fill('สมชาย');
		await page.getByLabel('นามสกุล').fill('ใจดี');
		// superforms seeds the enum with its first variant (ชาย); pick a different one
		// so the assertion below proves the select actually drives the payload.
		await page.locator('button[name="gender"]').click();
		await page.getByRole('option', { name: 'หญิง' }).click();
		await page.getByLabel('เบอร์โทรศัพท์').fill('0812345678');

		await page.getByRole('button', { name: 'ยืนยันการจอง' }).click();

		// Step 3 — the ticket. Scoped to <main>: the success toast carries the same
		// wording, and an unscoped getByText would match both.
		const ticket = page.getByRole('main');
		await expect(ticket.getByText('จองเข้าศูนย์สำเร็จ')).toBeVisible();
		await expect(ticket.getByText(BOOKING_CODE)).toBeVisible();
		await expect(ticket.getByAltText('QR สำหรับยืนยันตัวตนที่ประตูศูนย์')).toBeVisible();

		expect(submitted).toMatchObject({
			shelter_code: 'SH001',
			first_name: 'สมชาย',
			last_name: 'ใจดี',
			gender: 'female',
			phone: '0812345678'
		});
	});

	test('deep link from a shelter page locks the shelter and opens the form', async ({ page }) => {
		await mockShelters(page);

		await page.goto('/register?shelter=SH001');

		await expect(page.getByRole('heading', { name: 'ข้อมูลผู้จอง' })).toBeVisible();
		await expect(page.getByText('ศูนย์ที่เลือก: ศูนย์พักพิง เทศบาลนครหาดใหญ่')).toBeVisible();
		// Shelter is locked — the citizen cannot wander back and change it.
		await expect(page.getByRole('button', { name: 'ย้อนกลับ' })).toBeDisabled();
	});

	test('surfaces the server message when the shelter closed mid-flow', async ({ page }) => {
		await mockShelters(page);
		await page.route('**/api/public/v1/registrations', async (route) => {
			await route.fulfill({
				status: 409,
				contentType: 'application/json',
				body: JSON.stringify({ success: false, error: 'SHELTER_CLOSED' })
			});
		});

		await page.goto('/register?shelter=SH001');
		await page.evaluate(() => {
			(window as Window & { __captchaToken?: string }).__captchaToken = 'e2e-captcha-token';
		});

		await page.getByLabel('ชื่อ', { exact: true }).fill('สมชาย');
		await page.getByLabel('นามสกุล').fill('ใจดี');
		await page.getByLabel('เบอร์โทรศัพท์').fill('0812345678');
		await page.getByRole('button', { name: 'ยืนยันการจอง' }).click();

		await expect(page.getByRole('alert')).toContainText('ปิดรับผู้เข้าพัก');
	});

	test('track page needs both the code and the phone', async ({ page }) => {
		await page.route('**/api/public/v1/registrations/lookup', async (route) => {
			const body = route.request().postDataJSON();
			if (body.phone !== '0812345678') {
				await route.fulfill({
					status: 404,
					contentType: 'application/json',
					body: JSON.stringify({ success: false, error: 'BOOKING_NOT_FOUND' })
				});
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(TICKET)
			});
		});

		await page.goto('/register/track');

		// Wrong phone → generic failure, no ticket.
		await page.getByLabel('รหัสการจอง').fill(BOOKING_CODE);
		await page.getByLabel('เบอร์โทรศัพท์').fill('0899999999');
		await page.getByRole('button', { name: 'ตรวจสอบสถานะ' }).click();
		await expect(page.getByRole('alert')).toContainText('ไม่พบการจอง');

		// Correct pair → ticket.
		await page.getByLabel('เบอร์โทรศัพท์').fill('0812345678');
		await page.getByRole('button', { name: 'ตรวจสอบสถานะ' }).click();
		await expect(page.getByText(BOOKING_CODE)).toBeVisible();
		await expect(page.getByAltText('QR สำหรับยืนยันตัวตนที่ประตูศูนย์')).toBeVisible();
	});

	test('the landing CTA and navbar reach the booking flow', async ({ page }) => {
		await mockShelters(page);
		await page.goto('/');

		const cta = page.getByRole('link', { name: /จองเข้าศูนย์ล่วงหน้า/ }).first();
		await expect(cta).toBeVisible();
		await expect(cta).toHaveAttribute('href', /\/register$/);

		await cta.click();
		await expect(page).toHaveURL(/\/register$/);
		await expect(
			page.getByRole('heading', { name: 'เลือกศูนย์พักพิงที่ต้องการเข้าพัก' })
		).toBeVisible();
	});
});
