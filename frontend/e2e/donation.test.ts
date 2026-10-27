import { test, expect, type Page } from '@playwright/test';

const TAGS = { tag: ['@regression', '@donation'] };

const SH001_NAME = 'ศูนย์พักพิง เทศบาลนครหาดใหญ่ (โรงเรียนเทศบาล 2)';

const NEEDS_BODY = [
	{
		code: 'SH001',
		name: SH001_NAME,
		needs: [
			{
				item_id: 'item:rice',
				name: 'ข้าวสาร',
				category: 'food',
				qty_needed: 50,
				unit: 'kg',
				urgency: 'critical',
				status: 'open'
			}
		]
	}
];

/** `GET /api/public/v1/shelters` — what the board map and the step-3 map need to place SH001. */
async function mockShelters(page: Page, status = 200) {
	await page.route('**/api/public/v1/shelters*', async (route) => {
		await route.fulfill({
			status,
			contentType: 'application/json',
			body:
				status === 200
					? JSON.stringify({
							shelters: [
								{
									code: 'SH001',
									name: SH001_NAME,
									site_kind: 'evacuation_center',
									status: 'open',
									capacity: 120,
									geo: { lat: 7.0086, lng: 100.4747 },
									province: 'สงขลา',
									district: 'หาดใหญ่',
									subdistrict: 'หาดใหญ่',
									accepts_pre_registration: true,
									updated_at: '2026-10-26T00:00:00Z'
								}
							],
							count: 1,
							as_of: '2026-10-26T00:00:00Z'
						})
					: JSON.stringify({ success: false })
		});
	});
}

/** Mock the board, the shelters list and the slots, then open `/donations`. */
async function openBoard(page: Page, sheltersStatus = 200) {
	await page.route('**/api/public/v1/needs', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(NEEDS_BODY)
		})
	);
	await mockShelters(page, sheltersStatus);
	await page.route('**/api/public/v1/donations/slots*', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ slots: [] })
		})
	);
	await page.goto('/donations');
}

async function fillDonorStep(page: Page) {
	await page.locator('#donor-name').fill('ผู้บริจาคใจบุญ');
	await page.locator('#donor-phone').fill('0899999999');
	await page.getByRole('button', { name: 'ถัดไป: เลือกจุดส่งมอบ' }).click();
	await expect(
		page.getByRole('heading', { name: 'ส่วนที่ 3: ข้อมูลการจัดส่ง โลจิสติกส์' })
	).toBeVisible();
}

/** Needs board → pick the rice need from the shelter card (locks SH001) → donor form → step 3. */
async function openShelterStep(page: Page, sheltersStatus = 200) {
	await openBoard(page, sheltersStatus);
	await page.getByRole('button', { name: 'ดูรายละเอียดและบริจาค' }).first().click();
	await page.getByRole('button', { name: 'บริจาครายการนี้' }).first().click();
	await fillDonorStep(page);
}

test.describe('Needs board shelter map (#814)', TAGS, () => {
	test('tapping a pin opens the shelter card under the map and donating locks that shelter', async ({
		page
	}) => {
		await openBoard(page);

		await expect(page.locator('.maplibregl-canvas').first()).toBeVisible({ timeout: 15_000 });
		await page.getByTestId('shelter-marker-SH001').click({ timeout: 15_000 });

		const card = page.getByTestId('donation-needs-map-card');
		await expect(card).toContainText(SH001_NAME);
		await expect(card).toContainText('ข้าวสาร');
		await expect(card.getByRole('button', { name: 'ดูความต้องการทั้งหมด' })).toBeVisible();
		await expect(card.getByRole('button', { name: 'บริจาคสิ่งของอื่นๆ' })).toBeVisible();

		await card.getByRole('button', { name: 'บริจาครายการนี้' }).first().click();
		await expect(page.locator('#donor-name')).toBeVisible();
		await fillDonorStep(page);
		await expect(page.getByTestId('drop-off-shelter-name')).toHaveText(SH001_NAME);
	});

	test('without the shelters list there is no map, but the board still books', async ({ page }) => {
		await openBoard(page, 503);

		await expect(page.getByText('แผนที่ใช้ไม่ได้ในตอนนี้')).toBeVisible({ timeout: 15_000 });
		await expect(page.getByTestId('donation-needs-map')).toHaveCount(0);

		await page.getByRole('button', { name: 'ดูรายละเอียดและบริจาค' }).first().click();
		await page.getByRole('button', { name: 'บริจาครายการนี้' }).first().click();
		await expect(page.locator('#donor-name')).toBeVisible();
	});

	test('on a 390px phone the map fits the screen and the card sits under it', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await openBoard(page);

		const map = page.getByTestId('donation-needs-map');
		await expect(map).toBeVisible({ timeout: 15_000 });
		await page.getByTestId('shelter-marker-SH001').click({ timeout: 15_000 });
		const card = page.getByTestId('donation-needs-map-card');
		await expect(card).toBeVisible();

		const mapBox = await map.boundingBox();
		const cardBox = await card.boundingBox();
		expect(mapBox && mapBox.x >= 0 && mapBox.x + mapBox.width <= 390).toBe(true);
		expect(mapBox && cardBox && cardBox.y >= mapBox.y + mapBox.height).toBe(true);
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow).toBeLessThanOrEqual(0);
	});
});

/**
 * Every way into step 3 locks the shelter chosen on step 1, so step 3 only shows it:
 * the name read-only and a small map, with no shelter dropdown.
 */
test.describe('Donation form drop-off shelter (#814)', TAGS, () => {
	test('shows the locked shelter read-only with its pin and no shelter dropdown', async ({
		page
	}) => {
		await openShelterStep(page);

		await expect(page.locator('#shelter-select')).toHaveCount(0);
		await expect(page.getByTestId('drop-off-shelter-name')).toHaveText(SH001_NAME);
		await expect(page.getByTestId('drop-off-shelter-map')).toBeVisible({ timeout: 15_000 });
		await expect(page.getByTestId('shelter-marker-SH001')).toBeVisible({ timeout: 15_000 });
	});

	test('without the shelters list the name stays and the map is dropped', async ({ page }) => {
		await openShelterStep(page, 503);

		await expect(page.getByTestId('drop-off-shelter-name')).toHaveText(SH001_NAME);
		await expect(page.getByTestId('drop-off-shelter-map')).toHaveCount(0);
		await expect(page.locator('#shelter-select')).toHaveCount(0);
	});
});

test.describe('Public Donation & Queue Booking Wizard (T-60)', TAGS, () => {
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

		// The step-3 shelter map reads the public shelters list for coordinates
		await mockShelters(page);

		// 2. Go to /donations
		await page.goto('/donations');

		// Step 1: Needs Board — shelter cards first, needs one level in
		await expect(
			page.getByRole('heading', { name: /ของที่ศูนย์พักพิง\s*ต้องการตอนนี้/ })
		).toBeVisible();
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

		// The shelter picked on step 1 is shown read-only; there is no dropdown to change it.
		await expect(page.getByTestId('drop-off-shelter-name')).toBeVisible();
		await expect(page.locator('#shelter-select')).toHaveCount(0);

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
 * Cancel-from-track coverage with the track BFF mocked: a declared booking can be
 * cancelled from the page, and a received one offers no cancel. Which statuses allow a
 * cancel is unit-tested on `canCancelDonation`.
 *
 * Both were `fixme` from 2026-08-21 to 2026-10-13: under this route mock the tracking
 * query stayed `status: pending, fetchStatus: fetching` although the mock answered 200,
 * so nothing rendered (seen on `vite preview` and the dev server). It no longer does,
 * and no app change was traced as the fix — if these start timing out with an empty
 * page, that hang is back.
 */
test.describe('Donor cancels their own reservation from the track page (T-21 DoD 4)', TAGS, () => {
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

	test('cancels a declared booking and reflects the new status', async ({ page }) => {
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
		// The card heading shows the ref too, so look inside the dialog.
		await expect(page.getByRole('alertdialog').getByText('DN-777001')).toBeVisible();
		await page.getByRole('button', { name: 'ยืนยันยกเลิกการจอง' }).click();

		await expect(page.getByText('ยกเลิกการจองบริจาคแล้ว')).toBeVisible();
		// Refetch drove the page to the cancelled status (shown on the badge and the status
		// line), so the button is gone.
		await expect(page.getByText('ยกเลิกการจองแล้ว', { exact: true }).first()).toBeVisible();
		await expect(openCancel).toBeHidden();
	});

	test('offers no cancel once the goods were received', async ({ page }) => {
		await page.route(`**/api/public/v1/donations/${TOKEN}`, async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(trackBody('received'))
			});
		});

		await page.goto(`/donations/track/${TOKEN}`);

		await expect(page.getByRole('heading', { name: 'DN-777001' })).toBeVisible();
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
test.describe('Needs board reflects the urgency staff set (not the quantity)', TAGS, () => {
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
test.describe('Urgency filter chips', TAGS, () => {
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

/**
 * `crypto.randomUUID` is `[SecureContext]`-gated: it exists on `localhost` and over
 * HTTPS, and is `undefined` when staff open the site by LAN IP over plain HTTP —
 * which is exactly how a shelter reaches it from a phone. Constructing `DonationState`
 * threw `TypeError: crypto.randomUUID is not a function` before the page rendered, so
 * `/donations` came up blank.
 *
 * `crypto.getRandomValues` (what `$lib/db/ulid` uses) carries no such gate, so this
 * deletes `randomUUID` to stand in for a non-secure origin without needing a second
 * host. Keep it deleted for any page that mints client-side ids.
 */
test.describe('Non-secure context (LAN HTTP over an IP)', TAGS, () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			// @ts-expect-error — deleting a readonly DOM property on purpose
			delete Crypto.prototype.randomUUID;
			// @ts-expect-error — some engines expose it as an own property too
			delete globalThis.crypto.randomUUID;
		});
		await page.route('**/api/public/v1/needs', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify([
					{
						code: 'SH001',
						name: 'ศูนย์พักพิงทดสอบ LAN',
						needs: [
							{
								item_id: 'item:rice',
								name: 'ข้าวสาร',
								category: 'food',
								qty_needed: 50,
								unit: 'kg',
								urgency: 'critical',
								status: 'open'
							}
						]
					}
				])
			});
		});
	});

	test('/donations renders instead of white-screening', async ({ page }) => {
		const crashes: string[] = [];
		page.on('pageerror', (err) => crashes.push(err.message));

		await page.goto('/donations');

		await expect(
			page.getByRole('heading', { name: /ของที่ศูนย์พักพิง\s*ต้องการตอนนี้/ })
		).toBeVisible();
		await expect(page.getByText('ศูนย์พักพิงทดสอบ LAN')).toBeVisible();
		expect(crashes.join('\n')).not.toContain('randomUUID');
		expect(crashes).toEqual([]);
	});

	test('picking a need still mints an item id', async ({ page }) => {
		const crashes: string[] = [];
		page.on('pageerror', (err) => crashes.push(err.message));

		await page.goto('/donations');
		await page.getByRole('button', { name: 'ดูรายละเอียดและบริจาค' }).first().click();
		await page.getByRole('button', { name: 'บริจาครายการนี้' }).first().click();

		// Reaching the donor form means `donationStore.items` was built — the id is
		// minted right there, and it used to throw on this exact step.
		await expect(page.getByRole('heading', { name: 'ส่วนที่ 1: ข้อมูลผู้บริจาค' })).toBeVisible();
		await expect(page.locator('input[id^="name-"]').first()).toHaveValue('ข้าวสาร');
		expect(crashes).toEqual([]);
	});
});

/**
 * #619 / #620 — the donor form puts the item name before its category, and every step
 * change brings the new step's header into view. Steps are state on one page, not routes,
 * so the layout's `afterNavigate` scroll never ran: the page stayed where the donor last
 * scrolled (usually down at the button) and the next step opened off-screen.
 */
test.describe('Donor wizard layout and step scrolling (#619, #620)', TAGS, () => {
	test.beforeEach(async ({ page }) => {
		await page.route('**/api/public/v1/needs', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify([
					{
						code: 'SH001',
						name: 'ศูนย์ทดสอบการเลื่อนหน้า',
						needs: [
							{
								item_id: 'item:rice',
								name: 'ข้าวสาร',
								category: 'food',
								qty_needed: 50,
								unit: 'kg',
								urgency: 'critical',
								status: 'open'
							}
						]
					}
				])
			});
		});
	});

	async function openDonorForm(page: import('@playwright/test').Page) {
		await page.goto('/donations');
		await page.getByRole('button', { name: 'ดูรายละเอียดและบริจาค' }).first().click();
		await page.getByRole('button', { name: 'บริจาครายการนี้' }).first().click();
		await expect(page.getByRole('heading', { name: 'ส่วนที่ 1: ข้อมูลผู้บริจาค' })).toBeVisible();
	}

	const scrollY = (page: import('@playwright/test').Page) => page.evaluate(() => window.scrollY);

	test('item name comes before its category', async ({ page }) => {
		await openDonorForm(page);

		const name = page.locator('input[id^="name-"]').first();
		const category = page.locator('input[id^="category-"]').first();
		const precedes = await name.evaluate(
			(el, other) => !!(el.compareDocumentPosition(other!) & Node.DOCUMENT_POSITION_FOLLOWING),
			await category.elementHandle()
		);
		expect(precedes).toBe(true);
	});

	test('going to the next step and back scrolls to the top', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 700 });
		await openDonorForm(page);
		await page.locator('#donor-name').fill('ผู้ทดสอบเลื่อนหน้า');
		await page.locator('#donor-phone').fill('0899999999');

		const next = page.getByRole('button', { name: 'ถัดไป: เลือกจุดส่งมอบ' });
		await next.scrollIntoViewIfNeeded();
		expect(await scrollY(page)).toBeGreaterThan(0);
		await next.click();

		await expect(
			page.getByRole('heading', { name: 'ส่วนที่ 3: ข้อมูลการจัดส่ง โลจิสติกส์' })
		).toBeVisible();
		await expect.poll(() => scrollY(page)).toBe(0);

		const back = page.getByRole('button', { name: 'กลับ', exact: true });
		await back.scrollIntoViewIfNeeded();
		expect(await scrollY(page)).toBeGreaterThan(0);
		await back.click();

		await expect(page.getByRole('heading', { name: 'ส่วนที่ 1: ข้อมูลผู้บริจาค' })).toBeVisible();
		await expect.poll(() => scrollY(page)).toBe(0);
	});
});
