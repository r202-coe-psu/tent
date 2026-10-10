/**
 * J3 + J4 release gate — live Station 1 → 2 → 3 + scan check-in/out on an own `E2E` shelter.
 *
 * Creates the shelter through system-management UI, sets `enable_medical_screening` /
 * `accepts_pre_registration` and a living zone on **that** shelter only (never SH001 /
 * `config:app`), then drives real station roles:
 *   - registration_staff → Station 1 register + QR, Station 3 zoning, scan
 *   - shelter_manager → Station 2 medical screening
 *
 * Teardown: ledger (`recordCreatedShelter`) + `teardownShelter` + Couch user delete;
 * final zero-leak asserts the shelter DB and registry row are gone.
 *
 * Tags: `@onsite` + `@critical` + `@release`. Runs locally or on a remote target
 * with `ALLOW_REMOTE_WRITES=true` (staging); read-only remote otherwise.
 *
 * Local: `docker compose up -d`, `pnpm seed:master`, build with `PUBLIC_COUCH_PROXY=/couch`,
 * then preview on a free port (not :5173) and:
 *   PLAYWRIGHT_TEST_BASE_URL=http://localhost:4191 pnpm exec playwright test \
 *     e2e/onsite-stations-flow.test.ts --grep @release
 */
import { createRequire } from 'node:module';
import { test, expect, type Browser } from '@playwright/test';
import {
	bootstrapAdminSession,
	couchLogin,
	couchReq,
	createCouchUser,
	deleteCouchUser,
	registrationStaffRoles,
	seedSecurityQuestion,
	shelterManagerRoles,
	type TestUser
} from './helpers/couch';
import { CAN_WRITE, LOCAL_RUN_ID as RUN_ID, READ_ONLY_REASON } from './helpers/e2e-env';
import { injectSession, routeBrowserCouchThroughApp } from './helpers/login';
import {
	checkInByScan,
	checkOutByScan,
	confirmArrivalInZone,
	expectStay,
	fillMemberCard,
	fillWalkInAddress,
	finishPrintScreen,
	idsFromPrintScreen,
	openAsShelterStaff,
	screenEvacuee,
	searchStation1,
	STAY_STATUS,
	type OnsitePerson
} from './helpers/onsite';
import { fictitiousNationalId, fictitiousPhone } from './helpers/pre-register';
import { purgeCreatedData, recordCreatedShelter, teardownShelter } from './helpers/public-cleanup';
import {
	configureOnsiteShelterViaUi,
	createShelterViaUi,
	pinActiveShelter
} from './helpers/staff-ui';

// html5-qrcode must resolve at load (QR decode) — fail `--list` early if missing.
createRequire(import.meta.url).resolve('html5-qrcode/html5-qrcode.min.js');

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 15_000 });

const SHELTER_NAME = `E2E Onsite ${RUN_ID}`;
const ZONE_NAME = 'โซนทดสอบ E2E';
const ZONE_CODE = 'Z1';
const LAST_NAME = `Onsite${RUN_ID}`;
const HEAD_ID = fictitiousNationalId(Number.parseInt(RUN_ID, 36) % 1e11);
const MEMBER_ID = fictitiousNationalId((Number.parseInt(RUN_ID, 36) + 3) % 1e11);
const HEAD_PHONE = fictitiousPhone();

let shelterCode: string | undefined;
let registrar: TestUser | undefined;
let medic: TestUser | undefined;
let registrarSession: string | undefined;
let medicSession: string | undefined;
let liveWritesStarted = false;

async function ensureStaff(code: string): Promise<void> {
	if (registrar && medic && registrarSession && medicSession) return;
	registrar = {
		name: `onsite_reg_${RUN_ID}`,
		password: 'Password1!',
		roles: registrationStaffRoles(code),
		display_name: 'Onsite Registrar E2E'
	};
	medic = {
		name: `onsite_med_${RUN_ID}`,
		password: 'Password1!',
		roles: shelterManagerRoles(code),
		display_name: 'Onsite Medic E2E'
	};
	await createCouchUser(registrar);
	await seedSecurityQuestion(registrar.name);
	await createCouchUser(medic);
	await seedSecurityQuestion(medic.name);
	registrarSession = await couchLogin(registrar.name, registrar.password);
	medicSession = await couchLogin(medic.name, medic.password);
}

test.afterAll(async () => {
	test.setTimeout(180_000);
	if (!CAN_WRITE || !liveWritesStarted) return;
	if (shelterCode) {
		await teardownShelter(shelterCode).catch(() => undefined);
		shelterCode = undefined;
	}
	await purgeCreatedData(LAST_NAME);
	if (registrar) await deleteCouchUser(registrar.name).catch(() => undefined);
	if (medic) await deleteCouchUser(medic.name).catch(() => undefined);
});

test.describe(
	'Onsite stations J3+J4 (own E2E shelter)',
	{ tag: ['@onsite', '@critical', '@release'] },
	() => {
		test.beforeEach(() => {
			test.skip(!CAN_WRITE, READ_ONLY_REASON);
		});

		test('provision E2E shelter with medical screening + zone', async ({ page }) => {
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
				capacity: 40,
				acceptsPreRegistration: true
			});
			recordCreatedShelter(shelterCode);

			await configureOnsiteShelterViaUi(page, shelterCode, {
				enableMedicalScreening: true,
				acceptsPreRegistration: true,
				zones: [{ name: ZONE_NAME, capacity: 20 }]
			});

			await ensureStaff(shelterCode);
			await pinActiveShelter(page, shelterCode);
		});

		test('Station 1 register → QR → Station 2 → Station 3 → scan out/in', async ({
			browser
		}: {
			browser: Browser;
		}) => {
			test.setTimeout(300_000);
			expect(shelterCode, 'previous test must mint a shelter').toBeTruthy();
			await ensureStaff(shelterCode!);
			expect(registrar && medic && registrarSession && medicSession).toBeTruthy();

			const head: OnsitePerson = {
				firstName: 'Somchai',
				lastName: LAST_NAME,
				gender: 'male',
				nationalId: HEAD_ID,
				phone: HEAD_PHONE,
				age: '45'
			};
			const member: OnsitePerson = {
				firstName: 'Malee',
				lastName: LAST_NAME,
				gender: 'female',
				nationalId: MEMBER_ID,
				age: '42'
			};
			const people = [head, member];
			const addressNo = `88/${RUN_ID.slice(-4) || '1'}`;

			const desk = await openAsShelterStaff(browser, registrar!, registrarSession!, shelterCode!);
			const clinic = await openAsShelterStaff(browser, medic!, medicSession!, shelterCode!);
			const ids: Record<string, string> = {};

			await test.step('Station 1: search finds nothing → walk-in form', async () => {
				await searchStation1(desk, head.nationalId);
				await expect(desk.getByRole('heading', { name: 'ไม่พบรายการ' })).toBeVisible({
					timeout: 15_000
				});
				await desk.getByRole('link', { name: '+ ลงทะเบียนใหม่' }).click();
				await expect(desk).toHaveURL(/\/onsite\/people\/new/);
				await expect(desk.getByRole('heading', { name: 'ลงทะเบียนครอบครัว' })).toBeVisible();
			});

			await test.step('Station 1: register household (2 members)', async () => {
				await fillWalkInAddress(desk, addressNo, 'หมู่ 1');
				await expect(desk.locator('#postal_code')).not.toHaveValue('');
				await fillMemberCard(desk, 0, head);
				await desk.getByRole('button', { name: 'เพิ่มสมาชิก' }).click();
				await fillMemberCard(desk, 1, member);
				await desk.getByRole('button', { name: 'บันทึกลงทะเบียนทั้งครอบครัว' }).last().click();

				const confirmNew = desk.getByRole('alertdialog').getByRole('button', {
					name: 'ยืนยันลงทะเบียนใหม่',
					exact: true
				});
				const printHeading = desk.getByRole('heading', { name: 'ลงทะเบียนสำเร็จ' });
				await expect(confirmNew.or(printHeading)).toBeVisible({ timeout: 30_000 });
				if (await confirmNew.isVisible()) await confirmNew.click();
			});

			await test.step('Station 1: Person QR print carries evacuee ids', async () => {
				Object.assign(ids, await idsFromPrintScreen(desk, people));
				await finishPrintScreen(desk);
				await expectStay(desk, head, STAY_STATUS.arriving);
				await expectStay(desk, member, STAY_STATUS.arriving);
			});

			await test.step('Station 2: shelter_manager screens both members', async () => {
				await screenEvacuee(clinic, ids[head.firstName], {
					careTrack: 'normal',
					conditions: 'ไม่มี',
					medications: '',
					allergies: ''
				});
				await screenEvacuee(clinic, ids[member.firstName], {
					conditions: 'ไม่มี'
				});
			});

			await test.step('Station 3: zone both (companion), confirm arrival', async () => {
				await desk.goto(`/onsite/zoning/${ids[head.firstName]}`);
				await expect(desk.getByText('Station 3', { exact: true })).toBeVisible({ timeout: 20_000 });
				await desk.locator('div.grid button', { hasText: ZONE_NAME }).first().click();
				const companion = desk.getByRole('checkbox').first();
				if (await companion.isVisible().catch(() => false)) await companion.click();
				await desk.getByRole('button', { name: 'จัดเข้าโซน (รอยืนยันถึงโซน)' }).click();
				await expect(desk).toHaveURL(/\/onsite\/zoning$/, { timeout: 20_000 });
				await expectStay(desk, head, STAY_STATUS.active, ZONE_NAME);
				await expectStay(desk, member, STAY_STATUS.active, ZONE_NAME);

				await desk.goto(`/onsite/zoning/${ids[head.firstName]}`);
				await expect(desk.getByText('Station 3', { exact: true })).toBeVisible({ timeout: 20_000 });
				await desk.waitForLoadState('networkidle');
				const confirmHousehold = desk.getByRole('button', { name: 'ยืนยันทั้งครัวเรือน' });
				if (await confirmHousehold.isVisible().catch(() => false)) {
					await confirmHousehold.click();
					await expect(desk.getByText(/ยืนยันถึงโซนทั้งครัวเรือน/)).toBeVisible({
						timeout: 15_000
					});
				} else {
					await confirmArrivalInZone(desk, ids[head.firstName]);
					await confirmArrivalInZone(desk, ids[member.firstName]);
				}
				await expectStay(desk, head, STAY_STATUS.roomConfirmed, ZONE_NAME);
				await expectStay(desk, member, STAY_STATUS.roomConfirmed, ZONE_NAME);
			});

			await test.step('Scan: check head OUT then IN with Person QR payload', async () => {
				const others = [member.firstName];
				await checkOutByScan(desk, ids[head.firstName], others, 'ออกไปธุระนอกพื้นที่');
				await expectStay(desk, head, STAY_STATUS.checkedOut);
				await expectStay(desk, member, STAY_STATUS.roomConfirmed);

				await checkInByScan(desk, ids[head.firstName], others, ZONE_CODE);
				await expectStay(desk, head, STAY_STATUS.active, ZONE_NAME);
			});

			await desk.context().close();
			await clinic.context().close();
		});

		test('Z teardown leaves no E2E shelter or staff of this run', async () => {
			test.setTimeout(240_000);
			const code = shelterCode;
			const created = await purgeCreatedData(LAST_NAME);
			if (code && !created.shelters.includes(code)) {
				await teardownShelter(code);
				created.shelters.push(code);
			}
			shelterCode = undefined;

			for (const c of created.shelters) {
				expect((await couchReq('GET', `/shelter_${c.toLowerCase()}`)).status).toBe(404);
				const byCode = await couchReq(
					'GET',
					`/registry/_design/app/_view/by_code?key=${encodeURIComponent(JSON.stringify(c))}`
				);
				expect((byCode.data as { rows: unknown[] }).rows).toEqual([]);
			}

			if (registrar) {
				await deleteCouchUser(registrar.name);
				registrar = undefined;
			}
			if (medic) {
				await deleteCouchUser(medic.name);
				medic = undefined;
			}
		});
	}
);
