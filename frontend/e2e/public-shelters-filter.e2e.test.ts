import { test, expect, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test.describe('Public Shelters Search & Filter Flow (Zero Seed Scripts)', () => {
	test.beforeEach(async ({ context }) => {
		test.setTimeout(90000);
		// ตั้งค่า Geolocation จำลองพิกัดบริเวณ อ.หาดใหญ่ จ.สงขลา ซึ่งตรงกับตำแหน่งศูนย์พักพิงในฐานข้อมูลจริง
		await context.grantPermissions(['geolocation']);
		await context.setGeolocation({
			latitude: 7.0086,
			longitude: 100.4968
		});
	});

	/**
	 * Helper เปิดหน้า /shelters และรอจนกว่า initial geolocation sync จะเสร็จสมบูรณ์
	 */
	async function openSheltersPage(page: Page) {
		await page.goto('/shelters');
		// รอจนกว่า Geolocation sync เริ่มต้นจะเพิ่ม distance=5 ใน URL
		await expect(page).toHaveURL(/distance=5/, { timeout: 15000 });
		await page.waitForTimeout(300);
	}

	test('1. โหลดหน้าศูนย์พักพิงและตรวจสอบองค์ประกอบหลักของระบบ (Page Load & Components Inspection)', async ({
		page
	}) => {
		await openSheltersPage(page);

		// ตรวจสอบ Title ของหน้า
		await expect(page).toHaveTitle(/ตรวจสอบสถานะศูนย์พักพิง|Smart Shelter|Shelters/i);

		// ตรวจสอบ Metric Cards ตัวเลขสรุป (ศูนย์พักพิงทั้งหมด, ศูนย์พักพิงที่เปิดใช้งาน)
		await expect(page.getByText('ศูนย์พักพิงทั้งหมด').first()).toBeVisible({ timeout: 10000 });
		await expect(page.getByText('ศูนย์พักพิงที่เปิดใช้งาน').first()).toBeVisible();

		// ตรวจสอบหัวข้อกล่องตัวกรองลอย (Filter Panel)
		const filterTitle = page.getByRole('heading', { name: 'ค้นหาและตัวกรอง', exact: true });
		await expect(filterTitle).toBeVisible();

		// ตรวจสอบรายการศูนย์พักพิง (Shelter List) ทางขวา
		const shelterCards = page.locator('[id^="shelter-card-"], [data-shelter-code]');
		await expect(shelterCards.first()).toBeVisible({ timeout: 10000 });
		const initialCount = await shelterCards.count();
		expect(initialCount).toBeGreaterThan(0);
	});

	test('2. ทดสอบตัวกรองค้นหาด้วยข้อความ (Text Search Input with Debounce)', async ({ page }) => {
		await openSheltersPage(page);

		const searchInput = page.getByRole('textbox', { name: /ค้นหา/i });
		await expect(searchInput).toBeVisible();

		// พิมพ์คำค้นหา เช่น "มหาวิทยาลัย"
		await searchInput.click();
		await searchInput.fill('มหาวิทยาลัย');

		// รอ debounce 300ms ให้ระบบ sync URL
		await expect(page).toHaveURL(/q=/, { timeout: 5000 });

		// ตรวจสอบว่าผลการค้นหาเหลือเฉพาะศูนย์ที่มีคำว่า "มหาวิทยาลัย"
		const filteredCard = page.locator('[id^="shelter-card-"], [data-shelter-code]');
		await expect(filteredCard.first()).toContainText('มหาวิทยาลัย');

		// ล้างคำค้นหา
		await searchInput.fill('');
		await page.waitForTimeout(500);

		// ตรวจสอบว่ารายการศูนย์กลับมาแสดงตามปกติ
		const restoredCount = await page.locator('[id^="shelter-card-"], [data-shelter-code]').count();
		expect(restoredCount).toBeGreaterThanOrEqual(2);
	});

	test('3. ทดสอบตัวกรองตำแหน่งที่ตั้งแบบเชื่อมโยง (Cascading Location: จังหวัด → อำเภอ → ตำบล)', async ({
		page
	}) => {
		await openSheltersPage(page);

		// 3.1 เลือกจังหวัด "สงขลา"
		const provinceTrigger = page.locator('button#province, button[data-name="province"]').first();
		await expect(provinceTrigger).toBeVisible();
		// รอจนกว่าข้อมูลพิกัด/จังหวัดจะโหลดเสร็จสมบูรณ์จนปุ่มพร้อมใช้งาน
		await expect(provinceTrigger).toBeEnabled({ timeout: 15000 });
		await provinceTrigger.click();

		const popover1 = page.locator('[data-slot="popover-content"]:visible');
		await expect(popover1).toBeVisible({ timeout: 5000 });

		const searchBox1 = popover1.locator('input').first();
		await searchBox1.fill('สงขลา');
		await page.waitForTimeout(200);

		const songkhlaOption = popover1.getByRole('button', { name: 'สงขลา', exact: true }).first();
		await expect(songkhlaOption).toBeVisible({ timeout: 5000 });
		await songkhlaOption.click();
		await expect(page).toHaveURL(/province=/, { timeout: 5000 });

		// 3.2 เลือกอำเภอ "หาดใหญ่"
		const districtTrigger = page.locator('button#district, button[data-name="district"]').first();
		await expect(districtTrigger).toBeVisible();
		await expect(districtTrigger).toBeEnabled({ timeout: 15000 });
		await districtTrigger.click();

		const popover2 = page.locator('[data-slot="popover-content"]:visible');
		await expect(popover2).toBeVisible({ timeout: 5000 });

		const searchBox2 = popover2.locator('input').first();
		await searchBox2.fill('หาดใหญ่');
		await page.waitForTimeout(200);

		const hatYaiOption = popover2.getByRole('button', { name: 'หาดใหญ่', exact: true }).first();
		await expect(hatYaiOption).toBeVisible({ timeout: 5000 });
		await hatYaiOption.click();
		await expect(page).toHaveURL(/district=/, { timeout: 5000 });

		// 3.3 เลือกตำบล "คอหงส์"
		const subdistrictTrigger = page
			.locator('button#subdistrict, button[data-name="subdistrict"]')
			.first();
		await expect(subdistrictTrigger).toBeVisible();
		await expect(subdistrictTrigger).toBeEnabled({ timeout: 15000 });
		await subdistrictTrigger.click();

		const popover3 = page.locator('[data-slot="popover-content"]:visible');
		await expect(popover3).toBeVisible({ timeout: 5000 });

		const searchBox3 = popover3.locator('input').first();
		await searchBox3.fill('คอหงส์');
		await page.waitForTimeout(200);

		const khoHongOption = popover3.getByRole('button', { name: 'คอหงส์', exact: true }).first();
		await expect(khoHongOption).toBeVisible({ timeout: 5000 });
		await khoHongOption.click();
		await expect(page).toHaveURL(/subdistrict=/, { timeout: 5000 });

		// ตรวจสอบว่าศูนย์ที่แสดงอยู่ในตำบลคอหงส์
		const khoHongCards = page.locator('[id^="shelter-card-"], [data-shelter-code]');
		await expect(khoHongCards.first()).toBeVisible({ timeout: 10000 });
		await expect(khoHongCards.first()).toContainText('คอหงส์');
	});

	test('4. ทดสอบตัวกรองชนิดสถานที่ (Site Kind: บ้านพักโฮสต์ vs ศูนย์อพยพ)', async ({ page }) => {
		await openSheltersPage(page);

		const siteKindTrigger = page
			.locator('button#site_kind, button[name="site_kind"]')
			.or(page.getByRole('button', { name: /ชนิดสถานที่/i }))
			.first();
		await expect(siteKindTrigger).toBeVisible();

		// 4.1 เลือก "บ้านพักโฮสต์"
		await siteKindTrigger.scrollIntoViewIfNeeded();
		await siteKindTrigger.click();

		const hostHouseOption = page
			.locator('[data-slot="select-item"]')
			.filter({ hasText: /บ้านพี่เลี้ยง|บ้านพักโฮสต์|Host House/i })
			.or(page.getByRole('option', { name: /บ้านพี่เลี้ยง|บ้านพักโฮสต์|Host House/i }))
			.first();

		// ถ้า dropdown ยังไม่เปิดเนื่องจาก slowMo ให้คลิกซ้ำ
		if (!(await hostHouseOption.isVisible().catch(() => false))) {
			await siteKindTrigger.click();
		}
		await expect(hostHouseOption).toBeVisible({ timeout: 5000 });
		await hostHouseOption.click();
		await expect(page).toHaveURL(/site_kind=host_house/, { timeout: 5000 });

		// ตรวจสอบว่ามีศูนย์พักพิงที่แสดง และมีคำว่า บ้านพี่เลี้ยง หรือ บ้านพักโฮสต์
		const hostHouseCards = page.locator('[id^="shelter-card-"], [data-shelter-code]');
		await expect(hostHouseCards.first()).toBeVisible({ timeout: 10000 });
		await expect(hostHouseCards.first()).toContainText(/บ้านพี่เลี้ยง|โฮสต์|Host/i);

		// 4.2 สลับเลือก "ศูนย์อพยพ"
		await siteKindTrigger.scrollIntoViewIfNeeded();
		await siteKindTrigger.click();

		const evacCenterOption = page
			.locator('[data-slot="select-item"]')
			.filter({ hasText: /ศูนย์อพยพ|ศูนย์พักพิงหลัก|Evacuation Center/i })
			.or(
				page.getByRole('option', {
					name: /ศูนย์อพยพ|ศูนย์พักพิงหลัก|Evacuation Center/i
				})
			)
			.first();

		if (!(await evacCenterOption.isVisible().catch(() => false))) {
			await siteKindTrigger.click();
		}
		await expect(evacCenterOption).toBeVisible({ timeout: 5000 });
		await evacCenterOption.click();
		await expect(page).toHaveURL(/site_kind=evacuation_center/, { timeout: 5000 });

		// ตรวจสอบว่ารายการอัปเดตเป็นศูนย์อพยพ
		const evacCards = page.locator('[id^="shelter-card-"], [data-shelter-code]');
		await expect(evacCards.first()).toBeVisible({ timeout: 10000 });
		await expect(evacCards.first()).toContainText(/ศูนย์อพยพ/i);
	});

	test('5. ทดสอบตัวกรองประเภทศูนย์พักพิง / ประเภทอาคาร (Building Type Dropdown)', async ({
		page
	}) => {
		await openSheltersPage(page);

		const typeTrigger = page
			.locator('button#type, button[name="type"]')
			.or(page.getByRole('button', { name: /ประเภทศูนย์พักพิง|ประเภทอาคาร/i }))
			.first();
		await expect(typeTrigger).toBeVisible();

		// เปิด dropdown เพื่อดูตัวเลือก
		await typeTrigger.scrollIntoViewIfNeeded();
		await typeTrigger.click();

		const options = page.locator('[data-slot="select-item"]').or(page.getByRole('option'));
		if (
			!(await options
				.first()
				.isVisible()
				.catch(() => false))
		) {
			await typeTrigger.click();
		}
		const count = await options.count();
		expect(count).toBeGreaterThan(0);

		// ถ้ามีประเภทให้เลือกมากกว่า 1 ตัวเลือก ลองเลือกตัวเลือกที่ 2
		if (count > 1) {
			const secondOption = options.nth(1);
			await secondOption.click();
			await expect(page).toHaveURL(/type=/, { timeout: 5000 });
		} else {
			await page.keyboard.press('Escape');
		}
	});

	test('6. ทดสอบตัวกรองระยะทางและรัศมี (Distance Presets & Custom Km)', async ({ page }) => {
		await openSheltersPage(page);

		// 6.1 ทดสอบคลิกปุ่ม Presets 1 กม.
		const preset1km = page.getByRole('button', { name: '1 กม.' }).first();
		await expect(preset1km).toBeVisible();
		await preset1km.scrollIntoViewIfNeeded();
		await preset1km.click();
		await expect(page).toHaveURL(/distance=1/, { timeout: 5000 });

		// 6.2 ทดสอบคลิกปุ่ม Presets 10 กม.
		const preset10km = page.getByRole('button', { name: '10 กม.' }).first();
		await expect(preset10km).toBeVisible();
		await preset10km.scrollIntoViewIfNeeded();
		await preset10km.click();
		await expect(page).toHaveURL(/distance=10/, { timeout: 5000 });

		// 6.3 ทดสอบกรอกระยะทางแบบกำหนดเอง (Custom distance)
		const customInput = page
			.getByRole('textbox', { name: /กำหนดเอง/i })
			.or(page.locator('input[inputmode="decimal"]'));
		await expect(customInput).toBeVisible();
		await customInput.scrollIntoViewIfNeeded();
		await customInput.click();
		await customInput.fill('4');
		await customInput.press('Enter');
		await customInput.blur();
		await expect(page).toHaveURL(/distance=4/, { timeout: 5000 });
	});

	test('7. ทดสอบสวิตช์ซ่อนศูนย์ที่เต็มแล้ว (Hide Full Shelters Switch)', async ({ page }) => {
		await openSheltersPage(page);

		// ค้นหาสวิตช์
		const switchBtn = page.getByRole('switch').first();
		await expect(switchBtn).toBeVisible();
		await switchBtn.scrollIntoViewIfNeeded();

		// คลิกเพื่อเปิดสวิตช์ซ่อนศูนย์ที่เต็มแล้ว
		await switchBtn.click();
		await expect(page).toHaveURL(/hide_full=true/, { timeout: 5000 });
		await expect(switchBtn).toHaveAttribute('aria-checked', 'true');

		// คลิกอีกครั้งเพื่อปิดสวิตช์
		await switchBtn.scrollIntoViewIfNeeded();
		await switchBtn.click();
		await expect(switchBtn).toHaveAttribute('aria-checked', 'false');
		await expect(page).not.toHaveURL(/hide_full=true/);
	});

	test('8. ทดสอบตัวกรองเพิ่มเติม / สิ่งอำนวยความสะดวก (Advanced Filters Accordion & Checkboxes)', async ({
		page
	}) => {
		await openSheltersPage(page);

		// เปิด Accordion ตัวกรองขั้นสูง
		const accordionTrigger = page.getByRole('button', {
			name: /ตัวกรองขั้นสูง|Advanced Filters/i
		});
		await expect(accordionTrigger).toBeVisible();
		await accordionTrigger.scrollIntoViewIfNeeded();
		await accordionTrigger.click();

		// ตรวจสอบเช็คบ็อกซ์กลุ่มเปราะบาง
		const vulBedLabel = page
			.locator('label')
			.filter({ hasText: /ผู้ป่วยติดเตียง/i })
			.first();
		await expect(vulBedLabel).toBeVisible();
		await vulBedLabel.scrollIntoViewIfNeeded();
		await vulBedLabel.click();

		// ตรวจสอบเช็คบ็อกซ์สัตว์เลี้ยง
		const petLabel = page
			.locator('label')
			.filter({ hasText: /สัตว์เลี้ยง/i })
			.first();
		if (await petLabel.isVisible()) {
			await petLabel.scrollIntoViewIfNeeded();
			await petLabel.click();
		}

		// ตรวจสอบเช็คบ็อกซ์สิ่งอำนวยความสะดวก
		const wifiLabel = page
			.locator('label')
			.filter({ hasText: /wifi|อินเทอร์เน็ต/i })
			.first();
		if (await wifiLabel.isVisible()) {
			await wifiLabel.scrollIntoViewIfNeeded();
			await wifiLabel.click();
		}

		await page.waitForTimeout(300);
	});

	test('9. ทดสอบการล้างตัวกรองทั้งหมด (Clear All Filters Button)', async ({ page }) => {
		// เข้าหน้าพร้อม query parameters หลายตัว
		await page.goto(
			'/shelters?q=' + encodeURIComponent('มหาวิทยาลัย') + '&site_kind=host_house&distance=1'
		);
		await page.waitForLoadState('networkidle');

		// ค้นหาปุ่ม/ลิงก์ "ล้างค่า"
		const clearButton = page.getByRole('link', { name: /ล้างค่า|ล้างตัวกรอง/i });
		await expect(clearButton).toBeVisible();
		await clearButton.scrollIntoViewIfNeeded();

		// คลิกปุ่มล้างตัวกรอง
		await clearButton.click();
		await expect(page).not.toHaveURL(/site_kind=host_house/);

		// ตรวจสอบว่าช่องค้นหากลับมาว่างเปล่า
		const searchInput = page.getByRole('textbox', { name: /ค้นหา/i });
		await expect(searchInput).toHaveValue('');

		// ตรวจสอบว่ารายการศูนย์กลับมาแสดงครบถ้วน
		const restoredCards = page.locator('[id^="shelter-card-"], [data-shelter-code]');
		await expect(restoredCards.first()).toBeVisible({ timeout: 10000 });
		const restoredCount = await restoredCards.count();
		expect(restoredCount).toBeGreaterThanOrEqual(2);
	});

	test('10. ทดสอบการคลิกเลือกการ์ดศูนย์พักพิงในรายการ (Card Selection & Details Interaction)', async ({
		page
	}) => {
		await openSheltersPage(page);

		const firstCard = page.locator('[id^="shelter-card-"], [data-shelter-code]').first();
		await expect(firstCard).toBeVisible();

		// คลิกที่การ์ดเพื่อเลือก (Selection)
		await firstCard.click();
		await page.waitForTimeout(400);

		// ตรวจสอบว่าการ์ดที่ถูกเลือกยังแสดงผลตามปกติ
		await expect(firstCard).toBeVisible();
	});
});
