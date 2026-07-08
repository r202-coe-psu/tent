import { test, expect } from '@playwright/test';

test.describe('Public Donation & Queue Booking Wizard (T-60)', () => {
	test('successfully performs the entire 4-step wizard donation flow', async ({ page }) => {
		// 1. Mock API GET /api/public/v1/needs
		await page.route('**/api/public/v1/needs', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify([
					{
						code: 'SH001',
						name: 'ศูนย์พักพิง เทศบาลนครหาดใหญ่ (โรงเรียนเทศบาล 2)',
						needs: [
							{
								item_id: 'item:rice',
								name: 'ข้าวสาร',
								qty_needed: 50,
								unit: 'kg',
								status: 'open'
							},
							{
								item_id: 'item:water',
								name: 'น้ำดื่ม',
								qty_needed: 0,
								unit: 'bottle',
								status: 'closed' // งดรับ
							}
						]
					}
				])
			});
		});

		// 2. Go to /public/donations
		await page.goto('/public/donations');

		// Step 1: Needs Board
		await expect(page.locator('h2', { hasText: 'กระดานความต้องการด่วน' })).toBeVisible();

		// Confirm mock needs lists are shown correctly
		await expect(page.getByText('ศูนย์พักพิง เทศบาลนครหาดใหญ่ (โรงเรียนเทศบาล 2)')).toBeVisible();
		await expect(page.getByRole('button', { name: /ด่วน! ข้าวสาร/ })).toBeVisible();
		await expect(page.getByText('งดรับ (ครบแล้ว)')).toBeVisible();

		// Click the need card to lock SH001 and pre-fill "ข้าวสาร"
		await page.getByRole('button', { name: /ด่วน! ข้าวสาร/ }).click();

		// Step 2: Form
		await expect(page.locator('h2', { hasText: 'ส่วนที่ 1: ข้อมูลผู้บริจาค' })).toBeVisible();

		// Fill donor info
		await page.locator('#donor-name').fill('ผู้บริจาคใจบุญ');
		await page.locator('#donor-phone').fill('0899999999');
		await page.locator('#donor-line').fill('donordonor');
		await page.locator('#donor-email').fill('donor@example.com');

		// Fill item details (already pre-filled with name/qty/unit, let's verify)
		const itemName = page.locator('input[placeholder="เช่น น้ำดื่มขวด 600ml"]');
		await expect(itemName).toHaveValue('ข้าวสาร');

		// Select item category
		// Click category select trigger
		await page.getByRole('combobox').first().click();
		await page.getByRole('option', { name: 'อาหาร/เครื่องดื่ม' }).click();

		// Click Next to Step 3
		await page.getByRole('button', { name: 'ถัดไป: เลือกจุดส่งมอบ' }).click();

		// Step 3: Logistics & Time selection
		await expect(
			page.locator('h1', { hasText: 'ส่วนที่ 3: ข้อมูลการจัดส่ง โลจิสติกส์' })
		).toBeVisible();

		// Assert shelter is locked to SH001
		await expect(page.getByText('ล็อกตามความต้องการที่เลือก')).toBeVisible();

		// Choose delivery method (Button grid)
		await page.getByRole('button', { name: 'ส่งผ่านขนส่งพัสดุ' }).click();

		// Mock POST /api/public/v1/donations response
		await page.route('**/api/public/v1/donations', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					success: true,
					trackingToken: 'TX-SH001-E2ETEST',
					bookingRef: 'DN-555555'
				})
			});
		});

		// Mock the window captcha token to bypass captcha check
		await page.evaluate(() => {
			(window as Window & { __captchaToken?: string }).__captchaToken = 'e2e-captcha-token';
		});

		// Click confirm submission
		await page.getByRole('button', { name: 'ยืนยันการจองคิวบริจาค' }).click();

		// Step 4: Success Ticket
		await expect(page.locator('h2', { hasText: 'จองสิทธิ์บริจาคสําเร็จ!' })).toBeVisible();
		await expect(page.getByText('DN-555555')).toBeVisible();
		await expect(page.getByText('TX-SH001-E2ETEST').first()).toBeVisible();
		await expect(page.getByText('ผู้บริจาคใจบุญ')).toBeVisible();

		// Mock PATCH for courier tracking update
		await page.route('**/api/public/v1/donations/TX-SH001-E2ETEST', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					success: true,
					message: 'Courier tracking number updated'
				})
			});
		});

		// Type courier tracking and save
		await page.locator('input[placeholder="เลขพัสดุ เช่น TH12345678"]').fill('TH123456789');
		await page.getByRole('button', { name: 'บันทึก' }).click();

		// Check success message
		await expect(page.getByText('บันทึกเลขพัสดุเรียบร้อยแล้ว')).toBeVisible();
	});
});
