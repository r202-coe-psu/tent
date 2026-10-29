import { test, expect, type Page } from '@playwright/test';

const TAGS = { tag: ['@regression', '@donation'] };

/** Public shelter detail as the BFF returns it for GET /api/public/v1/shelters/{code}. */
const SHELTER_DETAIL = {
	id: 'SH001',
	name: 'ศูนย์พักพิง เทศบาลนครหาดใหญ่ (โรงเรียนเทศบาล 2)',
	address: '99 ถ.เพชรเกษม ต.หาดใหญ่ อ.หาดใหญ่ จ.สงขลา',
	geo: { lat: 7.0086, lng: 100.4747 }
};
const DIRECTIONS_HREF = 'https://www.google.com/maps/dir/?api=1&destination=7.0086,100.4747';

test.describe('Public Donation & Queue Booking Wizard (T-60)', TAGS, () => {
	test('successfully performs the entire 4-step wizard donation flow', async ({ page }) => {
		await page.route('**/api/public/v1/shelters/SH001', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ shelter: SHELTER_DETAIL })
			})
		);

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

		// Item details: name and unit are pre-filled from the need card
		// Keyed on the field's own id (`name-{item.id}`), not its placeholder copy —
		// the placeholder has been reworded twice and silently broke this assertion.
		const itemName = page.locator('input[id^="name-"]').first();
		await expect(itemName).toHaveValue('ข้าวสาร');

		// Category and unit are carried over from the catalog rather than asked for:
		// the category used to default to "food" for every booking (filing blankets as
		// food), and the unit is rendered from the canonical code (`kg` → "กิโลกรัม").
		await expect(page.getByRole('textbox', { name: 'หมวดหมู่' })).not.toHaveValue('');
		await expect(page.getByRole('textbox', { name: 'หน่วย' })).toHaveValue('กิโลกรัม');

		// The quantity starts at 0 for the donor to fill in; the shortfall is only a hint.
		const qty = page.locator('input[id^="amount-"]').first();
		await expect(qty).toHaveValue('0');
		await expect(page.getByTestId(/^need-shortage-/).first()).toContainText('ยังขาด 50');
		await qty.fill('12');

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
		await expect(page.getByText(SHELTER_DETAIL.address)).toBeVisible();
		// The map button is a real link to the shelter, not a toast.
		const navigate = page.getByRole('link', { name: 'นำทางด้วย Google Maps' });
		await expect(navigate).toHaveAttribute('href', DIRECTIONS_HREF);
		await expect(navigate).toHaveAttribute('target', '_blank');

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
		await page.locator('input[id^="amount-"]').first().fill('1');

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

/** #590: the track page tells the donor which shelter to go to and how to get there. */
test.describe('Track page shows the drop-off shelter and directions (#590)', TAGS, () => {
	const TOKEN = 'TX-SH001-DROPOFF';

	function mockTrack(page: Page, deliveryMethod: string, status = 'declared') {
		return page.route(`**/api/public/v1/donations/${TOKEN}`, (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					success: true,
					donation: {
						status,
						booking_ref: 'DN-590001',
						shelter_code: 'SH001',
						donor: { name: 'ผู้บริจาคใจบุญ', phone_masked: '***-***-5678' },
						items: [{ item_name: 'ข้าวสาร', qty: 5, unit: 'kg' }],
						logistics: { delivery_method: deliveryMethod },
						received_summary: null,
						updated_at: '2026-08-21T03:00:00Z',
						expires_at: '2026-08-24T03:00:00Z'
					}
				})
			})
		);
	}

	test('shows shelter name, address and a directions link to its coordinates', async ({ page }) => {
		await mockTrack(page, 'self_dropoff');
		await page.route('**/api/public/v1/shelters/SH001', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ shelter: SHELTER_DETAIL })
			})
		);

		await page.goto(`/donations/track/${TOKEN}`);

		const card = page.getByTestId('drop-off-card');
		await expect(card.getByText(SHELTER_DETAIL.name)).toBeVisible();
		await expect(card.getByText(SHELTER_DETAIL.address)).toBeVisible();
		const navigate = card.getByRole('link', { name: 'นำทางด้วย Google Maps' });
		await expect(navigate).toHaveAttribute('href', DIRECTIONS_HREF);
		await expect(navigate).toHaveAttribute('target', '_blank');
	});

	// `redirected` matters most: the donor now goes to another shelter, not this one.
	for (const status of ['cancelled', 'redirected']) {
		test(`keeps the shelter but drops directions once the booking is ${status}`, async ({
			page
		}) => {
			await mockTrack(page, 'self_dropoff', status);
			await page.route('**/api/public/v1/shelters/SH001', (route) =>
				route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ shelter: SHELTER_DETAIL })
				})
			);

			await page.goto(`/donations/track/${TOKEN}`);

			const card = page.getByTestId('drop-off-card');
			await expect(card.getByText(SHELTER_DETAIL.name)).toBeVisible();
			await expect(card.getByText(SHELTER_DETAIL.address)).toBeVisible();
			await expect(page.getByRole('link', { name: 'นำทางด้วย Google Maps' })).toHaveCount(0);
		});
	}

	test('keeps the shelter code and breaks nothing when the shelter lookup 404s', async ({
		page
	}) => {
		await mockTrack(page, 'parcel');
		await page.route('**/api/public/v1/shelters/SH001', (route) =>
			route.fulfill({
				status: 404,
				contentType: 'application/json',
				body: JSON.stringify({ error: 'Shelter not found' })
			})
		);

		await page.goto(`/donations/track/${TOKEN}`);

		await expect(page.getByRole('heading', { name: 'DN-590001' })).toBeVisible();
		await expect(page.getByText('SH001', { exact: true })).toBeVisible();
		await expect(page.getByTestId('drop-off-card')).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'นำทางด้วย Google Maps' })).toHaveCount(0);
	});

	test('does not look up a destination when the shelter collects the goods', async ({ page }) => {
		let shelterRequests = 0;
		await mockTrack(page, 'shelter_pickup');
		await page.route('**/api/public/v1/shelters/SH001', (route) => {
			shelterRequests += 1;
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ shelter: SHELTER_DETAIL })
			});
		});

		await page.goto(`/donations/track/${TOKEN}`);

		await expect(page.getByRole('heading', { name: 'DN-590001' })).toBeVisible();
		await expect(page.getByText('SH001', { exact: true })).toBeVisible();
		await expect(page.getByRole('link', { name: 'นำทางด้วย Google Maps' })).toHaveCount(0);
		expect(shelterRequests).toBe(0);
	});
});
