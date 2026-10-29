/**
 * #588 — Station 1 (`/onsite/people/new`) fills the head and a member from ThaiD by a
 * cross-device QR scan, without leaving the page. ThaiD itself is stubbed with `page.route`:
 * `thaid/status` (flag), `thaid/scan-session` (session + QR), and the session's SSE `events`
 * stream + poll fallback (the phone "finishing" the scan). The `isThaidRegistrationEnabled`
 * mock mode cannot be used — `vite preview` is a production build, so `dev = false`.
 * Tags: `@onsite` + `@critical`. Local only (writes): `docker compose up -d`, `pnpm seed:master`,
 * build with `PUBLIC_COUCH_PROXY=/couch`, then
 *   PLAYWRIGHT_TEST_BASE_URL=http://localhost:4191 pnpm exec playwright test \
 *     e2e/onsite-thaid-registration.test.ts
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import {
	bootstrapAdminSession,
	couchLogin,
	createCouchUser,
	deleteCouchUser,
	registrationStaffRoles,
	seedSecurityQuestion,
	type TestUser
} from './helpers/couch';
import { acceptFullConsent } from './helpers/consent';
import { CAN_WRITE, LOCAL_RUN_ID as RUN_ID, READ_ONLY_REASON } from './helpers/e2e-env';
import { injectSession, routeBrowserCouchThroughApp } from './helpers/login';
import {
	expectStay,
	finishPrintScreen,
	idsFromPrintScreen,
	openAsShelterStaff,
	STAY_STATUS,
	type OnsitePerson
} from './helpers/onsite';
import { fictitiousNationalId, fictitiousPhone } from './helpers/pre-register';
import { purgeCreatedData, recordCreatedShelter, teardownShelter } from './helpers/public-cleanup';
import { createShelterViaUi, pinActiveShelter } from './helpers/staff-ui';

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 15_000 });

const SHELTER_NAME = `E2E ThaiD ${RUN_ID}`;
const LAST_NAME = `ThaiD${RUN_ID}`;
const HEAD_ID = fictitiousNationalId((Number.parseInt(RUN_ID, 36) + 11) % 1e11);
const MEMBER_ID = fictitiousNationalId((Number.parseInt(RUN_ID, 36) + 17) % 1e11);
const HEAD_PHONE = fictitiousPhone(5);

const ADDRESS = {
	address_no: '45/6',
	village_no: '2',
	subdistrict: 'คอหงส์',
	district: 'หาดใหญ่',
	province: 'สงขลา',
	postal_code: '90110'
};

/** ThaiD profile as the BFF returns it (`ThaiDAutofillProfile`). */
function thaidProfile(personId: string, firstName: string, gender: 'male' | 'female') {
	return {
		id: `thaid-${personId}`,
		roleLabel: '',
		person_id: personId,
		first_name: firstName,
		last_name: LAST_NAME,
		nickname: '',
		gender,
		birth_year: 2523,
		age: 46,
		phone: null,
		vulnerable_groups: [],
		special_needs: [],
		medical_conditions: [],
		address: ADDRESS
	};
}

/** Stub ThaiD for `page`: each new scan session completes with the next profile in `scans`. */
async function stubThaid(
	page: Page,
	enabled: boolean,
	scans: ReturnType<typeof thaidProfile>[] = []
): Promise<void> {
	const bySession = new Map<string, ReturnType<typeof thaidProfile>>();
	await page.route('**/api/public/v1/thaid/status', (route) =>
		route.fulfill({ json: { enabled, isDev: false, mode: 'real' } })
	);
	await page.route('**/api/public/v1/thaid/scan-session', (route) => {
		const sessionId = `e2e-scan-${bySession.size + 1}`;
		const profile = scans[bySession.size];
		if (profile) bySession.set(sessionId, profile);
		return route.fulfill({
			json: {
				sessionId,
				qrUrl: `https://thaid.example.test/scan/${sessionId}`,
				expiresAt: Date.now() + 900_000,
				ttlSeconds: 900
			}
		});
	});
	await page.route('**/api/public/v1/thaid/scan-session/*/events', (route) => {
		const sessionId = route.request().url().split('/').at(-2)!;
		const profile = bySession.get(sessionId);
		return route.fulfill({
			status: 200,
			headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' },
			body: profile ? `event: completed\ndata: ${JSON.stringify({ profile })}\n\n` : ''
		});
	});
	await page.route('**/api/public/v1/thaid/scan-session/*', (route) => {
		const profile = bySession.get(route.request().url().split('/').at(-1)!);
		return route.fulfill({
			json: profile ? { status: 'completed', profile } : { status: 'pending' }
		});
	});
}

async function openNewRegistration(page: Page): Promise<void> {
	await page.goto('/onsite/people/new');
	await expect(page.getByRole('heading', { name: 'ลงทะเบียนครอบครัว' })).toBeVisible({
		timeout: 20_000
	});
}

/** Wait for the QR dialog to show, then for the stubbed scan to fill the form. */
async function scanThaid(page: Page, fullName: string): Promise<void> {
	const dialog = page.getByRole('dialog');
	await expect(
		dialog.getByAltText('QR Code สำหรับสแกน ThaiD').or(dialog.getByText('ดึงข้อมูลสำเร็จ!'))
	).toBeVisible();
	await expect(page.getByText(`ดึงข้อมูล ${fullName}`).first()).toBeVisible({ timeout: 15_000 });
	await expect(dialog).toBeHidden();
}

let shelterCode: string | undefined;
let registrar: TestUser | undefined;
let registrarSession: string | undefined;
let liveWritesStarted = false;

test.afterAll(async () => {
	test.setTimeout(180_000);
	if (!CAN_WRITE || !liveWritesStarted) return;
	if (shelterCode) {
		await teardownShelter(shelterCode).catch(() => undefined);
		shelterCode = undefined;
	}
	await purgeCreatedData(LAST_NAME);
	if (registrar) await deleteCouchUser(registrar.name).catch(() => undefined);
});

test.describe('Station 1 ThaiD autofill (#588)', { tag: ['@onsite', '@critical'] }, () => {
	test.beforeEach(() => {
		test.skip(!CAN_WRITE, READ_ONLY_REASON);
	});

	test('provision E2E shelter + registration staff', async ({ page }) => {
		test.setTimeout(180_000);
		liveWritesStarted = true;
		const admin = await bootstrapAdminSession();
		await routeBrowserCouchThroughApp(page);
		await injectSession(page, admin.user, admin.cookie);

		shelterCode = await createShelterViaUi(page, {
			name: SHELTER_NAME,
			siteKind: 'evacuation_center',
			lat: 7.006,
			lng: 100.498,
			subdistrict: 'คอหงส์',
			capacity: 40
		});
		recordCreatedShelter(shelterCode);

		registrar = {
			name: `thaid_reg_${RUN_ID}`,
			password: 'Password1!',
			roles: registrationStaffRoles(shelterCode),
			display_name: 'ThaiD Registrar E2E'
		};
		await createCouchUser(registrar);
		await seedSecurityQuestion(registrar.name);
		registrarSession = await couchLogin(registrar.name, registrar.password);
		await pinActiveShelter(page, shelterCode);
	});

	test('head + member filled from ThaiD on the same page, then saved', async ({
		browser
	}: {
		browser: Browser;
	}) => {
		test.setTimeout(240_000);
		expect(shelterCode && registrar && registrarSession, 'provision must run first').toBeTruthy();
		const head: OnsitePerson = {
			firstName: 'สมชาย',
			lastName: LAST_NAME,
			gender: 'male',
			nationalId: HEAD_ID,
			phone: HEAD_PHONE
		};
		const member: OnsitePerson = {
			firstName: 'มาลี',
			lastName: LAST_NAME,
			gender: 'female',
			nationalId: MEMBER_ID
		};

		const desk = await openAsShelterStaff(browser, registrar!, registrarSession!, shelterCode!);
		await stubThaid(desk, true, [
			thaidProfile(HEAD_ID, head.firstName, 'male'),
			thaidProfile(MEMBER_ID, member.firstName, 'female')
		]);
		await openNewRegistration(desk);
		const formUrl = desk.url();

		await test.step('head: typed phone survives, mistyped last name is overwritten', async () => {
			await desk.locator('#member-0-phone').fill(HEAD_PHONE);
			await desk.locator('#member-0-last-name').fill('นามสกุลผิด');
			await desk.getByRole('button', { name: 'เชื่อมต่อ ThaiD' }).click();
			await scanThaid(desk, `${head.firstName} ${LAST_NAME}`);

			expect(desk.url()).toBe(formUrl);
			await expect(desk.locator('#member-0-first-name')).toHaveValue(head.firstName);
			await expect(desk.locator('#member-0-last-name')).toHaveValue(LAST_NAME);
			await expect(desk.locator('#member-0-card-number')).toHaveValue(
				new RegExp(`^${HEAD_ID.split('').join('[- ]?')}$`)
			);
			await expect(desk.locator('#member-0-phone')).toHaveValue(HEAD_PHONE);
			await expect(desk.locator('#address-no')).toHaveValue(ADDRESS.address_no);
			await expect(desk.locator('#postal_code')).toHaveValue(ADDRESS.postal_code);
		});

		await test.step('head stays editable after the fill', async () => {
			await desk.locator('#member-0-last-name').fill(`${LAST_NAME}Edited`);
			await expect(desk.locator('#member-0-last-name')).toHaveValue(`${LAST_NAME}Edited`);
			// Restore so the saved head still matches `head` for the print/search checks.
			await desk.locator('#member-0-last-name').fill(LAST_NAME);
		});

		await test.step('member 2: scan fills only that row', async () => {
			await desk.getByRole('button', { name: 'เพิ่มสมาชิก' }).click();
			const card = desk.locator('#unified-member-1');
			await card.getByRole('button', { name: 'สแกน ThaiD' }).click();
			await scanThaid(desk, `${member.firstName} ${LAST_NAME}`);

			await expect(card.locator('#member-1-first-name')).toHaveValue(member.firstName);
			await expect(desk.locator('#member-0-first-name')).toHaveValue(head.firstName);
			await expect(desk.locator('#member-0-phone')).toHaveValue(HEAD_PHONE);
			// ThaiD returns no phone; the member has none either.
			await card.locator('#member-1-no-phone').click();
		});

		await test.step('save → evacuees carry the ThaiD national ids', async () => {
			await acceptFullConsent(desk);
			await desk.getByRole('button', { name: 'บันทึกลงทะเบียนทั้งครอบครัว' }).last().click();
			const confirmNew = desk.getByRole('alertdialog').getByRole('button', {
				name: 'ยืนยันลงทะเบียนใหม่',
				exact: true
			});
			const printHeading = desk.getByRole('heading', { name: 'ลงทะเบียนสำเร็จ' });
			await expect(confirmNew.or(printHeading)).toBeVisible({ timeout: 30_000 });
			if (await confirmNew.isVisible()) await confirmNew.click();

			await idsFromPrintScreen(desk, [head, member]);
			await finishPrintScreen(desk);
			// Station 1 search by national id finds each person → the id was saved.
			await expectStay(desk, head, STAY_STATUS.arriving);
			await expectStay(desk, member, STAY_STATUS.arriving);
		});
	});

	test('flag off → no ThaiD button for head or members', async ({ browser }) => {
		expect(shelterCode && registrar && registrarSession, 'provision must run first').toBeTruthy();
		const desk = await openAsShelterStaff(browser, registrar!, registrarSession!, shelterCode!);
		await stubThaid(desk, false);
		await openNewRegistration(desk);
		await desk.getByRole('button', { name: 'เพิ่มสมาชิก' }).click();
		await expect(desk.locator('#unified-member-1')).toBeVisible();

		await expect(desk.getByRole('button', { name: 'เชื่อมต่อ ThaiD' })).toHaveCount(0);
		await expect(desk.getByRole('button', { name: 'สแกน ThaiD' })).toHaveCount(0);
	});
});
