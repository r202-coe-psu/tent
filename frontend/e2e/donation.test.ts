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
								category: 'food',
								qty_needed: 50,
								qty_target: 100,
								on_hand: 30,
								reserved: 20,
								unit: 'kg',
								urgency: 'critical',
								status: 'open'
							},
							{
								item_id: 'item:water',
								name: 'น้ำดื่ม',
								qty_needed: 0,
								unit: 'bottle',
								status: 'closed' // ล้นสต็อก
							}
						]
					}
				])
			});
		});

		// 2. Go to /donations
		await page.goto('/donations');

		// Step 1: Needs Board — shelter cards first, needs one level in
		await expect(page.getByRole('heading', { name: /กระดาน\s*ความต้องการด่วน/ })).toBeVisible();
		await expect(page.getByText('ศูนย์พักพิง เทศบาลนครหาดใหญ่ (โรงเรียนเทศบาล 2)')).toBeVisible();

		// Open the shelter, then pick the need — locks SH001 and pre-fills "ข้าวสาร"
		await page.getByRole('button', { name: 'ดูรายละเอียดและบริจาค' }).first().click();
		await expect(page.getByText('ข้าวสาร').first()).toBeVisible();
		// The closed line is shown as overstocked rather than offered for donation
		await expect(page.getByText('ล้นสต็อก (ไม่ต้องนำมา)')).toBeVisible();
		await page.getByRole('button', { name: 'บริจาครายการนี้' }).first().click();

		// Step 2: Form
		await expect(page.getByRole('heading', { name: 'ส่วนที่ 1: ข้อมูลผู้บริจาค' })).toBeVisible();

		// Fill donor info
		await page.locator('#donor-name').fill('ผู้บริจาคใจบุญ');
		await page.locator('#donor-phone').fill('0899999999');
		await page.locator('#donor-line').fill('donordonor');
		await page.locator('#donor-email').fill('donor@example.com');

		// Fill item details (already pre-filled with name/qty/unit, let's verify)
		// Keyed on the field's own id (`name-{item.id}`), not its placeholder copy —
		// the placeholder has been reworded twice and silently broke this assertion.
		const itemName = page.locator('input[id^="name-"]').first();
		await expect(itemName).toHaveValue('ข้าวสาร');

		// Category and unit are carried over from the catalog rather than asked for:
		// the category used to default to "food" for every booking (filing blankets as
		// food), and the unit is rendered from the canonical code (`kg` → "กิโลกรัม").
		await expect(page.getByRole('textbox', { name: 'หมวดหมู่' })).not.toHaveValue('');
		await expect(page.getByRole('textbox', { name: 'หน่วย' })).toHaveValue('กิโลกรัม');

		// Click Next to Step 3
		await page.getByRole('button', { name: 'ถัดไป: เลือกจุดส่งมอบ' }).click();

		// Step 3: Logistics & Time selection
		await expect(
			page.getByRole('heading', { name: 'ส่วนที่ 3: ข้อมูลการจัดส่ง โลจิสติกส์' })
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

		// Step 4: Ticket. Every public booking opens in `pending_review` (CR-052 §1.4),
		// so the ticket always shows the waiting state and never issues a check-in QR —
		// it used to guess client-side and hand out a pass no one had approved.
		await expect(
			page.getByRole('heading', { name: 'ส่งรายการรอเจ้าหน้าที่ตรวจสอบ' })
		).toBeVisible();
		await expect(page.getByText('DN-555555').first()).toBeVisible();
		await expect(page.getByText('TX-SH001-E2ETEST').first()).toBeVisible();
		// The pending ticket carries what the donor needs in order to follow up — the
		// waiting state and the destination — not their own name.
		await expect(page.getByText('กำลังรอประเมินพื้นที่คลัง').first()).toBeVisible();
		await expect(
			page.getByText('ศูนย์พักพิง เทศบาลนครหาดใหญ่ (โรงเรียนเทศบาล 2)').first()
		).toBeVisible();

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
		await expect(page.getByText('บันทึกเลขพัสดุเรียบร้อยแล้ว').first()).toBeVisible();
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

/**
 * Urgency is the level STAFF pick in back-office, carried by the projection as
 * `urgency` (`worker/projectors/needs.py`). The board used to decide it here instead
 * — `urgency === 'critical' || qty_needed >= 50` — so every sizeable shortage showed
 * as วิกฤต and lowering the level in back-office changed nothing. These lock the three
 * levels to the stored value, and keep `normal` a real level rather than the absence
 * of a badge: its chip filters, so it has to be visible and selectable.
 */
test.describe('Needs board reflects the urgency staff set (not the quantity)', () => {
	const SHELTER = 'ศูนย์พักพิงทดสอบความเร่งด่วน';

	/** Every level carries a shortage well over the old `>= 50` threshold. */
	const NEEDS = [
		{
			item_id: 'item:rice',
			name: 'ข้าวสาร',
			qty_needed: 900,
			unit: 'kg',
			urgency: 'critical',
			status: 'open'
		},
		{
			item_id: 'item:blanket',
			name: 'ผ้าห่ม',
			qty_needed: 800,
			unit: 'piece',
			urgency: 'important',
			status: 'open'
		},
		{
			item_id: 'item:soap',
			name: 'สบู่ก้อน',
			qty_needed: 700,
			unit: 'bar',
			urgency: 'normal',
			status: 'open'
		}
	];

	test.beforeEach(async ({ page }) => {
		await page.route('**/api/public/v1/needs', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify([{ code: 'SH009', name: SHELTER, needs: NEEDS }])
			});
		});
		await page.goto('/donations');
		await page.getByRole('button', { name: 'ดูรายละเอียดและบริจาค' }).first().click();
	});

	test('badges follow the stored level, so a large shortage is not critical by itself', async ({
		page
	}) => {
		// 700–900 short on every line: under the old quantity rule all three read วิกฤต.
		await expect(page.getByText('วิกฤต (Critical)')).toHaveCount(1);
		await expect(page.getByText('สำคัญ (High)')).toHaveCount(1);
		await expect(page.getByText('ปกติ (Normal)')).toHaveCount(1);
	});

	test("`important` from back-office reads as the board's high level", async ({ page }) => {
		// Back-office stores `important`; this page only ever matched `high`, so the
		// middle level silently fell through to the quantity guess.
		const blanket = page
			.locator('div')
			.filter({ hasText: /^ผ้าห่ม/ })
			.first();
		await expect(blanket).toBeVisible();
		await expect(page.getByText('สำคัญ (High)')).toBeVisible();
	});
});

/**
 * The "ปกติ" chip used to return every open need — same result as "ทั้งหมด" — because
 * it filtered on `status` alone and never looked at the level.
 */
test.describe('Urgency filter chips', () => {
	test.beforeEach(async ({ page }) => {
		await page.route('**/api/public/v1/needs', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify([
					{
						code: 'SH010',
						name: 'ศูนย์กรองความเร่งด่วน',
						needs: [
							{
								item_id: 'item:rice',
								name: 'ข้าวสาร',
								qty_needed: 900,
								unit: 'kg',
								urgency: 'critical',
								status: 'open'
							},
							{
								item_id: 'item:soap',
								name: 'สบู่ก้อน',
								qty_needed: 700,
								unit: 'bar',
								urgency: 'normal',
								status: 'open'
							}
						]
					}
				])
			});
		});
		await page.goto('/donations');
	});

	test('each chip narrows to its own level', async ({ page }) => {
		const shelterCard = page.getByText('ศูนย์กรองความเร่งด่วน');

		// Both levels present with no filter.
		await expect(shelterCard).toBeVisible();

		// "ปกติ" must not behave like "ทั้งหมด": the critical-only shelter drops out
		// when no need of that level remains.
		await page.getByRole('button', { name: 'วิกฤต', exact: true }).click();
		await expect(shelterCard).toBeVisible();

		await page.getByRole('button', { name: 'ปกติ', exact: true }).click();
		await expect(shelterCard).toBeVisible();

		// "สำคัญ" matches neither need, so the shelter has nothing left to show.
		await page.getByRole('button', { name: 'สำคัญ', exact: true }).click();
		await expect(shelterCard).toHaveCount(0);
	});
});
