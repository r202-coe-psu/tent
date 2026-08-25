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

		// 2. Go to /donations
		await page.goto('/donations');

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
		await page.locator('[data-slot="select-trigger"]').first().click();
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

/**
 * Cancel-from-track coverage. Both are `fixme`: under Playwright route mocking the
 * track page's tracking query never settles — the mock fulfils with 200 (the request
 * and response both show in the trace) yet the query stays `status: pending,
 * fetchStatus: fetching` indefinitely, so no branch of the page renders. Reproduced
 * with an unconditional debug element, against both `vite preview` and the dev server,
 * and on the page as it stood *before* the cancel button was added — so it is a
 * problem with mocking this route, not with the cancel wiring. The gating logic is
 * covered by unit tests on `canCancelDonation`; un-fixme these once the mocking issue
 * is understood.
 */
test.describe('Donor cancels their own reservation from the track page (T-21 DoD 4)', () => {
	const TOKEN = 'TX-SH001-CANCELME';

	/** Track payload the BFF returns for GET /api/public/v1/donations/{token}. */
	function trackBody(status: string) {
		return {
			success: true,
			donation: {
				status,
				booking_ref: 'DN-777001',
				shelter_code: 'SH001',
				donor: { name: 'ผู้บริจาคใจบุญ', phone_masked: '***-***-5678' },
				items: [{ item_name: 'ข้าวสาร', qty: 5, unit: 'kg' }],
				logistics: { delivery_method: 'self_dropoff' },
				received_summary: null,
				updated_at: '2026-08-21T03:00:00Z',
				expires_at: '2026-08-24T03:00:00Z'
			}
		};
	}

	test.fixme('cancels a declared booking and reflects the new status', async ({ page }) => {
		let cancelled = false;

		await page.route(`**/api/public/v1/donations/${TOKEN}`, async (route) => {
			if (route.request().method() === 'DELETE') {
				cancelled = true;
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ success: true, message: 'Donation cancelled successfully' })
				});
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(trackBody(cancelled ? 'cancelled' : 'declared'))
			});
		});

		await page.goto(`/donations/track/${TOKEN}`);

		const openCancel = page.getByRole('button', { name: 'ยกเลิกการจองนี้' });
		await expect(openCancel).toBeVisible();
		await openCancel.click();

		await expect(page.getByText('ยกเลิกการจองบริจาคนี้?')).toBeVisible();
		await expect(page.getByText('DN-777001')).toBeVisible();
		await page.getByRole('button', { name: 'ยืนยันยกเลิกการจอง' }).click();

		await expect(page.getByText('ยกเลิกการจองบริจาคแล้ว')).toBeVisible();
		// Refetch drove the page to the cancelled status, so the button is gone.
		await expect(openCancel).toBeHidden();
	});

	test.fixme('offers no cancel once the goods were received', async ({ page }) => {
		await page.route(`**/api/public/v1/donations/${TOKEN}`, async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(trackBody('received'))
			});
		});

		await page.goto(`/donations/track/${TOKEN}`);

		await expect(page.getByText('DN-777001')).toBeVisible();
		await expect(page.getByRole('button', { name: 'ยกเลิกการจองนี้' })).toHaveCount(0);
	});
});
