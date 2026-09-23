import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test.describe('Public Home Flow & Admin UI Content Creation (Zero Seed Scripts)', () => {
	test('1. ตรวจสอบการกดปุ่มและองค์ประกอบปฏิสัมพันธ์ทุกตัวบนหน้าแรก', async ({ page }) => {
		await page.goto('/');

		// 1.1 ตรวจสอบ Navbar และการสลับภาษา (TH / EN)
		const langButton = page
			.locator('button')
			.filter({ hasText: /^(TH|EN)$/ })
			.first();
		if (await langButton.isVisible()) {
			await langButton.click();
			await page.waitForTimeout(300);
			// สลับกลับเป็น TH
			const langButtonBack = page
				.locator('button')
				.filter({ hasText: /^(TH|EN)$/ })
				.first();
			if (await langButtonBack.isVisible()) {
				await langButtonBack.click();
				await page.waitForTimeout(300);
			}
		}

		// 1.2 Hero Card: ลิงก์ 'ค้นหาศูนย์พักพิง เช็คพิกัดและศูนย์พักพิงที่เปิดรับ'
		const shelterLink = page.getByRole('link', { name: /ค้นหาศูนย์พักพิง/i }).first();
		await expect(shelterLink).toBeVisible();
		await shelterLink.click();
		await expect(page).toHaveURL(/\/shelters/);

		// กดกลับหน้าแรก
		const homeLink1 = page.getByRole('link', { name: 'หน้าแรก' }).first();
		await homeLink1.click();
		await expect(page).toHaveURL(/\/(#.*)?$/);

		// 1.3 Hero Search: กดปุ่มค้นหาโดยไม่กรอกข้อความ เพื่อเปิด FamilySearchModal
		const searchSubmitBtn = page.getByRole('button', { name: 'ค้นหา' }).first();
		await expect(searchSubmitBtn).toBeVisible();
		await searchSubmitBtn.click();

		// ตรวจสอบว่า Modal ค้นหาญาติ/ครอบครัว เปิดขึ้นมา
		const searchModal = page.getByRole('dialog');
		if (await searchModal.isVisible({ timeout: 2000 }).catch(() => false)) {
			// ปิด Modal
			const closeBtn = searchModal.getByRole('button', { name: /ปิด|Close|ยกเลิก/i }).first();
			if (await closeBtn.isVisible()) {
				await closeBtn.click();
			} else {
				await page.keyboard.press('Escape');
			}
			await expect(searchModal).not.toBeVisible();
		}

		// 1.4 ปุ่มในส่วนความต้องการบริจาคด่วน (All Needs & Track Buttons)
		const allNeedsBtn = page
			.getByRole('link', { name: /ดูสิ่งของจำเป็นทั้งหมด|รายการทั้งหมด|ดูรายการรับบริจาคทั้งหมด/i })
			.first();
		if (await allNeedsBtn.isVisible()) {
			await allNeedsBtn.click();
			await expect(page).toHaveURL(/\/donations/);
			await page.getByRole('link', { name: 'หน้าแรก' }).first().click();
			await expect(page).toHaveURL(/\/(#.*)?$/);
		}

		const trackDonationBtn = page
			.getByRole('link', { name: /ติดตามสถานะสิ่งของ|ตรวจสอบสถานะ|ติดตามสถานะการบริจาค/i })
			.first();
		if (await trackDonationBtn.isVisible()) {
			await trackDonationBtn.click();
			await expect(page).toHaveURL(/\/donations\/track/);
			await page.getByRole('link', { name: 'หน้าแรก' }).first().click();
			await expect(page).toHaveURL(/\/(#.*)?$/);
		}

		// 1.5 ปุ่มในส่วนจิตอาสา: ดูภารกิจทั้งหมด ➔ (เปิด Dialog ระบบอยู่ระหว่างการพัฒนา)
		const volunteerMissionBtn = page.getByText('ดูภารกิจทั้งหมด ➔').first();
		if (await volunteerMissionBtn.isVisible()) {
			await volunteerMissionBtn.click();
		} else {
			const altVolunteerBtn = page
				.locator('button')
				.filter({ hasText: /^ดูภารกิจทั้งหมด$/ })
				.first();
			if (await altVolunteerBtn.isVisible()) {
				await altVolunteerBtn.click();
			}
		}

		// ตรวจสอบ Dialog ระบบอยู่ระหว่างการพัฒนา และกด 'รับทราบ'
		const devDialog = page.getByRole('dialog');
		await expect(devDialog).toBeVisible({ timeout: 5000 });
		await expect(
			devDialog.getByText(/ระบบอยู่ระหว่างการพัฒนา|Feature Under Development/i)
		).toBeVisible();
		const ackBtn = devDialog.getByRole('button', { name: 'รับทราบ' });
		if (await ackBtn.isVisible()) {
			await ackBtn.click();
		} else {
			await devDialog.locator('[data-dialog-close]').click();
		}
		await expect(devDialog).not.toBeVisible();

		// 1.6 Accordion FAQ: ทดสอบคลิกเพื่อขยายดูคำตอบ
		const faqSection = page.locator('section').filter({ hasText: /คำถามที่พบบ่อย|FAQ/i });
		const faqTrigger = faqSection
			.locator('button[data-slot="accordion-trigger"], [data-state]')
			.first();
		if (await faqTrigger.isVisible({ timeout: 2000 }).catch(() => false)) {
			await faqTrigger.click();
			await page.waitForTimeout(200);
		}
	});

	test('2. ทดสอบการหาผู้พักพิง / ตามหาญาติ จากหน้าแรก', async ({ page }) => {
		await page.goto('/');

		// พิมพ์คำค้นหาในช่องค้นหาผู้พักพิงบนหน้าแรก
		const searchInput = page.getByRole('textbox', { name: /พิมพ์ชื่อ-นามสกุล|ค้นหา/i }).first();
		await expect(searchInput).toBeVisible();
		await searchInput.click();
		await searchInput.fill('ขวัญตา');

		// กดปุ่มค้นหา
		const searchBtn = page.getByRole('button', { name: 'ค้นหา' }).first();
		await searchBtn.click();

		// ตรวจสอบว่านำทางไปหน้า /search พร้อมส่ง query string อย่างถูกต้อง
		await expect(page).toHaveURL(/\/search\?q=/);

		// ตรวจสอบว่ากล่องค้นหาบนหน้า /search มีคำค้นดังกล่าวอยู่
		const searchPageInput = page.locator('input[type="text"], input[type="search"]').first();
		await expect(searchPageInput).toHaveValue(/ขวัญตา/);

		// กดปุ่มหน้าแรกเพื่อกลับมายังหน้าหลัก
		const homeLink = page.getByRole('link', { name: 'หน้าแรก' }).first();
		if (await homeLink.isVisible()) {
			await homeLink.click();
		} else {
			await page.goto('/');
		}
		await expect(page).toHaveURL(/\/(#.*)?$/);
	});

	test('3. ทดสอบให้ admin สร้าง ความต้องการบริจาคด่วน และ จิตอาสา ผ่าน UI (Zero Seed)', async ({
		page
	}) => {
		// 3.1 บายพาส reCAPTCHA Enterprise สำหรับการรัน E2E Test (เลียนแบบ login.test.ts)
		await page.addInitScript(() => {
			(window as Window & { __captchaToken?: string }).__captchaToken = 'e2e-captcha-token';
		});
		await page.route('**/api/v1/auth/captcha/verify', async (route) => {
			if (route.request().method() === 'POST') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ ok: true })
				});
				return;
			}
			await route.continue();
		});

		// เข้าสู่ระบบผ่านหน้า /login โดยใช้บัญชี Admin
		await page.goto('/login');
		await expect(page.getByRole('button', { name: /เข้าสู่ระบบ|Login/i })).toBeVisible();

		const usernameInput = page.locator('input[autocomplete="username"]').first();
		const passwordInput = page.locator('input[autocomplete="current-password"]').first();
		await usernameInput.fill('admin');
		await passwordInput.fill('password');
		await page.getByRole('button', { name: /เข้าสู่ระบบ|Login/i }).click();

		// รอให้เข้าสู่ระบบสำเร็จและนำทางไป /portal
		await page.waitForURL(/\/portal|\/back-office/, { timeout: 15000 });

		// 3.2 สร้าง "ความต้องการบริจาคด่วน" ผ่าน UI ของหน้า Back-Office
		await page.goto('/back-office/stock-donations');
		await page.waitForTimeout(500);

		// คลิกแท็บ 'จัดการความต้องการ'
		const needsTab = page
			.locator('button[value="needs"], [role="tab"]:has-text("จัดการความต้องการ")')
			.first();
		if (await needsTab.isVisible({ timeout: 5000 }).catch(() => false)) {
			await needsTab.click();
			await page.waitForTimeout(500);
		}

		// คลิกปุ่ม 'สร้างประกาศแบบกำหนดเอง (Special Request)'
		const createNeedBtn = page
			.getByRole('button', { name: /สร้างประกาศแบบกำหนดเอง|Special Request/i })
			.first();
		if (await createNeedBtn.isVisible({ timeout: 10000 }).catch(() => false)) {
			await createNeedBtn.click();

			// รอฟอร์มเปิด
			await expect(page.getByRole('heading', { name: /สร้างประกาศขอรับบริจาค/i })).toBeVisible();

			// เลือกสิ่งของจาก Catalog
			const itemSearchTrigger = page
				.locator('#campaign-item-title, [placeholder*="พิมพ์เพื่อค้นหา"]')
				.first();
			await itemSearchTrigger.click();
			await page.waitForTimeout(300);

			// เลือกลำดับแรกจากรายการ
			const firstOption = page.locator('[role="option"], [data-value]').first();
			if (await firstOption.isVisible({ timeout: 2000 }).catch(() => false)) {
				await firstOption.click();
			} else {
				await itemSearchTrigger.fill('น้ำ');
				await page.waitForTimeout(200);
				await page.keyboard.press('ArrowDown');
				await page.keyboard.press('Enter');
			}

			// กรอกจำนวนเป้าหมาย
			const targetQtyInput = page.locator('#campaign-target-qty');
			if (await targetQtyInput.isVisible()) {
				await targetQtyInput.fill('500');
			}

			// เลือกระดับความเร่งด่วนเป็น 'วิกฤต (Critical)'
			const urgencyTrigger = page.locator('#campaign-urgency');
			if (await urgencyTrigger.isVisible()) {
				await urgencyTrigger.click();
				const criticalOption = page
					.locator('[role="option"]:has-text("วิกฤต"), [role="option"][data-value="critical"]')
					.first();
				if (await criticalOption.isVisible({ timeout: 2000 }).catch(() => false)) {
					await criticalOption.click();
				}
			}

			// กรอกรายละเอียด
			const descInput = page.locator('#campaign-description');
			if (await descInput.isVisible()) {
				await descInput.fill('ต้องการน้ำดื่มสะอาดและอาหารแห้งด่วนสำหรับผู้ประสบภัย');
			}

			// กดปุ่มประกาศขอรับบริจาค
			const submitCampaignBtn = page.getByRole('button', {
				name: /ประกาศขอรับบริจาคผ่านหน้าเว็บสาธารณะ/i
			});
			if (await submitCampaignBtn.isVisible()) {
				await submitCampaignBtn.click();
				await page.waitForTimeout(1500);
			}
		}

		// 3.3 สร้าง "จิตอาสา" ผ่าน UI ของหน้าจัดการอาสาสมัคร
		await page.goto('/back-office/volunteers');
		await page.waitForTimeout(500);

		// กดปุ่ม 'ประกาศภารกิจงานอาสาใหม่' (หรือปุ่มประกาศภารกิจงานอาสาแรก)
		const createJobBtn = page.getByRole('button', { name: /ประกาศภารกิจงานอาสา/i }).first();
		if (await createJobBtn.isVisible({ timeout: 10000 }).catch(() => false)) {
			await createJobBtn.click();

			// รอ Dialog ปรากฏ
			const jobDialog = page.getByRole('dialog');
			await expect(jobDialog).toBeVisible({ timeout: 5000 });

			// กรอกชื่อภารกิจ
			const titleInput = jobDialog
				.locator('input[placeholder*="ช่วยแจกจ่าย"], input[name="title"]')
				.first();
			await titleInput.fill('อาสาช่วยแจกจ่ายอาหารและน้ำดื่มเร่งด่วน');

			// กรอกรายละเอียดงาน
			const jobDescInput = jobDialog
				.locator('textarea[placeholder*="อธิบายภาระหน้าที่"], textarea[name="description"]')
				.first();
			await jobDescInput.fill('ช่วยจัดเตรียมอาหารกล่องและแจกจ่ายน้ำดื่มให้แก่ผู้พักพิงในศูนย์');

			// เลือกระดับความด่วนเป็น 'ด่วนพิเศษ (Urgent)'
			const urgentBtn = jobDialog.getByRole('button', { name: /ด่วนพิเศษ|Urgent/i });
			if (await urgentBtn.isVisible()) {
				await urgentBtn.click();
			}

			// กำหนดวันกะย่อย (เลือกวันที่ผ่าน DatePicker)
			const datePickerBtn = jobDialog.getByRole('button', { name: /เลือกวันที่/i }).first();
			if (await datePickerBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
				await datePickerBtn.click();
				await page.waitForTimeout(300);
				const calendarCell = page.locator('[role="gridcell"]').filter({ hasText: /^\d+$/ }).first();
				if (await calendarCell.isVisible({ timeout: 2000 }).catch(() => false)) {
					await calendarCell.click();
				}
			}

			// กดปุ่ม 'เพิ่มกะ'
			const addShiftBtn = jobDialog.getByRole('button', { name: /เพิ่มกะ/i });
			if ((await addShiftBtn.isVisible()) && (await addShiftBtn.isEnabled())) {
				await addShiftBtn.click();
				await page.waitForTimeout(300);
			}

			// กดปุ่มบันทึกและเผยแพร่
			const saveJobBtn = jobDialog.getByRole('button', { name: /บันทึกและเผยแพร่/i });
			if (await saveJobBtn.isVisible()) {
				await saveJobBtn.click();
				await page.waitForTimeout(1500);
			}
		}
	});

	test('4. ทดสอบการกดปุ่มส่วนความต้องการบริจาคด่วน และ จิตอาสา บนหน้าแรก', async ({
		page,
		context
	}) => {
		await page.goto('/');
		await page.waitForTimeout(1000);

		// 4.1 ตรวจสอบส่วนความต้องการบริจาคด่วน
		const urgentSection = page
			.locator('section')
			.filter({ hasText: /ความต้องการบริจาคด่วน/i })
			.first();
		await expect(urgentSection).toBeVisible();

		// หากมีการ์ดบริจาคด่วนขึ้นมา ทดสอบกดปุ่มแจ้งบริจาคบนการ์ด
		const donationCardCta = urgentSection.getByRole('link', { name: /แจ้งบริจาค|Donate/i }).first();
		if (await donationCardCta.isVisible({ timeout: 2000 }).catch(() => false)) {
			await donationCardCta.click();
			await expect(page).toHaveURL(/\/donations/);
			await page.goto('/');
		}

		// ทดสอบปุ่ม 'ดูสิ่งของจำเป็นทั้งหมด ➔' ในส่วนบริจาคด่วน
		const allNeedsLink = urgentSection
			.getByRole('link', { name: /ดูสิ่งของจำเป็นทั้งหมด|รายการทั้งหมด/i })
			.first();
		if (await allNeedsLink.isVisible()) {
			await allNeedsLink.click();
			await expect(page).toHaveURL(/\/donations/);
			await page.goto('/');
		}

		// 4.2 ตรวจสอบส่วนจิตอาสา
		const volunteerSection = page
			.locator('section')
			.filter({ hasText: /จิตอาสา/i })
			.first();
		await expect(volunteerSection).toBeVisible();

		// ทดสอบกดปุ่มดูภารกิจทั้งหมด
		const allMissionsBtn = page.getByText('ดูภารกิจทั้งหมด ➔').first();
		if (await allMissionsBtn.isVisible()) {
			await allMissionsBtn.click();
		} else {
			const fallbackMissionBtn = volunteerSection
				.locator('button')
				.filter({ hasText: /^ดูภารกิจทั้งหมด$/ })
				.first();
			if (await fallbackMissionBtn.isVisible()) {
				await fallbackMissionBtn.click();
			}
		}

		// ตรวจสอบ Dialog ระบบอยู่ระหว่างการพัฒนา
		const devDialog = page.getByRole('dialog');
		await expect(devDialog).toBeVisible({ timeout: 5000 });
		await expect(
			devDialog.getByText(/ระบบอยู่ระหว่างการพัฒนา|Feature Under Development/i)
		).toBeVisible();

		// กดปุ่ม 'รับทราบ' เพื่อปิด Dialog
		const ackBtn = devDialog.getByRole('button', { name: 'รับทราบ' });
		if (await ackBtn.isVisible()) {
			await ackBtn.click();
		} else {
			await devDialog.locator('[data-dialog-close]').click();
		}
		await expect(devDialog).not.toBeVisible();

		// เคลียร์ cookies เพื่อคืนค่าสถานะ Public สำหรับการทดสอบรอบถัดไป
		await context.clearCookies();
	});
});
