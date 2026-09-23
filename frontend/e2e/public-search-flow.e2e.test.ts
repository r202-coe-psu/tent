import { test, expect, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test.describe('Public Evacuee & Family Search Flow (Zero Seed Scripts)', () => {
	test.beforeEach(async () => {
		test.setTimeout(90000);
	});

	/**
	 * Helper เปิดหน้า /search และรอจนกว่า DOM จะพร้อมทำงาน
	 */
	async function openSearchPage(page: Page) {
		await page.goto('/search');
		await page.waitForLoadState('networkidle');
		// ตรวจสอบกล่องค้นหาว่าแสดงผลพร้อมใช้งาน
		const searchInput = page.getByRole('textbox').first();
		await expect(searchInput).toBeVisible({ timeout: 15000 });
		return searchInput;
	}

	test('1. โหลดหน้าระบบค้นหาและตรวจสอบองค์ประกอบเริ่มต้น (Initial State & Elements Inspection)', async ({
		page
	}) => {
		await openSearchPage(page);

		// 1.1 ตรวจสอบ Title ของหน้าเว็บ
		await expect(page).toHaveTitle(/ระบบค้นหาผู้พักพิงและครอบครัว|Smart Shelter|Family Search/i);

		// 1.2 ตรวจสอบหัวข้อกล่องค้นหาและคำอธิบาย
		const boxTitle = page.getByRole('heading', { name: /กรอกข้อมูลเพื่อค้นหา/i });
		await expect(boxTitle).toBeVisible();

		const boxDesc = page.getByText(
			/รองรับการค้นหาด้วย ชื่อ สกุล เบอร์โทรศัพท์ หรือ รหัสบัตรประชาชน/i
		);
		await expect(boxDesc).toBeVisible();

		// 1.3 ตรวจสอบช่อง Search Input และปุ่มค้นหา
		const searchInput = page.getByPlaceholder(/พิมพ์ชื่อ สกุล เบอร์โทรศัพท์ หรือ รหัสบัตรประชาชน/i);
		await expect(searchInput).toBeVisible();
		await expect(searchInput).toHaveValue('');

		const searchBtn = page.getByRole('button', { name: /ค้นหา/i }).first();
		await expect(searchBtn).toBeVisible();
		await expect(searchBtn).toBeEnabled();

		// 1.4 ตรวจสอบ Initial Empty State (ยังไม่ได้เริ่มค้นหา)
		const startTitle = page.getByRole('heading', { name: /เริ่มการค้นหา/i });
		await expect(startTitle).toBeVisible();

		const startDesc = page.getByText(
			/พิมพ์ชื่อ สกุล เบอร์โทรศัพท์ หรือ รหัสบัตรประชาชน เพื่อทำการสืบค้นข้อมูล/i
		);
		await expect(startDesc).toBeVisible();
	});

	test('2. ทดสอบการตรวจสอบความถูกต้องของข้อมูล (Validation Error: ตัวอักษรน้อยกว่า 3 ตัว)', async ({
		page
	}) => {
		const searchInput = await openSearchPage(page);
		const searchBtn = page.getByRole('button', { name: /ค้นหา/i }).first();

		// 2.1 ทดสอบใส่เพียง 2 ตัวอักษร แล้วกดปุ่มค้นหา
		await searchInput.fill('กข');
		await searchBtn.click();

		// ตรวจสอบข้อความแจ้งเตือนสีแดง
		const errorMsg = page.getByText(/กรุณากรอกข้อมูลอย่างน้อย 3 ตัวอักษร/i);
		await expect(errorMsg).toBeVisible({ timeout: 5000 });

		// 2.2 ทดสอบใส่ตัวเลข 2 ตัว แล้วกด Enter
		await searchInput.fill('12');
		await searchInput.press('Enter');
		await expect(errorMsg).toBeVisible();

		// ตรวจสอบว่าไม่มีผลการค้นหาแสดงขึ้นมา
		await expect(page.getByText(/พบข้อมูลทั้งหมด/i)).toHaveCount(0);
	});

	test('3. ทดสอบการค้นหาด้วยชื่อเต็ม (Full Name Search & Result Card Verification)', async ({
		page
	}) => {
		const searchInput = await openSearchPage(page);
		const searchBtn = page.getByRole('button', { name: /ค้นหา/i }).first();

		// 3.1 กรอกชื่อผู้พักพิงจริงในระบบ เช่น "ขวัญตา"
		await searchInput.fill('ขวัญตา');
		await searchBtn.click();

		// 3.2 ตรวจสอบกล่องสรุปจำนวนผลลัพธ์
		const countBadge = page.locator('div').filter({ hasText: 'พบข้อมูลทั้งหมด' }).first();
		await expect(countBadge).toBeVisible({ timeout: 15000 });

		// 3.3 ตรวจสอบการ์ดผลลัพธ์
		const targetCard = page
			.locator('div.rounded-2xl.border.bg-card.shadow-sm')
			.filter({
				has: page.locator('h3').filter({ hasText: /ขวัญตา/i })
			})
			.first();
		await expect(targetCard).toBeVisible({ timeout: 10000 });

		// ตรวจสอบ Badge สถานะครอบครัว (มากับครอบครัว หรือ มาเดี่ยว)
		const familyBadge = targetCard.locator('span').filter({ hasText: /มากับครอบครัว|มาเดี่ยว/i });
		await expect(familyBadge).toBeVisible();

		// ตรวจสอบรายละเอียดศูนย์พักพิงและเวลาลงทะเบียน
		await expect(targetCard.getByText(/อาศัยอยู่ที่ศูนย์พักพิง/i)).toBeVisible();
		await expect(targetCard.getByText(/โซน/i)).toBeVisible();
		await expect(targetCard.getByText(/เวลาลงทะเบียนเข้าพัก/i)).toBeVisible();
	});

	test('4. ทดสอบการเปิด/ปิดดูข้อมูลครอบครัว (Expand & Collapse Family Members Accordion)', async ({
		page
	}) => {
		const searchInput = await openSearchPage(page);
		await searchInput.fill('ขวัญตา');
		await page.getByRole('button', { name: /ค้นหา/i }).first().click();

		// รอให้ผลการค้นหาแสดง
		await expect(page.getByText(/พบข้อมูลทั้งหมด/i)).toBeVisible({ timeout: 15000 });

		// หาการ์ดที่มีสมาชิกครอบครัว
		const familyDetails = page
			.locator('details')
			.filter({ hasText: /ข้อมูลสมาชิกในครอบครัว/i })
			.first();
		await expect(familyDetails).toBeVisible({ timeout: 10000 });

		// 4.1 ค่าเริ่มต้นต้อง open อยู่ตาม UX Design
		await expect(familyDetails).toHaveAttribute('open', '');
		await expect(familyDetails.locator('span').filter({ hasText: /ซ่อน/i })).toBeVisible();

		// 4.2 คลิกเพื่อพับเก็บ (Collapse)
		const summary = familyDetails.locator('summary');
		await summary.scrollIntoViewIfNeeded();
		await summary.click();

		// ตรวจสอบว่าเปลี่ยนเป็นปุ่ม "คลิกเพื่อดู"
		await expect(familyDetails.locator('span').filter({ hasText: /คลิกเพื่อดู/i })).toBeVisible();

		// 4.3 คลิกอีกครั้งเพื่อกางออก (Expand)
		await summary.click();
		await expect(familyDetails.locator('span').filter({ hasText: /ซ่อน/i })).toBeVisible();
	});

	test('5. ทดสอบการค้นหาด้วยคำนำหน้าชื่อ (Prefix 3-char Search) และการเปลี่ยนหน้า (Pagination)', async ({
		page
	}) => {
		const searchInput = await openSearchPage(page);

		// 5.1 ค้นหาด้วย Prefix 3 ตัวอักษร "ขวั" แล้วกด Enter
		await searchInput.fill('ขวั');
		await searchInput.press('Enter');

		// รอผลลัพธ์
		await expect(page.getByText(/พบข้อมูลทั้งหมด/i)).toBeVisible({ timeout: 15000 });

		// 5.2 ตรวจสอบแผง Pagination (ผลการค้นหา 8 รายการ หน้าละ 5 รายการ = 2 หน้า)
		const pageIndicator = page.getByText(/หน้า\s*1\s*จาก\s*2/i);
		await expect(pageIndicator).toBeVisible({ timeout: 5000 });

		const prevBtn = page.getByRole('button', { name: /ก่อนหน้า/i });
		const nextBtn = page.getByRole('button', { name: /ถัดไป/i });

		await expect(prevBtn).toBeDisabled();
		await expect(nextBtn).toBeEnabled();

		// 5.3 คลิกปุ่ม "ถัดไป" (Next Page)
		await nextBtn.scrollIntoViewIfNeeded();
		await nextBtn.click();

		// ตรวจสอบว่าหน้าเปลี่ยนเป็น "หน้า 2 จาก 2"
		const page2Indicator = page.getByText(/หน้า\s*2\s*จาก\s*2/i);
		await expect(page2Indicator).toBeVisible({ timeout: 5000 });
		await expect(nextBtn).toBeDisabled();
		await expect(prevBtn).toBeEnabled();

		// 5.4 คลิกปุ่ม "ก่อนหน้า" (Previous Page)
		await prevBtn.click();
		await expect(pageIndicator).toBeVisible({ timeout: 5000 });
		await expect(prevBtn).toBeDisabled();
		await expect(nextBtn).toBeEnabled();
	});

	test('6. ทดสอบการค้นหาด้วยเบอร์โทรศัพท์ (Phone Number Search)', async ({ page }) => {
		const searchInput = await openSearchPage(page);
		const searchBtn = page.getByRole('button', { name: /ค้นหา/i }).first();

		// 6.1 กรอกเบอร์โทรศัพท์จริง 10 หลักที่มีในระบบ "0842907556"
		await searchInput.fill('0842907556');
		await searchBtn.click();

		// 6.2 ตรวจสอบว่าพบข้อมูล 1 รายการ
		await expect(page.getByText(/พบข้อมูลทั้งหมด/i)).toBeVisible({ timeout: 15000 });
		await expect(page.getByText(/1\s*รายการ/i)).toBeVisible();

		// ตรวจสอบชื่อผู้อพยพที่ตรงกับเบอร์โทร "ปิติพงษ์"
		const resultHeading = page.getByRole('heading', { level: 3, name: /ปิติพงษ์/i });
		await expect(resultHeading).toBeVisible({ timeout: 10000 });

		const resultCard = page
			.locator('div.rounded-2xl.border.bg-card.shadow-sm')
			.filter({ has: resultHeading })
			.first();
		await expect(resultCard).toBeVisible();

		// ตรวจสอบว่านามสกุลถูก Mask ตามมาตรฐาน PDPA เช่น จิน****พล
		await expect(resultCard).toContainText(/\*\*\*\*/);
	});

	test('7. ทดสอบกรณีไม่พบข้อมูลในระบบ (Empty / No Results Found State)', async ({ page }) => {
		const searchInput = await openSearchPage(page);
		const searchBtn = page.getByRole('button', { name: /ค้นหา/i }).first();

		// 7.1 ค้นหาด้วยข้อความที่ไม่มีในระบบแน่นอน
		await searchInput.fill('ชื่อบุคคลที่ไม่มีในระบบแน่นอน999');
		await searchBtn.click();

		// 7.2 ตรวจสอบการแสดงผล No Results State
		const noResultsTitle = page.getByRole('heading', { name: /ไม่พบรายชื่อ/i });
		await expect(noResultsTitle).toBeVisible({ timeout: 15000 });

		const noResultsDesc = page.getByText(
			/ไม่พบข้อมูลที่ตรงกับการค้นหา กรุณาตรวจสอบความถูกต้องอีกครั้ง/i
		);
		await expect(noResultsDesc).toBeVisible();
	});

	test('8. ทดสอบการค้นหาผ่าน URL Query Parameter (/search?q=...)', async ({ page }) => {
		// 8.1 นำทางไปยัง URL พร้อมพารามิเตอร์ q
		const queryName = 'ขวัญตา';
		await page.goto('/search?q=' + encodeURIComponent(queryName));
		await page.waitForLoadState('networkidle');

		// 8.2 ตรวจสอบว่าช่องค้นหามีข้อความถูกใส่ไว้โดยอัตโนมัติ
		const searchInput = page.getByRole('textbox').first();
		await expect(searchInput).toBeVisible({ timeout: 15000 });
		await expect(searchInput).toHaveValue(queryName);

		// 8.3 ตรวจสอบว่าระบบรันการค้นหาทันทีโดยไม่ต้องกดปุ่ม (onMount search)
		await expect(page.getByText(/พบข้อมูลทั้งหมด/i)).toBeVisible({ timeout: 15000 });
		const targetCard = page.locator('div.rounded-2xl.border.bg-card.shadow-sm').filter({
			hasText: /ขวัญตา/i
		});
		await expect(targetCard.first()).toBeVisible();
	});

	test('9. ทดสอบการเคลียร์คำค้นหาและค้นหาคำใหม่อีกครั้ง (Clear & Re-search)', async ({ page }) => {
		const searchInput = await openSearchPage(page);

		// 9.1 ค้นหาครั้งแรกด้วย "ปิติพงษ์"
		await searchInput.fill('ปิติพงษ์');
		await searchInput.press('Enter');

		await expect(page.getByText(/พบข้อมูลทั้งหมด/i)).toBeVisible({ timeout: 15000 });
		await expect(
			page
				.locator('h3')
				.filter({ hasText: /ปิติพงษ์/i })
				.first()
		).toBeVisible();

		// 9.2 ล้างช่องค้นหา แล้วค้นหาคำใหม่ "สิริชัย"
		await searchInput.fill('');
		await searchInput.fill('สิริชัย');
		await page.getByRole('button', { name: /ค้นหา/i }).first().click();

		// 9.3 ตรวจสอบว่าผลลัพธ์อัปเดตเป็น "สิริชัย" และไม่มี "ปิติพงษ์" หลงเหลืออยู่
		await expect(page.getByText(/พบข้อมูลทั้งหมด/i)).toBeVisible({ timeout: 15000 });
		await expect(
			page
				.locator('h3')
				.filter({ hasText: /สิริชัย/i })
				.first()
		).toBeVisible();
		await expect(page.locator('h3').filter({ hasText: /ปิติพงษ์/i })).toHaveCount(0);
	});
});
