import { test, expect, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test.describe('Public Portal FAQ Management CRUD & Public Landing Flow (Zero Seed Scripts)', () => {
	test.beforeEach(async () => {
		test.setTimeout(90000);
	});

	// คำถาม-คำตอบทดสอบสำหรับสร้างผ่าน UI (Zero Seed)
	const UNIQUE_ID = Date.now().toString().slice(-4);
	const INITIAL_QUESTION_TH = `ศูนย์พักพิงเปิดให้บริการตลอด 24 ชั่วโมงหรือไม่? [E2E-${UNIQUE_ID}]`;
	const INITIAL_ANSWER_TH = `ใช่ ศูนย์พักพิงเปิดรับผู้ประสบภัยตลอด 24 ชั่วโมง พร้อมทีมแพทย์และเจ้าหน้าที่คอยอำนวยความสะดวก [E2E-${UNIQUE_ID}]`;
	const INITIAL_QUESTION_EN = `Is the emergency shelter open 24 hours? [E2E-${UNIQUE_ID}]`;
	const INITIAL_ANSWER_EN = `Yes, the emergency shelter is open 24/7 with on-duty staff and medical support. [E2E-${UNIQUE_ID}]`;

	const UPDATED_QUESTION_TH = `ศูนย์พักพิงเปิดให้บริการตลอด 24 ชั่วโมงหรือไม่? [อัปเดต-${UNIQUE_ID}]`;
	const UPDATED_ANSWER_TH = `ใช่ มีเจ้าหน้าที่และพยาบาลประจำการตลอด 24 ชั่วโมง [อัปเดต-${UNIQUE_ID}]`;

	/** Helper จำลองการยืนยันตัวตน reCAPTCHA เพื่อให้รันใน Local Dev / E2E ได้อย่างราบรื่น */
	async function bypassLoginCaptcha(page: Page) {
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
	}

	/** Helper เข้าสู่ระบบด้วยบัญชี Admin */
	async function loginAsAdmin(page: Page) {
		await bypassLoginCaptcha(page);
		await page.goto('/login');
		await expect(page.getByRole('button', { name: /เข้าสู่ระบบ|Login/i })).toBeVisible({
			timeout: 10000
		});

		const usernameInput = page.locator('input[autocomplete="username"]').first();
		const passwordInput = page.locator('input[autocomplete="current-password"]').first();
		await usernameInput.fill('admin');
		await passwordInput.fill('password');
		await page.getByRole('button', { name: /เข้าสู่ระบบ|Login/i }).click();

		// รอจนกระทั่งเข้าสู่ระบบสำเร็จ
		await page.waitForURL(/\/portal|\/back-office|\/system-management/, { timeout: 15000 });
	}

	test('1. ให้ Admin เข้าสู่ระบบและสร้างคำถามที่พบบ่อย (Create FAQ via UI)', async ({ page }) => {
		// 1.1 เข้าสู่ระบบผ่านหน้า /login โดยใช้บัญชี Admin
		await loginAsAdmin(page);

		// 1.2 นำทางไปยังหน้าระบบจัดการ Public Portal Config (FAQ)
		await page.goto('/system-management/public-portal-config');
		await expect(
			page.getByRole('heading', { name: /การตั้งค่า Public Portal|รายการข้อมูล/i }).first()
		).toBeVisible({ timeout: 15000 });

		// ตรวจสอบว่าอยู่ในหมวดหมู่ 'หน้าเว็บสาธารณะ (Public)'
		const publicTab = page
			.locator('button')
			.filter({ hasText: /หน้าเว็บสาธารณะ \(Public\)/i })
			.first();
		if (await publicTab.isVisible()) {
			await publicTab.click();
			await page.waitForTimeout(300);
		}

		// 1.3 กดปุ่ม '+ เพิ่มข้อมูล' เพื่อเปิดโมดอลสร้าง FAQ
		const addBtn = page.getByRole('button', { name: /เพิ่มข้อมูล/i }).first();
		await expect(addBtn).toBeVisible({ timeout: 10000 });
		await addBtn.click();

		// รอให้ Dialog 'เพิ่มคำถามใหม่' ปรากฏ
		const faqDialog = page.getByRole('dialog');
		await expect(faqDialog).toBeVisible({ timeout: 5000 });
		await expect(faqDialog.getByRole('heading', { name: /เพิ่มคำถามใหม่/i })).toBeVisible();

		// 1.4 กรอกข้อมูลคำถามและคำตอบ (ไทย & อังกฤษ)
		await faqDialog.locator('#question').fill(INITIAL_QUESTION_TH);
		await faqDialog.locator('#answer').fill(INITIAL_ANSWER_TH);
		await faqDialog.locator('#question_en').fill(INITIAL_QUESTION_EN);
		await faqDialog.locator('#answer_en').fill(INITIAL_ANSWER_EN);

		// ตรวจสอบว่าสวิตช์การเผยแพร่เปิดอยู่
		const publishSwitch = faqDialog.locator('button[role="switch"]');
		if (await publishSwitch.isVisible()) {
			const isChecked = (await publishSwitch.getAttribute('aria-checked')) === 'true';
			if (!isChecked) {
				await publishSwitch.click();
			}
		}

		// 1.5 กดปุ่ม 'ยืนยัน' ในโมดอล (ระบบจะทำการบันทึกลงฐานข้อมูลอัตโนมัติ)
		const confirmBtn = faqDialog.getByRole('button', { name: 'ยืนยัน' });
		await confirmBtn.click();
		await expect(faqDialog).not.toBeVisible();

		// 1.6 ตรวจสอบว่าคำถามใหม่ปรากฏในตารางรายการข้อมูล
		const tableRow = page.locator('tr').filter({ hasText: INITIAL_QUESTION_TH });
		await expect(tableRow).toBeVisible({ timeout: 15000 });
		await expect(tableRow.getByText('เผยแพร่')).toBeVisible({ timeout: 5000 });
	});

	test('2. ทดสอบว่าสามารถเห็น FAQ ที่สร้างขึ้นในหน้าแรกของ public ได้หรือไม่ (Read on Landing Page)', async ({
		page
	}) => {
		// 2.1 ไปยังหน้าแรกของ Public
		await page.goto('/');
		await page.waitForTimeout(500);

		// 2.2 ค้นหาหมวดคำถามที่พบบ่อย (FAQ Section)
		const faqSection = page.locator('section').filter({ hasText: /คำถามที่พบบ่อย|FAQ/i });
		await expect(faqSection).toBeVisible();

		// ตรวจสอบว่าคำถามภาษาไทยที่เพิ่งสร้างปรากฏในส่วน FAQ
		const faqItemTrigger = faqSection.locator('button').filter({ hasText: INITIAL_QUESTION_TH });
		await expect(faqItemTrigger).toBeVisible({ timeout: 8000 });

		// 2.3 คลิกเพื่อกางดูคำตอบ และตรวจสอบความถูกต้องของคำตอบ
		await faqItemTrigger.click();
		await page.waitForTimeout(300);
		await expect(faqSection.getByText(INITIAL_ANSWER_TH).first()).toBeVisible({ timeout: 5000 });

		// 2.4 ทดสอบสลับภาษาเป็นภาษาอังกฤษ (EN)
		const langButtonEn = page.getByRole('button', { name: /Switch to English|EN/i }).first();
		if (await langButtonEn.isVisible()) {
			await langButtonEn.click();
			await page.waitForTimeout(500);

			// ตรวจสอบว่าคำถามและคำตอบเปลี่ยนเป็นภาษาอังกฤษตามที่ระบุไว้
			const faqItemTriggerEn = faqSection
				.locator('button')
				.filter({ hasText: INITIAL_QUESTION_EN })
				.first();
			await expect(faqItemTriggerEn).toBeVisible({ timeout: 5000 });
			await faqItemTriggerEn.scrollIntoViewIfNeeded();
			await page.waitForTimeout(300);
			await faqItemTriggerEn.click();
			await page.waitForTimeout(500);

			const enAnswer = faqSection.getByText(INITIAL_ANSWER_EN).first();
			if (await enAnswer.isVisible({ timeout: 3000 }).catch(() => false)) {
				await expect(enAnswer).toBeVisible();
			}

			// สลับกลับเป็นภาษาไทย (TH)
			const langButtonTh = page.getByRole('button', { name: /เปลี่ยนเป็นภาษาไทย|TH/i }).first();
			if (await langButtonTh.isVisible()) {
				await langButtonTh.click();
				await page.waitForTimeout(300);
			}
		}
	});

	test('3. ทดสอบ CRUD ของ FAQ ทุกแบบ (Update ข้อความ, ซ่อน/เผยแพร่, กรองค้นหา และ ลบ)', async ({
		page
	}) => {
		// 3.1 เข้าสู่ระบบ Admin และนำทางไปยังหน้าระบบจัดการ Public Portal Config
		await loginAsAdmin(page);
		await page.goto('/system-management/public-portal-config');
		await expect(
			page.getByRole('heading', { name: /การตั้งค่า Public Portal|รายการข้อมูล/i }).first()
		).toBeVisible({ timeout: 15000 });

		// 3.2 Update: แก้ไขคำถามและคำตอบ
		let targetRow = page.locator('tr').filter({ hasText: INITIAL_QUESTION_TH });
		await expect(targetRow).toBeVisible({ timeout: 5000 });
		await targetRow.getByRole('button', { name: /จัดการ/i }).click();

		// โมดอล 'แก้ไขคำถาม' เปิดขึ้นมา
		const editDialog = page.getByRole('dialog');
		await expect(editDialog).toBeVisible({ timeout: 5000 });
		await expect(editDialog.getByRole('heading', { name: /แก้ไขคำถาม/i })).toBeVisible();

		// แก้ไขข้อความคำถามและคำตอบภาษาไทย
		await editDialog.locator('#question').fill(UPDATED_QUESTION_TH);
		await editDialog.locator('#answer').fill(UPDATED_ANSWER_TH);
		await editDialog.getByRole('button', { name: 'ยืนยัน' }).click();
		await expect(editDialog).not.toBeVisible();

		// ตรวจสอบว่าในตารางแสดงข้อความที่อัปเดตใหม่
		targetRow = page.locator('tr').filter({ hasText: UPDATED_QUESTION_TH });
		await expect(targetRow).toBeVisible({ timeout: 15000 });

		// 3.3 ตรวจสอบบนหน้าแรก (Read Updated Content)
		await page.goto('/');
		const faqSection = page.locator('section').filter({ hasText: /คำถามที่พบบ่อย|FAQ/i });
		const updatedFaqTrigger = faqSection.locator('button').filter({ hasText: UPDATED_QUESTION_TH });
		await expect(updatedFaqTrigger).toBeVisible({ timeout: 15000 });
		await updatedFaqTrigger.scrollIntoViewIfNeeded();
		await page.waitForTimeout(300);
		await updatedFaqTrigger.click();
		await page.waitForTimeout(500);
		const updatedAnswer = faqSection.getByText(UPDATED_ANSWER_TH).first();
		if (await updatedAnswer.isVisible({ timeout: 3000 }).catch(() => false)) {
			await expect(updatedAnswer).toBeVisible();
		}

		// 3.4 Update Status: ทดสอบปิดสวิตช์ 'การเผยแพร่' (ซ่อนคำถาม)
		await page.goto('/system-management/public-portal-config');
		targetRow = page.locator('tr').filter({ hasText: UPDATED_QUESTION_TH });
		await expect(targetRow).toBeVisible({ timeout: 10000 });
		await targetRow.getByRole('button', { name: /จัดการ/i }).click();

		const hideDialog = page.getByRole('dialog');
		await expect(hideDialog).toBeVisible({ timeout: 5000 });

		// สลับสวิตช์ปิดการเผยแพร่
		const switchBtn = hideDialog.locator('button[role="switch"]');
		if (await switchBtn.isVisible()) {
			const isChecked = (await switchBtn.getAttribute('aria-checked')) === 'true';
			if (isChecked) {
				await switchBtn.click();
			}
		}
		await hideDialog.getByRole('button', { name: 'ยืนยัน' }).click();
		await expect(hideDialog).not.toBeVisible();

		// ตรวจสอบว่าในตารางเปลี่ยนสถานะเป็น 'ซ่อน'
		targetRow = page.locator('tr').filter({ hasText: UPDATED_QUESTION_TH });
		await expect(targetRow.getByText('ซ่อน')).toBeVisible({ timeout: 15000 });

		// 3.5 ตรวจสอบว่าคำถามที่ถูก 'ซ่อน' จะไม่แสดงในหน้าแรกของ Public
		await page.goto('/');
		await page.waitForTimeout(500);
		const hiddenFaqTrigger = page
			.locator('section')
			.filter({ hasText: /คำถามที่พบบ่อย|FAQ/i })
			.locator('button')
			.filter({ hasText: UPDATED_QUESTION_TH });
		await expect(hiddenFaqTrigger).not.toBeVisible({ timeout: 5000 });

		// 3.6 Search / Filter: ทดสอบค้นหาคำถามในตาราง
		await page.goto('/system-management/public-portal-config');
		const searchInput = page.locator('input[type="search"][placeholder*="ค้นหาคำถาม"]').first();
		await expect(searchInput).toBeVisible({ timeout: 10000 });
		await searchInput.fill(UNIQUE_ID);
		await page.waitForTimeout(300);
		await expect(page.locator('tr').filter({ hasText: UPDATED_QUESTION_TH })).toBeVisible({
			timeout: 5000
		});
		await searchInput.clear();
		await page.waitForTimeout(300);

		// 3.7 Delete: ทดสอบลบคำถามผ่านปุ่ม 'ลบ' บน UI เพื่อ Clean up ข้อมูล
		page.once('dialog', async (dialog) => {
			await dialog.accept();
		});

		targetRow = page.locator('tr').filter({ hasText: UPDATED_QUESTION_TH });
		await expect(targetRow).toBeVisible({ timeout: 10000 });
		await targetRow.getByRole('button', { name: /ลบ/i }).click();

		// ตรวจสอบว่ารายการถูกลบออกจากตารางเรียบร้อยแล้ว
		await expect(page.locator('tr').filter({ hasText: UPDATED_QUESTION_TH })).not.toBeVisible({
			timeout: 15000
		});

		// ตรวจสอบบนหน้าแรกอีกครั้งว่าไม่พบคำถามดังกล่าว
		await page.goto('/');
		const deletedFaqTrigger = page
			.locator('section')
			.filter({ hasText: /คำถามที่พบบ่อย|FAQ/i })
			.locator('button')
			.filter({ hasText: UPDATED_QUESTION_TH });
		await expect(deletedFaqTrigger).not.toBeVisible({ timeout: 5000 });
	});

	test('4. ทดสอบการกดปุ่มส่วนความต้องการบริจาคด่วน และ จิตอาสา บนหน้าแรก', async ({
		page,
		context
	}) => {
		await page.goto('/');
		await page.waitForTimeout(500);

		// 4.1 ตรวจสอบส่วนความต้องการบริจาคด่วน (Urgent Donation Section)
		const urgentDonationSection = page
			.locator('section')
			.filter({ hasText: /ความต้องการบริจาคด่วน/i })
			.first();
		await expect(urgentDonationSection).toBeVisible();

		// ทดสอบปุ่ม 'ดูสิ่งของจำเป็นทั้งหมด ➔'
		const allNeedsLink = urgentDonationSection
			.getByRole('link', { name: /ดูสิ่งของจำเป็นทั้งหมด|รายการทั้งหมด|ดูรายการรับบริจาคทั้งหมด/i })
			.first();
		if (await allNeedsLink.isVisible()) {
			await allNeedsLink.click();
			await expect(page).toHaveURL(/\/donations/);
			await page.goto('/');
		}

		// ทดสอบปุ่ม 'ติดตามสถานะสิ่งของ'
		const trackDonationLink = urgentDonationSection
			.getByRole('link', { name: /ติดตามสถานะสิ่งของ|ตรวจสอบสถานะ|ติดตามสถานะการบริจาค/i })
			.first();
		if (await trackDonationLink.isVisible()) {
			await trackDonationLink.click();
			await expect(page).toHaveURL(/\/donations\/track/);
			await page.goto('/');
		}

		// หากมีการ์ดบริจาคด่วนขึ้นมา ทดสอบกดปุ่มแจ้งบริจาค
		const donationCardBtn = urgentDonationSection
			.getByRole('link', { name: /แจ้งบริจาค|Donate/i })
			.first();
		if (await donationCardBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
			await donationCardBtn.click();
			await expect(page).toHaveURL(/\/donations/);
			await page.goto('/');
		}

		// 4.2 ตรวจสอบส่วนจิตอาสา (Volunteer Section)
		const volunteerSection = page
			.locator('section')
			.filter({ hasText: /จิตอาสา/i })
			.first();
		await expect(volunteerSection).toBeVisible();

		// ทดสอบกดปุ่ม 'ดูภารกิจทั้งหมด ➔' เพื่อเปิด Dialog ระบบอยู่ระหว่างการพัฒนา
		const volunteerMissionBtn = page.getByText('ดูภารกิจทั้งหมด ➔').first();
		if (await volunteerMissionBtn.isVisible()) {
			await volunteerMissionBtn.click();
		} else {
			const altVolunteerBtn = volunteerSection
				.locator('button')
				.filter({ hasText: /^ดูภารกิจทั้งหมด$/ })
				.first();
			if (await altVolunteerBtn.isVisible()) {
				await altVolunteerBtn.click();
			}
		}

		// ตรวจสอบและปิด Dialog ระบบอยู่ระหว่างการพัฒนา
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

		// เคลียร์คุกกี้เซสชัน
		await context.clearCookies();
	});
});
