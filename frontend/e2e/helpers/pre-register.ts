/**
 * Page helpers for the public pre-register suites (`public-pre-register-flow.test.ts`):
 * fictitious identities, page-health watching, and the form-filling steps shared by
 * every scenario. Locators follow the real DOM (ids from `PersonalInfoFields`,
 * `HouseholdAddressFields`, …) — see the render contract in the suite header.
 */
import { expect, type Locator, type Page } from '@playwright/test';

export const PRE_REGISTER_PATH = '/pre-register?shelter=unassigned';
export const SUBMIT_LABEL = 'ยืนยันการลงทะเบียน';
export const UNASSIGNED_OPTION = /ไม่ระบุศูนย์พักพิง/;
export const DISCLAIMER_LABEL = /ข้าพเจ้ารับทราบเงื่อนไขการใช้งานระบบ/;
export const SUMMARY_TITLE = 'ตรวจสอบข้อมูลก่อนบันทึก';
export const JUMP_BUTTON = 'ไปยังช่องที่ต้องแก้';

// ------------------------------------------------------------------ identities

/**
 * Thai national-ID checksum (mod 11) — same algorithm as `isValidThaiNationalId`.
 * IDs start with `0` (real Thai IDs start with 1–8, so a fictitious one can never belong to
 * a real person — see `e2e-env.ts`).
 */
export function fictitiousNationalId(seed: number): string {
	const body = `0${String(seed).padStart(11, '0').slice(-11)}`;
	let sum = 0;
	for (let i = 0; i < 12; i++) sum += Number(body[i]) * (13 - i);
	return `${body}${(11 - (sum % 11)) % 10}`;
}

/** Same ID with a wrong last digit — fails the checksum but is still 13 digits. */
export function withBrokenChecksum(nationalId: string): string {
	const last = Number(nationalId[12]);
	return `${nationalId.slice(0, 12)}${(last + 1) % 10}`;
}

/** Fictitious 10-digit mobile that differs per run and per `offset`. */
export function fictitiousPhone(offset = 0): string {
	return `08${String(Date.now() + offset).slice(-8)}`;
}

// ------------------------------------------------------------------ page health

export interface PageHealth {
	/** `pageerror` + console `error` / `warning` messages. */
	problems: string[];
	/** `<status> <url>` of every response with status >= 400. */
	failedResponses: string[];
	/** `<method> <path>` of every write the page sent to the registration BFF. */
	registrationWrites: string[];
}

const REGISTRATION_WRITE = /\/api\/public\/v1\/(unassigned-registrations|registrations)(\?|$)/;

/** Start collecting console problems, failed responses and registration writes on `page`. */
export function watchPage(page: Page): PageHealth {
	const health: PageHealth = { problems: [], failedResponses: [], registrationWrites: [] };
	page.on('pageerror', (err) => health.problems.push(`pageerror: ${err.message}`));
	page.on('console', (msg) => {
		if (msg.type() === 'error' || msg.type() === 'warning') {
			health.problems.push(`console.${msg.type()}: ${msg.text()}`);
		}
	});
	page.on('response', (res) => {
		if (res.status() >= 400) health.failedResponses.push(`${res.status()} ${res.url()}`);
	});
	page.on('request', (req) => {
		if (req.method() === 'POST' && REGISTRATION_WRITE.test(req.url())) {
			health.registrationWrites.push(`POST ${new URL(req.url()).pathname}`);
		}
	});
	return health;
}

/** R6: nothing logged, no >=400 response — `allowFailed` lists intentional ones (substring). */
export function expectHealthy(health: PageHealth, allowFailed: string[] = []): void {
	expect(health.problems, `console / page errors:\n${health.problems.join('\n')}`).toEqual([]);
	const unexpected = health.failedResponses.filter((r) => !allowFailed.some((a) => r.includes(a)));
	expect(unexpected, `failed responses:\n${unexpected.join('\n')}`).toEqual([]);
}

// ------------------------------------------------------------------ navigation

/** Open the form for the central queue and wait until the address section has rendered. */
export async function openPreRegister(page: Page, path = PRE_REGISTER_PATH): Promise<void> {
	await page.goto(path);
	await expect(page.locator('#address-no')).toBeVisible({ timeout: 20_000 });
}

/** The shelter dropdown trigger (the label above it is not bound to the control). */
export function shelterTrigger(page: Page): Locator {
	return page
		.locator('section')
		.filter({ has: page.getByRole('heading', { name: 'ศูนย์พักพิงที่ต้องการเข้าพัก' }) })
		.getByRole('button')
		.first();
}

export async function chooseShelter(page: Page, option: string | RegExp): Promise<void> {
	await shelterTrigger(page).click();
	await page.getByRole('option', { name: option }).click();
}

export function primaryCard(page: Page): Locator {
	return page.getByRole('region', { name: 'ผู้ติดต่อหลัก' });
}

export function memberCard(page: Page, n: number): Locator {
	return page.getByRole('region', { name: `สมาชิก ${n}` });
}

/** The submit button in the bottom bar (the summary aside repeats the same label). */
export function submitButton(page: Page): Locator {
	return page.getByRole('button', { name: SUBMIT_LABEL }).last();
}

export async function acceptDisclaimer(page: Page): Promise<void> {
	await page.getByRole('checkbox', { name: DISCLAIMER_LABEL }).check();
}

// ------------------------------------------------------------------ form steps

export interface AddressInput {
	houseNo?: string;
	landmark?: string;
	villageNo?: string;
	province?: string;
	district?: string;
	subdistrict?: string;
}

/** Pick one option of a SearchSelect (`#province`, `#district`, `#subdistrict`). */
export async function pickSearchSelect(page: Page, id: string, option: string): Promise<void> {
	await page.locator(`#${id}`).click();
	await page.getByRole('button', { name: option, exact: true }).click();
}

/** Fill the domicile; `postal_code` fills itself from the subdistrict. */
export async function fillAddress(page: Page, a: AddressInput = {}): Promise<void> {
	const v = {
		houseNo: '123/45',
		villageNo: 'หมู่ 4 ถ.กาญจนวนิช',
		province: 'สงขลา',
		district: 'หาดใหญ่',
		subdistrict: 'คอหงส์',
		...a
	};
	if (v.landmark) await page.locator('#residence-landmark').fill(v.landmark);
	if (v.houseNo) await page.locator('#address-no').fill(v.houseNo);
	if (v.villageNo) await page.locator('#village-no').fill(v.villageNo);
	if (v.province) await pickSearchSelect(page, 'province', v.province);
	if (v.district) await pickSearchSelect(page, 'district', v.district);
	if (v.subdistrict) await pickSearchSelect(page, 'subdistrict', v.subdistrict);
}

export interface MemberInput {
	firstName?: string;
	lastName?: string;
	nickname?: string;
	nationalId?: string;
	gender?: 'male' | 'female';
	phone?: string;
	birthYear?: string;
	age?: string;
}

/** Fill one member card (`#member-<n>-*`); only the keys passed are touched. */
export async function fillMember(page: Page, n: number, m: MemberInput): Promise<void> {
	const id = (name: string) => page.locator(`#member-${n}-${name}`);
	if (m.firstName !== undefined) await id('first-name').fill(m.firstName);
	if (m.lastName !== undefined) await id('last-name').fill(m.lastName);
	if (m.nickname !== undefined) await id('nickname').fill(m.nickname);
	if (m.nationalId !== undefined) await id('card-number').fill(m.nationalId);
	if (m.birthYear !== undefined) await id('birth-year').fill(m.birthYear);
	if (m.age !== undefined) await id('age').fill(m.age);
	// the label is the real click target (the radio itself is a tiny button)
	if (m.gender) await page.locator(`label[for="member-${n}-gender-${m.gender}"]`).click();
	if (m.phone !== undefined) await id('phone').fill(m.phone);
}

/** Expand an accordion of a member card ('ผู้ติดต่อฉุกเฉิน' | 'กลุ่มเปราะบาง' | 'ความต้องการพิเศษ'). */
export async function openMemberAccordion(
	card: Locator,
	name: 'ผู้ติดต่อฉุกเฉิน' | 'กลุ่มเปราะบาง' | 'ความต้องการพิเศษ'
): Promise<void> {
	const trigger = card.getByRole('button', { name, exact: true });
	if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
}

export async function fillEmergencyContact(
	page: Page,
	c: { name?: string; phone?: string; relation?: string }
): Promise<void> {
	await openMemberAccordion(primaryCard(page), 'ผู้ติดต่อฉุกเฉิน');
	if (c.name !== undefined) await page.locator('#emergency-name').fill(c.name);
	if (c.phone !== undefined) await page.locator('#emergency-phone').fill(c.phone);
	if (c.relation !== undefined) await page.locator('#emergency-relation').fill(c.relation);
}

/** Expand the pets accordion (collapsed by default). */
export async function openPets(page: Page): Promise<void> {
	const trigger = page.locator('#unified-pets').getByRole('button', { name: /^สัตว์เลี้ยง/ });
	if ((await trigger.first().getAttribute('aria-expanded')) !== 'true')
		await trigger.first().click();
}

/** Complete minimum valid input for the central queue (everything but the disclaimer). */
export async function fillMinimalValid(
	page: Page,
	m: MemberInput & { phone: string } = { phone: fictitiousPhone() }
): Promise<void> {
	await fillAddress(page);
	await fillMember(page, 0, {
		firstName: 'ทดสอบ',
		lastName: 'ระบบ',
		gender: 'male',
		...m
	});
}

/** Number of invalid fields currently flagged in the form. */
export function invalidFields(page: Page): Locator {
	return page.locator('form [aria-invalid="true"]');
}

export function summaryAlert(page: Page): Locator {
	return page.getByRole('alert').filter({ hasText: SUMMARY_TITLE });
}

/** Mock the system banner so layout checks do not depend on the target's live setting. */
export async function mockSystemBanner(page: Page, enabled: boolean): Promise<void> {
	await page.route('**/api/public/v1/system-banner', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(
				enabled
					? { enabled: true, message: 'ทดสอบระบบ', variant: 'warning' }
					: { enabled: false, message: '', variant: 'warning' }
			)
		})
	);
}
