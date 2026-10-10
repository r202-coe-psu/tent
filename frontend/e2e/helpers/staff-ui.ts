/**
 * Staff UI flows the public-plane suites use to create their own data — the same
 * screens staff use, no seeding. Locators are generated with Playwright codegen.
 *
 * Callers must already be signed in (`routeBrowserCouchThroughApp` + `injectSession`
 * with `bootstrapAdminSession()` — only the CouchDB server admin may provision
 * shelters).
 */
import { expect, type Page } from '@playwright/test';

export interface ShelterForm {
	name: string;
	siteKind: 'evacuation_center' | 'host_house';
	lat: number;
	lng: number;
	subdistrict: string; // in จ.สงขลา อ.หาดใหญ่
	capacity: number;
	/** Tick 「รับลงทะเบียนเข้าพักล่วงหน้าจากหน้าสาธารณะ」 so /pre-register lists the shelter. */
	acceptsPreRegistration?: boolean;
}

/** System management → create shelter (status Active). Returns the minted code. */
export async function createShelterViaUi(page: Page, shelter: ShelterForm): Promise<string> {
	await page.goto('/system-management/shelters/create');
	await page.getByRole('textbox', { name: 'ชื่อศูนย์พักพิง *' }).fill(shelter.name);
	await page.getByRole('button', { name: 'ชนิดสถานที่ *' }).click();
	await page
		.getByRole('option', {
			name:
				shelter.siteKind === 'host_house'
					? 'บ้านพี่เลี้ยง (Host House)'
					: 'ศูนย์อพยพ (Evacuation Center)'
		})
		.click();
	await page.getByRole('button', { name: 'สถานะการปฏิบัติการ (Operating Status)' }).click();
	await page.getByRole('option', { name: 'เปิดรับผู้อพยพ (Active)' }).click();
	await page.getByRole('spinbutton', { name: 'ละติจูด (Latitude)' }).fill(String(shelter.lat));
	await page.getByRole('spinbutton', { name: 'ลองจิจูด (Longitude)' }).fill(String(shelter.lng));
	await page.getByRole('button', { name: 'เลือกจังหวัด...' }).click();
	await page.getByRole('button', { name: 'สงขลา' }).click();
	await page.getByRole('button', { name: 'เลือกอำเภอ...' }).click();
	await page.getByRole('button', { name: 'หาดใหญ่' }).click();
	await page.getByRole('button', { name: 'เลือกตำบล' }).click();
	await page.getByRole('button', { name: shelter.subdistrict }).click();
	await page
		.getByRole('spinbutton', { name: 'ความจุสูงสุด (Max Capacity) *' })
		.fill(String(shelter.capacity));
	if (shelter.acceptsPreRegistration) {
		await page.getByRole('switch', { name: 'รับลงทะเบียนเข้าพักล่วงหน้าจากหน้าสาธารณะ' }).click();
	}
	await page.getByRole('button', { name: 'บันทึกข้อมูล' }).click();

	await expect(page).toHaveURL(/\/system-management\/shelters\/edit\/SH\d+$/);
	const code = new URL(page.url()).pathname.split('/').pop()!;
	await expect(page.getByText(`บันทึกข้อมูลและสร้างศูนย์พักพิง ${code} สำเร็จ`)).toBeVisible();
	return code;
}

/** Back-office sidebar → pick `code` as the active shelter for back-office / onsite screens. */
export async function selectActiveShelter(page: Page, code: string): Promise<void> {
	await page.goto('/back-office/stock-donations');
	await page.getByRole('button', { name: 'เลือกศูนย์อพยพ' }).click();
	await page.getByRole('option', { name: new RegExp(`^${code} — `) }).click();
	await expect(page.getByRole('button', { name: 'เลือกศูนย์อพยพ' })).toContainText(code);
}

export interface MemberForm {
	firstName: string;
	lastName: string;
	gender: 'ชาย' | 'หญิง';
	phone?: string;
	idCard?: { type: 'national_id' | 'passport'; number: string };
}

/** Station 1 switches to per-member tabs once a household reaches this many members
 *  (unified-registration-members-section.svelte) and hides every inactive tab's card. */
const MEMBER_TABS_MIN = 3;

/** Onsite Station 1 → register one household (first member = primary contact). */
export async function registerHouseholdViaUi(
	page: Page,
	{ houseNo, members }: { houseNo: string; members: MemberForm[] }
): Promise<void> {
	await page.goto('/onsite/people/new');
	await page.getByRole('textbox', { name: 'บ้านเลขที่ *' }).fill(houseNo);
	await page.getByRole('button', { name: 'จังหวัด *' }).click();
	await page.getByRole('button', { name: 'สงขลา' }).click();
	await page.getByRole('button', { name: 'อำเภอ / เขต *' }).click();
	await page.getByRole('button', { name: 'หาดใหญ่' }).click();
	await page.getByRole('button', { name: 'ตำบล / แขวง *' }).click();
	await page.getByRole('button', { name: 'คอหงส์' }).click();

	for (const [i, member] of members.entries()) {
		if (i > 0) await page.getByRole('button', { name: 'เพิ่มสมาชิก' }).click();
		// Once the tab bar exists, select this member's tab explicitly (the tab's accessible name
		// is prefixed with its 1-based index, "3.สมาชิกคนที่ 3", so match by substring). Then locate
		// the card by its position id, not by role — inactive tabs' cards are hidden, so counting
		// visible "สมาชิก"-named regions no longer finds the new one.
		if (i + 1 >= MEMBER_TABS_MIN) {
			await page.getByRole('tab', { name: `สมาชิกคนที่ ${i + 1}` }).click();
		}
		const card = page.locator(`#unified-member-${i}`);
		await card.getByPlaceholder('ชื่อจริง').fill(member.firstName);
		await card.getByPlaceholder('เช่น มีสุข').fill(member.lastName);
		await card.getByLabel(member.gender).check();
		if (member.idCard) {
			// The card type defaults to the Thai national ID.
			if (member.idCard.type === 'passport') {
				await card.getByRole('button', { name: 'เลขประจำตัวประชาชน' }).click();
				await page.getByRole('option', { name: 'หนังสือเดินทาง' }).click();
			}
			await card.getByRole('textbox', { name: 'เลขที่บัตรประจำตัว' }).fill(member.idCard.number);
		}
		// A new member's phone field opens ready to type; "no phone" must be ticked explicitly.
		if (member.phone) {
			await card.getByRole('textbox', { name: 'เบอร์โทรศัพท์ *' }).fill(member.phone);
		} else {
			await card.getByRole('checkbox', { name: 'ไม่มีเบอร์โทรศัพท์' }).check();
		}
	}

	await page.getByRole('button', { name: 'บันทึกลงทะเบียนทั้งครอบครัว' }).last().click();
	// The possible-duplicate check may interpose a confirm dialog; the E2E people are distinct.
	const confirmNew = page.getByRole('alertdialog').getByRole('button', {
		name: 'ยืนยันลงทะเบียนใหม่',
		exact: true
	});
	const success = page.getByText(`ลงทะเบียนครอบครัว ${members.length} คน สำเร็จ`);
	await expect(confirmNew.or(success)).toBeVisible();
	if (await confirmNew.isVisible()) await confirmNew.click();
	await expect(success).toBeVisible();
}

/** Back office → donation board → "Special Request" with the default Critical urgency. */
export async function createCriticalNeedViaUi(
	page: Page,
	{ item, quantity, reason }: { item: string; quantity: number; reason: string }
): Promise<void> {
	await page.goto('/back-office/stock-donations');
	await page.getByRole('tab', { name: 'จัดการความต้องการ' }).click();
	await page.getByRole('button', { name: 'สร้างประกาศแบบกำหนดเอง (' }).click();
	await page.getByRole('textbox', { name: 'รายการสิ่งของ (Item) *' }).click();
	await page.getByRole('textbox', { name: 'รายการสิ่งของ (Item) *' }).fill(item);
	await page.getByRole('button', { name: item }).first().click();
	await page.getByRole('textbox', { name: 'จำนวนเป้าหมาย (Target' }).fill(String(quantity));
	await expect(page.getByRole('button', { name: 'ความเร่งด่วน (Urgency Level)' })).toHaveText(
		/วิกฤต \(Critical\)/
	);
	await page
		.getByRole('textbox', { name: 'เหตุผลหรือรายละเอียดเพิ่มเติม (Reason / Details) *' })
		.fill(reason);
	await page.getByRole('button', { name: 'ประกาศขอรับบริจาคผ่านหน้าเว็บสาธารณะ' }).click();
	await expect(page.getByText(/เพิ่มประกาศความต้องการ .* สำเร็จ/)).toBeVisible();
}

export interface OnsiteShelterConfig {
	/** Toggle 「เปิดคัดกรองการแพทย์ (Station 2)」. */
	enableMedicalScreening?: boolean;
	/** Toggle 「รับลงทะเบียนเข้าพักล่วงหน้าจากหน้าสาธารณะ」. */
	acceptsPreRegistration?: boolean;
	/** Living zones to add (empty shelter has none). */
	zones?: { name: string; capacity: number }[];
}

/**
 * On the shelter edit page (system-management or back-office), set feature
 * flags and living zones the onsite journeys need, then save.
 * Call after {@link createShelterViaUi} (already on the edit URL) or after
 * navigating to `/…/shelters/edit/{code}`.
 */
export async function configureOnsiteShelterViaUi(
	page: Page,
	code: string,
	config: OnsiteShelterConfig
): Promise<void> {
	const medical = page.locator('#enable-medical-screening');
	await expect(medical).toBeVisible({ timeout: 20_000 });

	if (config.enableMedicalScreening !== undefined) {
		const want = String(config.enableMedicalScreening);
		if ((await medical.getAttribute('aria-checked')) !== want) {
			await medical.click();
			await expect(medical).toHaveAttribute('aria-checked', want);
		}
	}
	if (config.acceptsPreRegistration !== undefined) {
		const sw = page.locator('#accepts-pre-registration');
		const want = String(config.acceptsPreRegistration);
		if ((await sw.getAttribute('aria-checked')) !== want) {
			await sw.click();
			await expect(sw).toHaveAttribute('aria-checked', want);
		}
	}

	for (const zone of config.zones ?? []) {
		await page.getByRole('button', { name: 'เพิ่มโซน' }).click();
		const row = page.locator('input[placeholder="ชื่อโซน"]').last();
		await expect(row).toBeVisible();
		await row.fill(zone.name);
		await page.locator('input[placeholder="ความจุ"]').last().fill(String(zone.capacity));
	}

	await page.getByRole('button', { name: 'บันทึกข้อมูล' }).first().click();
	await expect(page.getByText(`อัปเดตข้อมูลศูนย์พักพิง ${code} สำเร็จ`).first()).toBeVisible({
		timeout: 20_000
	});
}

/** Pin the active workspace shelter in localStorage (staff with one `shelter:` role). */
export async function pinActiveShelter(page: Page, code: string): Promise<void> {
	await page.evaluate((c) => localStorage.setItem('tent.activeShelterCode', c), code);
}

/** Set the reCAPTCHA switch on /system-management/security; returns its previous state. */
export async function setRecaptcha(page: Page, enabled: boolean): Promise<boolean> {
	await page.goto('/system-management/security');
	const sw = page.locator('#recaptcha-enabled');
	await expect(sw).toBeVisible({ timeout: 20_000 });
	const before = (await sw.getAttribute('aria-checked')) === 'true';
	if (before !== enabled) {
		await sw.click();
		await expect(
			page.getByText(enabled ? 'เปิดใช้งาน reCAPTCHA แล้ว' : 'ปิดใช้งาน reCAPTCHA แล้ว')
		).toBeVisible({ timeout: 20_000 });
	}
	return before;
}
