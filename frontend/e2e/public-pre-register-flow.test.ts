/**
 * Public pre-register (`/` → `/pre-register` → QR ticket) — true end-to-end, no seeding.
 *
 * The mocked suite (`public-register.test.ts`) fakes every API, so it cannot see the
 * BFF → FastAPI → Mongo/Couch seams (that is how BUG-01 — the central-queue ticket being
 * deleted from the device on the first status sync — got through). This suite drives the
 * real stack and additionally proves the page *renders and validates* everything it should:
 * every section and field is present and usable, and every validation error really appears.
 *
 * Local target: the write scenarios (W*) register through the public form, read the stored
 * data back, and afterAll removes everything they created — queue documents through the
 * system-admin API and the `E2E …` shelter of W5 through `teardownShelter` — then asserts
 * nothing carrying this run's id is left in the queue or CouchDB (zero-leak, like
 * `stock-inventory.test.ts`).
 * Remote target (`E2E_BASE_URL`, staging/production, `playwright.public.config.ts`): read-only
 * by default — the W* group is skipped; the navigation / render / validation / responsive
 * groups run (they never POST: the server-error cases mock the write endpoint). With
 * `ALLOW_REMOTE_WRITES=true` (staging only), the W* group runs the same live writes +
 * zero-leak teardown as local, against that remote target's own CouchDB.
 *
 * Local requirements: the full local stack — `docker compose up -d` (CouchDB, MongoDB, sync
 * worker, FastAPI :9000; set `E2E_FASTAPI_URL` if FastAPI is elsewhere) plus platform init
 * (`pnpm seed:master`, `pnpm db:sync`). W5 (shelter booking) also needs the app to run with
 * `COUCHDB_PUBLIC_WRITER_URL` (the limited `public_writer` CouchDB user — see `.env.example`;
 * `pnpm seed:master` provisions it) and is skipped without it. Run with
 * `pnpm test:e2e:pre-register` (builds with `--mode test`, then plays this file plus the
 * mocked `public-register.test.ts`). ARIA and screenshot baselines live next to this file in
 * `public-pre-register-flow.test.ts-snapshots/`; refresh with `--update-snapshots`.
 * The FastAPI behind the app must expose `GET /public/v1/unassigned-registrations/{id}/status`
 * (PR #391) — W2/W3 fail against an older backend, which is exactly what they guard.
 *
 * ── Tags (Playwright `{ tag }`, select with `--grep`) ─────────────────────────────────────
 *  @pre-register  feature tag — every test in this file and in `public-register.test.ts`
 *  @smoke         read-only, safe on staging / production (never writes; server-error cases
 *                 mock the write endpoint): N, R, V, E, S, U. Run on pre-push, the PR gate and
 *                 against staging (`pnpm test:e2e:pre-register:smoke`); kept when `IS_REMOTE`
 *  @critical      writes real data and asserts zero leak afterwards: W1–W6 and Z. Runs
 *                 locally or on a remote target with `ALLOW_REMOTE_WRITES=true` (staging);
 *                 read-only remote otherwise; also run on the PR gate / nightly
 *  @release       release-gate journey only: navigation (N) + critical happy paths (W*) +
 *                 zero-leak (Z). Not on the error-matrix / render / server-error rows.
 *  @regression    the fully mocked suite `public-register.test.ts` (no backend needed);
 *                 run on the PR gate / nightly (`pnpm test:e2e:regression`)
 *  Each test carries exactly one of @smoke / @critical / @regression.
 *
 * ── Scenarios ────────────────────────────────────────────────────────────────────────────
 *  N1  landing page links to /pre-register (3 places), hero CTA → ?shelter=unassigned, title
 *  N2  shelter dropdown: "ไม่ระบุศูนย์พักพิง" always; closed / not-accepting shelters never
 *  R1–R6 render contract (below)   V1–V3 gate, one-pass validation, province cascade
 *  E01–E24 error matrix (below)    S1–S6 server / page-level errors   U1–U3 layout, i18n
 *  W1  unassigned + full family → real POST 201 → QR + name + "2 คน"
 *  W2  ticket survives the history tab + reload (BUG-01 regression)
 *  W3  BFF /registrations/status for W1's code → verified:false, status:'open', no notFound
 *  W4  same identity again → 409 DUPLICATE_OPEN_IDENTITY + toast, form data kept
 *  W5  shelter booking (own `E2E …` shelter) → ticket + QR, survives reload   W6 read-back
 *
 * ── Render contract (C2.1) ───────────────────────────────────────────────────────────────
 *  R1 page skeleton (H1, QR guidance, shelter section + warning, live summary, 4 sections,
 *     both submit buttons, both tabs)
 *  R2 every control visible + enabled with its label bound (`getByLabel`) — address, primary
 *     contact, emergency / vulnerable / special-needs accordions, pets, consent, member 2
 *  R3 dropdowns open with real options (housing 5, province from the API, religion, card type)
 *  R4 ARIA snapshots of <main>: empty form, all-errors form, queue ticket
 *  R5 screenshots 1440 / 390 of the empty and the all-errors form
 *  R6 no pageerror / console error / warning / HTTP >= 400 while loading and filling
 *
 * ── Error matrix (C2.2) ──────────────────────────────────────────────────────────────────
 *  Each row is asserted for: (1) the literal message under the field, (2) aria-invalid on
 *  the field with aria-describedby pointing at that message, (3) the message in the
 *  "ตรวจสอบข้อมูลก่อนบันทึก" summary and the jump button moving keyboard focus into the first
 *  invalid control, (4) no POST.
 *
 *  id   message (literal)                                         trigger                              field (focus)
 *  E01  กรุณากรอกบ้านเลขที่ จังหวัด อำเภอ และตำบล                  no house no. / province / …           #address-no
 *  E02  กรุณากรอกชื่อ                                              first name empty                     #member-0-first-name
 *  E03  (no error — gender optional, ไม่ระบุ preselected)         no gender picked → payload gender:null  see "Gender is optional" below
 *  E04  เลขบัตรประชาชนไม่ถูกต้อง (ตรวจสอบหลักสุดท้ายอีกครั้ง)       13 digits, wrong checksum            #member-0-card-number
 *  E05  เลขประจำตัวประชาชนต้องมี 13 หลัก                           12 digits                            #member-0-card-number
 *  E06  กรุณากรอกเบอร์โทรศัพท์ 10 หลักของผู้ติดต่อหลัก              head phone empty                     #member-0-phone
 *  E07  (same as E06)                                             head phone "0812"                    #member-0-phone
 *  E08  กรุณากรอกเบอร์ติดต่อฉุกเฉินให้ครบ 10 หลัก                   emergency phone "12"                 #emergency-phone
 *  E09  กรุณากรอกชื่อ-นามสกุลผู้ติดต่อฉุกเฉิน                      emergency phone+relation, no name    #emergency-name
 *  E10  กรุณาระบุความสัมพันธ์ของผู้ติดต่อฉุกเฉิน                    emergency name+phone, no relation    #emergency-relation
 *  E11  กรุณากรอกปีเกิด 4 หลัก                                     birth year "254"                     #member-0-birth-year
 *  E12  ปีเกิด (พ.ศ.) ต้องอยู่ระหว่าง <min>–<max>                  birth year 2300 (พ.ศ.)               #member-0-birth-year
 *  E13  ปีเกิด (ค.ศ.) ต้องอยู่ระหว่าง <min>–<max> (summary: พ.ศ.)   ค.ศ. toggle, birth year 1700        #member-0-birth-year
 *  E14  อายุต้องไม่เกิน 150 ปี                                     age "151"                            #member-0-age
 *  E15  กรุณาระบุศาสนา                                             religion อื่นๆ (ระบุ), text empty    #member-0-religion-other
 *  E16  กรุณากรอกชื่อ (card สมาชิก 2)                              member 2 added, left blank           #member-1-first-name
 *  E17  (no error — gender optional, ไม่ระบุ preselected)         member 2 named, no gender → gender:null  see "Gender is optional" below
 *  E18  กรุณาระบุชนิดสัตว์เมื่อเลือกอื่นๆ                           "เพิ่มสัตว์อื่นๆ", species empty     species input (pets)
 *  E19  กรุณากรอกชื่อหอพัก                                         housing = หอพัก, name empty          #dorm-name
 *  E20  กรุณากรอกเลขห้อง                                           housing = หอพัก, room empty          #dorm-room
 *  E21  ที่พักแบบไร้บ้านเลขที่ต้องมีจุดสังเกตหรือที่ตั้งครบ         housing = ไร้ที่อยู่, no landmark/area #residence-landmark
 *  E22  ลงทะเบียนได้สูงสุด 20 คนต่อครั้ง                           21 member cards                      add-member button
 *  E23  เบอร์โทรไม่ถูกต้อง — ต้องขึ้นต้นด้วย 0 และมี 9–10 หลัก …    family-search phone, on blur         family-search input
 *  E24  กรุณากรอกเบอร์ให้ครบ 10 หลัก หรือเว้นว่าง / เลือกไม่มีเบอร์   joined family (mock), head phone "12" #member-0-phone
 *  Gates (not field errors): consent unchecked → both submit buttons disabled (V1); pets
 *  capped at 10 (S5); shelter not bookable (S2) / reCAPTCHA failure (S3) / shelter safety
 *  consent (S4) surface as a banner or toast.
 *  Not reachable from the UI: "อายุไม่ตรงกับปีเกิด" (age and birth year auto-sync, so they
 *  can never disagree — covered by the domain unit tests) and the unassigned-consent toast
 *  (the submit button is disabled instead).
 *  Fix-as-you-type: after the first failed submit a field loses its error (aria-invalid, the
 *  message and its line in the summary) the moment its value is valid; the others stay and no
 *  field shows an error before the first submit.
 */
import {
	test as base,
	expect,
	type BrowserContext,
	type Locator,
	type Page
} from '@playwright/test';
import { bootstrapAdminSession, couchReq } from './helpers/couch';
import {
	CAN_WRITE as TARGET_CAN_WRITE,
	IS_REMOTE,
	LOCAL_RUN_ID as RUN_ID,
	READ_ONLY_REASON as TARGET_READ_ONLY_REASON
} from './helpers/e2e-env';
import { injectSession, routeBrowserCouchThroughApp } from './helpers/login';
import {
	DISCLAIMER_LABEL,
	JUMP_BUTTON,
	PRE_REGISTER_PATH,
	SUBMIT_LABEL,
	UNASSIGNED_OPTION,
	acceptDisclaimer,
	chooseShelter,
	expectHealthy,
	fictitiousNationalId,
	fictitiousPhone,
	fillAddress,
	fillEmergencyContact,
	fillMember,
	memberCard,
	mockSystemBanner,
	openMemberAccordion,
	openPets,
	openPreRegister,
	pickSearchSelect,
	primaryCard,
	shelterTrigger,
	submitButton,
	summaryAlert,
	watchPage,
	withBrokenChecksum,
	type MemberInput,
	type PageHealth
} from './helpers/pre-register';
import {
	getUnassignedRegistration,
	listUnassignedRegistrations,
	purgeCreatedData,
	recordCreatedQueueId,
	recordCreatedShelter,
	waitForProjection
} from './helpers/public-cleanup';
import { createShelterViaUi, setRecaptcha } from './helpers/staff-ui';

// ------------------------------------------------------------------ fixtures

/**
 * Every test collects `pageerror` + console error/warning and asserts the list is empty at
 * the end (covers OBS-05). Tests that provoke a failing request on purpose declare the
 * console noise that comes with it via `health.allow(...)`.
 */
const test = base.extend<{ health: PageHealth & { allow(...patterns: RegExp[]): void } }>({
	health: [
		async ({ page }, use) => {
			const base = watchPage(page);
			const allowed: RegExp[] = [];
			await use(
				Object.assign(base, {
					allow: (...patterns: RegExp[]) => void allowed.push(...patterns)
				})
			);
			const unexpected = base.problems.filter((p) => !allowed.some((re) => re.test(p)));
			expect(unexpected, `console / page errors:\n${unexpected.join('\n')}`).toEqual([]);
		},
		{ auto: true }
	]
});

const NO_BANNER = async (page: Page) => mockSystemBanner(page, false);

/**
 * ThaiD is not under test here and its flag differs per environment (staging: ON, local: OFF).
 * The render-contract snapshots (R4 / R5) mock it OFF so they never depend on that flag.
 */
const NO_THAID = async (page: Page) =>
	page.route('**/api/public/v1/thaid/status', (route) =>
		route.fulfill({ json: { enabled: false, isDev: false, mode: 'real' } })
	);

/**
 * Teardown (`purgeCreatedData`) lists and deletes central-queue documents through FastAPI's
 * staff routes, which have no browser-facing BFF. On a remote target they are reachable only
 * through `E2E_FASTAPI_URL` (staging: `https://<host>/public-api`); without it every write here
 * would leave data behind, so the live-write groups stay read-only instead.
 */
const CAN_WRITE = TARGET_CAN_WRITE && (!IS_REMOTE || Boolean(process.env.E2E_FASTAPI_URL));
const READ_ONLY_REASON = TARGET_CAN_WRITE
	? 'E2E_FASTAPI_URL is not set — teardown cannot reach the central queue on this target'
	: TARGET_READ_ONLY_REASON;

/** Identity of this run — the last name carries the run id so teardown can find it. */
const LAST_NAME = `ทดสอบ${RUN_ID}`;
const HEAD_ID = fictitiousNationalId(Number.parseInt(RUN_ID, 36) % 1e11);
const MEMBER2_ID = fictitiousNationalId((Number.parseInt(RUN_ID, 36) + 1) % 1e11);
const HEAD_PHONE = fictitiousPhone();
const EMERGENCY_PHONE = fictitiousPhone(7);

const createdQueueIds = new Set<string>();
let shelterCode: string | undefined;
/** Set once a W test starts writing, so read-only / mocked runs never need the admin APIs. */
let liveWritesStarted = false;

/** Everything the run created is gone — queue documents, and the W5 shelter in CouchDB. */
test.afterAll(async () => {
	test.setTimeout(180_000);
	if (!CAN_WRITE || !liveWritesStarted) return;
	await purgeCreatedData(LAST_NAME, createdQueueIds);
});

// =============================================================== N — navigation

test.describe(
	'Pre-register: navigation (N)',
	{ tag: ['@pre-register', '@smoke', '@release', '@prod'] },
	() => {
		test('N1 the landing page links to /pre-register and the hero CTA opens the central queue', async ({
			page
		}) => {
			await page.goto('/');
			const links = page.locator('a[href="/pre-register"]');
			// navbar compact button + navbar full nav + hero CTA
			await expect(links).toHaveCount(3);
			await expect(links.filter({ visible: true })).toHaveCount(2);

			await page.getByRole('link', { name: 'ลงทะเบียนผู้ประสบภัยล่วงหน้า' }).click();
			// The booking form pins the default (central queue) in the URL once it mounts.
			await expect(page).toHaveURL(/\/pre-register\?shelter=unassigned$/);
			await expect(page).toHaveTitle('ลงทะเบียนล่วงหน้า | SmartShelter');
			await expect(
				page.getByRole('heading', { name: 'ลงทะเบียนล่วงหน้า', level: 1 })
			).toBeVisible();

			await page.goto('/');
			await page.getByRole('link', { name: 'ลงทะเบียนล่วงหน้า', exact: true }).click();
			await expect(page).toHaveURL(/\/pre-register/);
		});

		test('N2 the shelter dropdown always offers the queue and never a closed / non-accepting shelter', async ({
			page
		}) => {
			const res = await page.request.get('/api/public/v1/shelters');
			expect(res.ok()).toBe(true);
			const { shelters } = (await res.json()) as {
				shelters: {
					code: string;
					name: string;
					status: string;
					accepts_pre_registration?: boolean;
				}[];
			};
			const bookable = shelters.filter(
				(s) => s.status.toLowerCase() !== 'closed' && s.accepts_pre_registration === true
			);
			const hidden = shelters.filter((s) => !bookable.includes(s));

			await openPreRegister(page);
			await shelterTrigger(page).click();
			const options = page.getByRole('option');
			// An option reads "<name>[ (เต็ม)][ <capacity>]": anchor the name at the start and
			// require a word boundary after it, so "ทดสอบ" never matches "ศูนย์อพยพทดสอบ".
			const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			const optionNamed = (name: string) => new RegExp(`^\\s*${escapeRegExp(name)}(?=\\s|\\(|$)`);
			await expect(options).toHaveCount(1 + bookable.length);
			await expect(options.filter({ hasText: UNASSIGNED_OPTION })).toHaveCount(1);
			for (const s of bookable)
				await expect(options.filter({ hasText: optionNamed(s.name) })).toHaveCount(1);
			for (const s of hidden)
				await expect(options.filter({ hasText: optionNamed(s.name) })).toHaveCount(0);
		});
	}
);

// =============================================================== R — render contract

test.describe('Pre-register: render contract (R)', { tag: ['@pre-register', '@smoke'] }, () => {
	test('R1 the page skeleton is fully rendered', async ({ page }) => {
		await NO_BANNER(page);
		await openPreRegister(page);

		await expect(page.getByRole('heading', { name: 'ลงทะเบียนล่วงหน้า', level: 1 })).toBeVisible();
		await expect(page.getByText('💡 ลงทะเบียนล่วงหน้าเพื่อความสะดวกและรวดเร็ว')).toBeVisible();
		await expect(
			page.getByText(
				'- เมื่อลงทะเบียนเรียบร้อยแล้ว ท่านสามารถแจ้งเบอร์โทรศัพท์หรือแสดง QR Code ต่อเจ้าหน้าที่ลงทะเบียนประจำศูนย์ เพื่อยืนยันการเข้าพักได้ทันที'
			)
		).toBeVisible();
		await expect(
			page.getByText(
				'- การลงทะเบียนล่วงหน้าเป็นเพียงการบันทึกข้อมูลเข้าสู่ระบบเพื่อความสะดวกและลดขั้นตอนเท่านั้น ไม่ได้เป็นการยืนยันสิทธิ์หรือการันตีการเข้าพัก'
			)
		).toBeVisible();
		await expect(page.getByRole('link', { name: 'กลับหน้าหลัก' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'ลงทะเบียนใหม่' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'ใบลงทะเบียนของฉัน' })).toBeVisible();

		// shelter section + always-visible note box
		await expect(
			page.getByRole('heading', { name: 'ศูนย์พักพิงที่ต้องการเข้าพัก', level: 3 })
		).toBeVisible();
		await expect(shelterTrigger(page)).toContainText('ไม่ระบุศูนย์พักพิง');
		await expect(page.getByText('หมายเหตุ', { exact: true })).toBeVisible();
		await expect(
			page.getByText(
				'หากไม่พบศูนย์พักพิง ที่ต้องการเข้าพักให้เลือกไม่ระบุศูนย์พักพิงไว้ก่อน เนื่องจากศูนย์ของท่านไม่เปิดให้ลงทะเบียนล่วงหน้า'
			)
		).toBeVisible();

		// summary card (desktop aside): present with heading, but without "Live Summary" badge
		const aside = page.getByRole('complementary');
		await expect(aside).toBeVisible();
		await expect(aside).toContainText('สรุปข้อมูลการลงทะเบียน');
		await expect(aside.getByText('Live Summary')).toHaveCount(0);

		// the four sections
		await expect(page.getByRole('heading', { name: 'ข้อมูลที่อยู่อาศัย', level: 2 })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'สมาชิกในครอบครัว', level: 2 })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'สัตว์เลี้ยง', level: 2 })).toBeVisible();
		await expect(
			page.getByRole('heading', { name: 'เงื่อนไขการใช้งานระบบลงทะเบียนล่วงหน้า', level: 4 })
		).toBeVisible();
		await expect(page.getByRole('checkbox', { name: DISCLAIMER_LABEL })).toBeVisible();

		// submit button in the bottom bar, repeated once in the summary aside
		await expect(page.getByRole('button', { name: SUBMIT_LABEL })).toHaveCount(2);
		await expect(submitButton(page)).toBeVisible();
	});

	test('R2 every address and primary-contact control is rendered, enabled and labelled', async ({
		page
	}) => {
		await NO_BANNER(page);
		await openPreRegister(page);

		// [selector, accessible label] — `getByLabel` must resolve to the very same element.
		const addressControls: [string, string][] = [
			['#housing-type', 'ประเภทที่อยู่อาศัย'],
			['#residence-landmark', 'จุดสังเกตที่อยู่'],
			['#address-no', 'บ้านเลขที่ *'],
			['#village-no', 'หมู่ที่ / ตรอก / ซอย / ถนน'],
			['#province', 'จังหวัด *']
		];
		for (const [selector, label] of addressControls) {
			const control = page.locator(selector);
			await expect(control, selector).toBeVisible();
			await expect(control, selector).toBeEnabled();
			await expect(page.getByLabel(label, { exact: true }), `label ${label}`).toHaveAttribute(
				'id',
				selector.slice(1)
			);
		}
		// district / subdistrict wait for their parent; the postal code is read-only by design
		await expect(page.locator('#district')).toBeDisabled();
		await expect(page.locator('#subdistrict')).toBeDisabled();
		await expect(page.locator('#postal_code')).toBeDisabled();
		await expect(page.getByLabel('รหัสไปรษณีย์ *', { exact: true })).toHaveAttribute(
			'id',
			'postal_code'
		);
		await pickSearchSelect(page, 'province', 'สงขลา');
		await expect(page.locator('#district')).toBeEnabled();
		await expect(page.getByLabel('อำเภอ / เขต *', { exact: true })).toHaveAttribute(
			'id',
			'district'
		);
		await pickSearchSelect(page, 'district', 'หาดใหญ่');
		await expect(page.locator('#subdistrict')).toBeEnabled();
		await expect(page.getByLabel('ตำบล / แขวง *', { exact: true })).toHaveAttribute(
			'id',
			'subdistrict'
		);
		await expect(page.getByRole('button', { name: 'ใช้ตำแหน่งปัจจุบัน' })).toBeEnabled();
		await expect(
			page.getByRole('textbox', {
				name: 'ค้นหาครอบครัวด้วยเบอร์โทรศัพท์ (เพื่อเข้าร่วมบ้านเดิม)'
			})
		).toBeEnabled();

		// primary contact
		const card = primaryCard(page);
		await expect(card.getByRole('heading', { name: 'ผู้ติดต่อหลัก', level: 3 })).toBeVisible();
		// Public channel omits nickname (`showNickname={channel !== 'public'}`).
		await expect(page.locator('#member-0-nickname')).toHaveCount(0);
		const memberControls: [string, string][] = [
			['#member-0-first-name', 'ชื่อ *'],
			['#member-0-last-name', 'นามสกุล'],
			['#member-0-card-number', 'เลขที่บัตรประจำตัว'],
			['#member-0-birth-year', 'ปีเกิด (พ.ศ.)'],
			['#member-0-age', 'อายุ (ปี)'],
			['#member-0-country', 'สัญชาติ *'],
			['#member-0-phone', 'เบอร์โทรศัพท์ *']
		];
		for (const [selector, label] of memberControls) {
			const control = card.locator(selector);
			await expect(control, selector).toBeVisible();
			await expect(control, selector).toBeEnabled();
			await expect(card.getByLabel(label, { exact: true }), `label ${label}`).toHaveAttribute(
				'id',
				selector.slice(1)
			);
		}
		await expect(card.getByRole('radio', { name: 'ชาย' })).toHaveAttribute(
			'id',
			'member-0-gender-male'
		);
		await expect(card.getByRole('radio', { name: 'หญิง' })).toHaveAttribute(
			'id',
			'member-0-gender-female'
		);
		await expect(card.getByRole('radio', { name: 'ชาย' })).toBeEnabled();
		await expect(card.getByRole('radio', { name: 'หญิง' })).toBeEnabled();
		await expect(card.getByRole('radiogroup', { name: /เพศ/ })).toBeVisible();
		await expect(card.getByRole('button', { name: 'เลขประจำตัวประชาชน' })).toBeEnabled();
		await expect(
			card.getByRole('button', { name: 'ศาสนา' }).or(card.getByText('ศาสนา'))
		).toBeVisible();
		await expect(
			card.getByRole('group', { name: 'สลับปฏิทินปีเกิด' }).getByRole('button')
		).toHaveText(['พ.ศ.', 'ค.ศ.']);
		// the public head of family must give a phone: no "no phone" opt-out
		await expect(page.locator('#member-0-no-phone')).toHaveCount(0);
	});

	test('R2 the emergency, vulnerable-group and special-needs accordions expose every option', async ({
		page
	}) => {
		await NO_BANNER(page);
		await openPreRegister(page);
		const card = primaryCard(page);

		await openMemberAccordion(card, 'ผู้ติดต่อฉุกเฉิน');
		for (const [selector, label] of [
			['#emergency-name', 'ชื่อผู้ติดต่อ'],
			['#emergency-phone', 'เบอร์โทรศัพท์'],
			['#emergency-relation', 'ความสัมพันธ์']
		]) {
			await expect(page.locator(selector), selector).toBeVisible();
			await expect(page.locator(selector), selector).toBeEnabled();
			await expect(card.getByLabel(label, { exact: true }).last(), label).toHaveAttribute(
				'id',
				selector.slice(1)
			);
		}

		await openMemberAccordion(card, 'กลุ่มเปราะบาง');
		const groups: [string, string][] = [
			['bedridden', 'ผู้ป่วยติดเตียง'],
			['dialysis', 'ผู้ป่วยฟอกไต'],
			['wheelchair', 'ผู้ใช้วีลแชร์'],
			['psychiatric', 'ผู้ป่วยจิตเวช'],
			['elderly_dependent', 'ผู้สูงอายุช่วยเหลือตัวเองไม่ได้'],
			['infant', 'ทารก'],
			['young_child', 'เด็กเล็ก'],
			['pregnant', 'สตรีมีครรภ์'],
			['vision_impaired', 'ผู้พิการทางการมองเห็น'],
			['hearing_impaired', 'ผู้พิการทางการได้ยิน'],
			['disability_other', 'ผู้พิการ (อื่นๆ / ไม่ระบุรายละเอียด)'],
			['chronic_illness', 'ผู้มีโรคประจำตัว/เรื้อรัง']
		];
		for (const [code, label] of groups) {
			const box = page.locator(`#vg-0-${code}`);
			await expect(box, code).toBeVisible();
			await expect(box, code).toBeEnabled();
			await expect(card.getByRole('checkbox', { name: label, exact: true }), label).toHaveAttribute(
				'id',
				`vg-0-${code}`
			);
		}
		await expect(card.locator('[id^="vg-0-"][role="checkbox"]')).toHaveCount(12);
		await page.locator('#vg-0-disability_other').click();
		await expect(page.locator('#vg-0-disability-detail')).toBeVisible();

		await openMemberAccordion(card, 'ความต้องการพิเศษ');
		for (const need of [
			'ใช้วีลแชร์',
			'ผู้ป่วยติดเตียง',
			'ใช้ออกซิเจน',
			'หญิงตั้งครรภ์',
			'ทารก/เด็กเล็ก',
			'ผู้พิการทางการมองเห็น',
			'ผู้พิการทางการได้ยิน',
			'มีภาวะพึ่งพิงสูง'
		]) {
			// vulnerable groups share some names — the special-needs checklist comes last
			await expect(
				card.getByRole('checkbox', { name: need, exact: true }).last(),
				need
			).toBeEnabled();
		}
		const custom = card.getByPlaceholder('ระบุความต้องการอื่นๆ (ถ้ามี)');
		await expect(custom).toBeEnabled();
		await expect(card.getByRole('button', { name: 'เพิ่ม', exact: true })).toBeDisabled();
		await custom.fill('ต้องการเตียงเสริม');
		await expect(card.getByRole('button', { name: 'เพิ่ม', exact: true })).toBeEnabled();
	});

	test('R2 the pets section offers dog / cat / other and their detail form', async ({ page }) => {
		await NO_BANNER(page);
		await openPreRegister(page);
		await openPets(page);
		const pets = page.locator('#unified-pets');
		for (const label of ['เพิ่มสุนัข', 'เพิ่มแมว', 'เพิ่มสัตว์อื่นๆ']) {
			await expect(pets.getByRole('button', { name: label }), label).toBeEnabled();
		}
		await expect(pets.getByText('ยังไม่มีการบันทึกสัตว์เลี้ยง')).toBeVisible();

		await pets.getByRole('button', { name: 'เพิ่มแมว' }).click();
		await expect(pets.getByPlaceholder('เช่น ถุงเงิน, เจ้าส้ม, บ๊อบบี้')).toBeEnabled();
		await expect(pets.getByPlaceholder(/มีโรคประจำตัว/)).toBeEnabled();
		await expect(pets.getByRole('checkbox', { name: 'มีกรง / สายจูง / ตะกร้า' })).toBeEnabled();
		// the "other" species needs a free-text kind first
		await pets.getByRole('button', { name: 'สัตว์อื่นๆ', exact: true }).click();
		await expect(pets.getByPlaceholder('เช่น นกแก้ว, กระต่าย, ชูก้าไรเดอร์')).toBeEnabled();
		// one detail form per animal (their <Label>s are not bound to the inputs — placeholders
		// are the only handle, noted as an a11y gap in the PR)
		await expect(pets.getByPlaceholder('เช่น ถุงเงิน, เจ้าส้ม, บ๊อบบี้')).toHaveCount(2);
	});

	test('R2 the consent checkbox and member 2 have the same field set', async ({ page }) => {
		await NO_BANNER(page);
		await openPreRegister(page);
		const consent = page.getByRole('checkbox', { name: DISCLAIMER_LABEL });
		await expect(consent).toBeEnabled();
		await expect(consent).not.toBeChecked();

		await page.getByRole('button', { name: 'เพิ่มสมาชิก', exact: true }).click();
		const card = memberCard(page, 2);
		await expect(card).toBeVisible();
		await expect(card.locator('#member-1-nickname')).toHaveCount(0);
		for (const field of [
			'first-name',
			'last-name',
			'card-number',
			'birth-year',
			'age',
			'country',
			'gender-male',
			'gender-female'
		]) {
			const control = card.locator(`#member-1-${field}`);
			await expect(control, field).toBeVisible();
			await expect(control, field).toBeEnabled();
		}
		// members after the first may have no phone (the box starts ticked) — the head may not
		await expect(card.getByRole('checkbox', { name: 'ไม่มีเบอร์โทรศัพท์' })).toBeChecked();
		await expect(card.locator('#member-1-phone')).toBeDisabled();
		await card.getByRole('checkbox', { name: 'ไม่มีเบอร์โทรศัพท์' }).uncheck();
		await expect(card.locator('#member-1-phone')).toBeEnabled();
		await expect(
			primaryCard(page).getByRole('checkbox', { name: 'ไม่มีเบอร์โทรศัพท์' })
		).toHaveCount(0);
		for (const accordion of ['ผู้ติดต่อฉุกเฉิน', 'กลุ่มเปราะบาง', 'ความต้องการพิเศษ'] as const) {
			await expect(card.getByRole('button', { name: accordion, exact: true })).toBeVisible();
		}
		await card.getByRole('button', { name: 'ลบ' }).click();
		await expect(card).toHaveCount(0);
	});

	test('R3 every dropdown opens with its real options', async ({ page }) => {
		await NO_BANNER(page);
		await openPreRegister(page);

		await page.locator('#housing-type').click();
		await expect(page.getByRole('option')).toHaveText([
			'บ้านตนเอง',
			'บ้านเช่า',
			'คอนโด',
			'อะพาร์ตเมนต์ / หอพัก',
			'ไร้ที่อยู่อาศัยเป็นหลักแหล่ง'
		]);
		await page.keyboard.press('Escape');

		await page.locator('#province').click();
		await expect(page.getByRole('button', { name: 'สงขลา', exact: true })).toBeVisible();
		await page.keyboard.press('Escape');

		const card = primaryCard(page);
		await card.getByRole('button', { name: 'เลขประจำตัวประชาชน' }).click();
		await expect(page.getByRole('option')).toHaveText([
			'เลขประจำตัวประชาชน',
			'หนังสือเดินทาง',
			'บัตรประจำตัวคนซึ่งไม่มีสัญชาติไทย',
			'บัตรประเภทอื่น',
			'บัตรไม่ระบุตัวตน (Anonymous ID)'
		]);
		await page.keyboard.press('Escape');

		await card.getByRole('button', { name: 'ไม่ระบุ', exact: true }).click();
		await expect(page.getByRole('option')).toHaveText([
			'พุทธ',
			'อิสลาม',
			'คริสต์',
			'อื่นๆ (ระบุ)',
			'ไม่ระบุ'
		]);
		await page.keyboard.press('Escape');

		await page.locator('#member-0-country').click();
		await expect(page.getByRole('button', { name: 'ไทย', exact: true }).first()).toBeVisible();
	});

	test('R4 ARIA snapshot: the empty form', async ({ page }) => {
		await NO_BANNER(page);
		await NO_THAID(page);
		await openPreRegister(page);
		await expect(page.locator('main')).toMatchAriaSnapshot({ name: 'form-empty.aria.yml' });
	});

	test('R4 ARIA snapshot: the form with every error showing', async ({ page }) => {
		await NO_BANNER(page);
		await NO_THAID(page);
		await openPreRegister(page);
		await acceptDisclaimer(page);
		await submitButton(page).click();
		await expect(summaryAlert(page)).toBeVisible();
		await expect(page.locator('main')).toMatchAriaSnapshot({ name: 'form-errors.aria.yml' });
	});

	for (const viewport of [
		{ name: 'desktop', width: 1440, height: 900 },
		{ name: 'mobile', width: 390, height: 844 }
	]) {
		test(`R5 screenshot ${viewport.name}: empty and all-errors form`, async ({ page }) => {
			await page.setViewportSize({ width: viewport.width, height: viewport.height });
			await NO_BANNER(page);
			await NO_THAID(page);
			await openPreRegister(page);
			await page.waitForLoadState('networkidle');
			// Viewport shots at fixed scroll positions: a full-page capture mangles the sticky
			// summary / bars. The navbar carries live announcement counts, toasts are transient.
			const options = {
				animations: 'disabled' as const,
				caret: 'hide' as const,
				maxDiffPixelRatio: 0.01,
				mask: [page.locator('header')]
			};
			const scrollTo = async (selector: string | null) => {
				await page.evaluate((sel) => {
					const target = sel ? document.querySelector(sel) : null;
					window.scrollTo({
						top: target ? target.getBoundingClientRect().top + window.scrollY - 90 : 0,
						behavior: 'instant'
					});
				}, selector);
				await settleScroll(page);
			};

			await expect(page).toHaveScreenshot(`form-empty-top-${viewport.name}.png`, options);
			await scrollTo('#unified-members');
			await expect(page).toHaveScreenshot(`form-empty-members-${viewport.name}.png`, options);

			await scrollTo(null);
			await acceptDisclaimer(page);
			await submitButton(page).click();
			await expect(summaryAlert(page)).toBeVisible();
			await page.locator('[data-sonner-toast]').first().waitFor();
			// toasts are transient — hide them so the baseline never depends on their timing
			await page.addStyleTag({ content: '[data-sonner-toaster]{display:none !important}' });
			await settleScroll(page);
			await scrollTo('form [role="alert"]');
			await expect(page).toHaveScreenshot(`form-errors-top-${viewport.name}.png`, options);
			await scrollTo('#unified-members');
			await expect(page).toHaveScreenshot(`form-errors-members-${viewport.name}.png`, options);
		});
	}

	test('R6 the page loads and the form fills without errors or failed requests', async ({
		page,
		health
	}) => {
		await NO_BANNER(page);
		await openPreRegister(page);
		await page.waitForLoadState('networkidle');
		await fillAddress(page);
		await fillMember(page, 0, { firstName: 'ทดสอบ', gender: 'male', phone: fictitiousPhone() });
		await page.getByRole('button', { name: 'เพิ่มสมาชิก', exact: true }).click();
		await openPets(page);
		await page.getByRole('button', { name: 'เพิ่มแมว' }).click();
		await page.getByRole('button', { name: 'ใบลงทะเบียนของฉัน' }).click();
		await expect(page.getByRole('heading', { name: 'ใบลงทะเบียนของฉัน', level: 2 })).toBeVisible();
		await page.waitForLoadState('networkidle');
		expectHealthy(health);
		expect(health.registrationWrites).toEqual([]);
	});
});

// =============================================================== V — validation gates

/** Valid minimum for the central queue except the pieces a test breaks on purpose. */
async function fillBase(
	page: Page,
	o: { address?: boolean; member?: MemberInput; consent?: boolean } = {}
): Promise<void> {
	if (o.address !== false) await fillAddress(page);
	await fillMember(page, 0, {
		firstName: 'ทดสอบ',
		lastName: 'ระบบ',
		gender: 'male',
		phone: '0899999999',
		...o.member
	});
	if (o.consent !== false) await acceptDisclaimer(page);
}

/** The error sits in a `p.text-destructive` inside one of the field's own wrappers. */
async function messageUnderField(field: Locator, message: string): Promise<boolean> {
	return field.evaluate((el, text) => {
		let node: HTMLElement | null = el as HTMLElement;
		for (let depth = 0; node && depth < 5; depth++, node = node.parentElement) {
			const hit = [...node.querySelectorAll('p.text-destructive')].some(
				(p) => p.textContent?.trim() === text
			);
			if (hit) return true;
		}
		return false;
	}, message);
}

/** Wait until the page stops scrolling (the form scrolls smoothly to its first error). */
async function settleScroll(page: Page): Promise<void> {
	let last = -1;
	await expect
		.poll(
			async () => {
				const y = await page.evaluate(() => window.scrollY);
				const settled = y === last;
				last = y;
				return settled;
			},
			{ intervals: [250] }
		)
		.toBe(true);
}

async function focusIsWithin(field: Locator): Promise<boolean> {
	return field.evaluate(
		(el) => el === document.activeElement || el.contains(document.activeElement)
	);
}

test.describe('Pre-register: validation gates (V)', { tag: ['@pre-register', '@smoke'] }, () => {
	test('V1 the confirm buttons stay disabled until the consent box is ticked; an empty form sends nothing', async ({
		page,
		health
	}) => {
		await openPreRegister(page);
		// the bottom bar and the summary aside each carry a confirm button
		const buttons = page.getByRole('button', { name: SUBMIT_LABEL });
		await expect(buttons).toHaveCount(2);
		for (const button of await buttons.all()) await expect(button).toBeDisabled();

		await acceptDisclaimer(page);
		for (const button of await buttons.all()) await expect(button).toBeEnabled();
		await page.getByRole('checkbox', { name: DISCLAIMER_LABEL }).uncheck();
		for (const button of await buttons.all()) await expect(button).toBeDisabled();

		await acceptDisclaimer(page);
		await submitButton(page).click();
		await expect(summaryAlert(page)).toBeVisible();
		// the empty address is the first invalid field in DOM order (it now carries aria-invalid)
		await expect(page.locator('#address-no')).toBeFocused();
		expect(health.registrationWrites).toEqual([]);
	});

	test('V2 one submit reports wrong ID checksum + short phone together (gender is never an error), without repeating the title', async ({
		page,
		health
	}) => {
		await openPreRegister(page);
		await fillAddress(page);
		await fillMember(page, 0, {
			firstName: 'ทดสอบ',
			nationalId: withBrokenChecksum(fictitiousNationalId(12345)),
			phone: '0812'
		});
		await acceptDisclaimer(page);
		await submitButton(page).click();

		const expected: [Locator, string][] = [
			[
				page.locator('#member-0-card-number'),
				'เลขบัตรประชาชนไม่ถูกต้อง (ตรวจสอบหลักสุดท้ายอีกครั้ง)'
			],
			[page.locator('#member-0-phone'), 'กรุณากรอกเบอร์โทรศัพท์ 10 หลักของผู้ติดต่อหลัก']
		];
		for (const [field, message] of expected) {
			await expect(field).toHaveAttribute('aria-invalid', 'true');
			expect(await messageUnderField(field, message), message).toBe(true);
			await expect(
				summaryAlert(page).getByRole('listitem').filter({ hasText: message })
			).toHaveCount(1);
		}

		// decision sync 2026-10-09: gender defaults to ไม่ระบุ (null) and is never reported as missing.
		await expect(radiogroup(page)).not.toHaveAttribute('aria-invalid', 'true');
		await expect(
			summaryAlert(page).getByRole('listitem').filter({ hasText: 'กรุณาเลือกเพศ' })
		).toHaveCount(0);

		// OBS-02: the toast title is the first message and the description never repeats it.
		const toast = page.locator('[data-sonner-toast]').first();
		await expect(toast).toBeVisible();
		const title = (await toast.locator('[data-title]').innerText()).trim();
		const description = (await toast.locator('[data-description]').innerText()).trim();
		expect(description.split('\n')).not.toContain(title);
		expect(description).not.toContain(title);
		expect(health.registrationWrites).toEqual([]);
	});

	test('V3 province → district → subdistrict cascade from real data fills the postal code', async ({
		page
	}) => {
		await openPreRegister(page);
		await pickSearchSelect(page, 'province', 'สงขลา');
		await expect(page.locator('#province')).toContainText('สงขลา');
		await pickSearchSelect(page, 'district', 'หาดใหญ่');
		await expect(page.locator('#district')).toContainText('หาดใหญ่');
		await expect(page.locator('#postal_code')).toHaveValue('');
		await pickSearchSelect(page, 'subdistrict', 'คอหงส์');
		await expect(page.locator('#subdistrict')).toContainText('คอหงส์');
		await expect(page.locator('#postal_code')).toHaveValue('90110');

		// changing the province clears everything below it
		await pickSearchSelect(page, 'province', 'ปัตตานี');
		await expect(page.locator('#district')).not.toContainText('หาดใหญ่');
		await expect(page.locator('#postal_code')).toHaveValue('');
	});
});

// =============================================================== E — error matrix

interface ErrorRow {
	id: string;
	/** Literal message shown under the field. */
	message: string;
	/** Literal message in the summary alert when it differs from the inline one. */
	summaryMessage?: string;
	prepare: (page: Page) => Promise<void>;
	field: (page: Page) => Locator;
	/** First invalid field in DOM order when it is not `field` (focus target of the jump). */
	firstInvalid?: (page: Page) => Locator;
}

const currentBE = new Date().getFullYear() + 543;
const currentCE = new Date().getFullYear();
const MISSING_AREA = 'กรุณากรอกบ้านเลขที่ จังหวัด อำเภอ และตำบล';
const HEAD_PHONE_REQUIRED = 'กรุณากรอกเบอร์โทรศัพท์ 10 หลักของผู้ติดต่อหลัก';

const radiogroup = (page: Page, card: Locator = primaryCard(page)) =>
	card.getByRole('radiogroup', { name: /เพศ/ });

const ERROR_ROWS: ErrorRow[] = [
	{
		id: 'E01',
		message: MISSING_AREA,
		prepare: (page) => fillBase(page, { address: false }),
		field: (page) => page.locator('#address-no'),
		firstInvalid: (page) => page.locator('#address-no')
	},
	{
		id: 'E02',
		message: 'กรุณากรอกชื่อ',
		prepare: (page) => fillBase(page, { member: { firstName: '' } }),
		field: (page) => page.locator('#member-0-first-name')
	},
	{
		id: 'E04',
		message: 'เลขบัตรประชาชนไม่ถูกต้อง (ตรวจสอบหลักสุดท้ายอีกครั้ง)',
		prepare: (page) =>
			fillBase(page, { member: { nationalId: withBrokenChecksum(fictitiousNationalId(424242)) } }),
		field: (page) => page.locator('#member-0-card-number')
	},
	{
		id: 'E05',
		message: 'เลขประจำตัวประชาชนต้องมี 13 หลัก',
		prepare: (page) =>
			fillBase(page, { member: { nationalId: fictitiousNationalId(424242).slice(0, 12) } }),
		field: (page) => page.locator('#member-0-card-number')
	},
	{
		id: 'E06',
		message: HEAD_PHONE_REQUIRED,
		prepare: (page) => fillBase(page, { member: { phone: '' } }),
		field: (page) => page.locator('#member-0-phone')
	},
	{
		id: 'E07',
		message: HEAD_PHONE_REQUIRED,
		prepare: (page) => fillBase(page, { member: { phone: '0812' } }),
		field: (page) => page.locator('#member-0-phone')
	},
	{
		id: 'E08',
		message: 'กรุณากรอกเบอร์ติดต่อฉุกเฉินให้ครบ 10 หลัก',
		prepare: async (page) => {
			await fillBase(page);
			await fillEmergencyContact(page, { name: 'ผู้ติดต่อ', phone: '12', relation: 'ญาติ' });
		},
		field: (page) => page.locator('#emergency-phone')
	},
	{
		id: 'E09',
		message: 'กรุณากรอกชื่อ-นามสกุลผู้ติดต่อฉุกเฉิน',
		prepare: async (page) => {
			await fillBase(page);
			await fillEmergencyContact(page, { name: '', phone: '0812345678', relation: 'ญาติ' });
		},
		field: (page) => page.locator('#emergency-name')
	},
	{
		id: 'E10',
		message: 'กรุณาระบุความสัมพันธ์ของผู้ติดต่อฉุกเฉิน',
		prepare: async (page) => {
			await fillBase(page);
			await fillEmergencyContact(page, { name: 'ผู้ติดต่อ', phone: '0812345678', relation: '' });
		},
		field: (page) => page.locator('#emergency-relation')
	},
	{
		id: 'E11',
		message: 'กรุณากรอกปีเกิด 4 หลัก',
		prepare: (page) => fillBase(page, { member: { birthYear: '254' } }),
		field: (page) => page.locator('#member-0-birth-year')
	},
	{
		id: 'E12',
		message: `ปีเกิด (พ.ศ.) ต้องอยู่ระหว่าง ${currentBE - 150}–${currentBE}`,
		prepare: (page) => fillBase(page, { member: { birthYear: '2300' } }),
		field: (page) => page.locator('#member-0-birth-year')
	},
	{
		id: 'E13',
		message: `ปีเกิด (ค.ศ.) ต้องอยู่ระหว่าง ${currentCE - 150}–${currentCE}`,
		// The summary is built from the stored พ.ศ. year, whatever calendar the user typed in.
		summaryMessage: `ปีเกิด (พ.ศ.) ต้องอยู่ระหว่าง ${currentBE - 150}–${currentBE}`,
		prepare: async (page) => {
			await fillBase(page);
			await primaryCard(page).getByRole('button', { name: 'ค.ศ.', exact: true }).click();
			await page.locator('#member-0-birth-year').fill('1700');
		},
		field: (page) => page.locator('#member-0-birth-year')
	},
	{
		id: 'E14',
		message: 'อายุต้องไม่เกิน 150 ปี',
		prepare: (page) => fillBase(page, { member: { age: '151' } }),
		field: (page) => page.locator('#member-0-age')
	},
	{
		id: 'E15',
		message: 'กรุณาระบุศาสนา',
		prepare: async (page) => {
			await fillBase(page);
			await primaryCard(page).getByRole('button', { name: 'ไม่ระบุ', exact: true }).click();
			await page.getByRole('option', { name: 'อื่นๆ (ระบุ)' }).click();
			await expect(page.locator('#member-0-religion-other')).toBeVisible();
		},
		field: (page) => page.locator('#member-0-religion-other')
	},
	{
		id: 'E16',
		message: 'กรุณากรอกชื่อ',
		prepare: async (page) => {
			await fillBase(page);
			await page.getByRole('button', { name: 'เพิ่มสมาชิก', exact: true }).click();
		},
		field: (page) => memberCard(page, 2).locator('#member-1-first-name')
	},
	{
		id: 'E18',
		message: 'กรุณาระบุชนิดสัตว์เมื่อเลือกอื่นๆ',
		prepare: async (page) => {
			await fillBase(page);
			await openPets(page);
			await page.getByRole('button', { name: 'เพิ่มสัตว์อื่นๆ' }).first().click();
		},
		field: (page) => page.getByPlaceholder('เช่น นกแก้ว, กระต่าย, ชูก้าไรเดอร์')
	},
	{
		id: 'E19',
		message: 'กรุณากรอกชื่อหอพัก',
		prepare: async (page) => {
			await fillBase(page, { address: false });
			await page.locator('#housing-type').click();
			await page.getByRole('option', { name: 'อะพาร์ตเมนต์ / หอพัก' }).click();
			await fillAddress(page, { houseNo: '' });
			await page.locator('#dorm-room').fill('305');
		},
		field: (page) => page.locator('#dorm-name')
	},
	{
		id: 'E20',
		message: 'กรุณากรอกเลขห้อง',
		prepare: async (page) => {
			await fillBase(page, { address: false });
			await page.locator('#housing-type').click();
			await page.getByRole('option', { name: 'อะพาร์ตเมนต์ / หอพัก' }).click();
			await fillAddress(page, { houseNo: '' });
			await page.locator('#dorm-name').fill('หอพักสุขใจ');
		},
		field: (page) => page.locator('#dorm-room')
	},
	{
		id: 'E21',
		message: 'ที่พักแบบไร้บ้านเลขที่ต้องมีจุดสังเกตหรือที่ตั้งครบ',
		prepare: async (page) => {
			await fillBase(page, { address: false });
			await page.locator('#housing-type').click();
			await page.getByRole('option', { name: 'ไร้ที่อยู่อาศัยเป็นหลักแหล่ง' }).click();
		},
		field: (page) => page.locator('#residence-landmark')
	},
	{
		id: 'E22',
		message: 'ลงทะเบียนได้สูงสุด 20 คนต่อครั้ง',
		prepare: async (page) => {
			await fillBase(page);
			for (let i = 0; i < 20; i++)
				await page.getByRole('button', { name: 'เพิ่มสมาชิก', exact: true }).click();
		},
		field: (page) => page.getByRole('button', { name: 'เพิ่มสมาชิก', exact: true })
	}
];

test.describe('Pre-register: error matrix (E)', { tag: ['@pre-register', '@smoke'] }, () => {
	for (const row of ERROR_ROWS) {
		test(`${row.id} shows "${row.message}"`, async ({ page, health }) => {
			test.setTimeout(row.id === 'E22' ? 90_000 : 60_000);
			await NO_BANNER(page);
			await openPreRegister(page);
			await row.prepare(page);
			// nothing is flagged before the first submit
			await expect(page.locator('[aria-invalid="true"]')).toHaveCount(0);
			await submitButton(page).click();

			const summary = summaryAlert(page);
			await expect(summary).toBeVisible();
			const field = row.field(page);

			// (1) the literal message under the field
			await expect(field).toBeVisible();
			expect(await messageUnderField(field, row.message), `${row.id} inline`).toBe(true);
			// (3) in the summary alert
			await expect(
				summary.getByRole('listitem').filter({ hasText: row.summaryMessage ?? row.message })
			).not.toHaveCount(0);
			// the toast announces it too, and repeats nothing
			const toast = page.locator('[data-sonner-toast]').first();
			await expect(toast).toBeVisible();
			const toastTitle = (await toast.locator('[data-title]').innerText()).trim();
			const toastBody = (await toast.locator('[data-description]').count())
				? await toast.locator('[data-description]').innerText()
				: '';
			expect(toastBody).not.toContain(toastTitle);

			// (2) aria-invalid, aria-describedby -> the message, and the jump button
			await expect(field).toHaveAttribute('aria-invalid', 'true');
			const describedBy = await field.getAttribute('aria-describedby');
			expect(describedBy, `${row.id} aria-describedby`).toBeTruthy();
			await expect(page.locator(`[id="${describedBy}"]`)).toHaveText(row.message);
			const target = row.firstInvalid?.(page) ?? field;
			// a person presses the button after the first auto-scroll has finished
			await settleScroll(page);
			await page.getByRole('button', { name: JUMP_BUTTON }).click();
			await expect.poll(() => focusIsWithin(target), `${row.id} jump focus`).toBe(true);
			await expect(target).toBeInViewport();

			// (4) nothing was sent
			expect(health.registrationWrites).toEqual([]);
		});
	}

	// ---- Gender is optional (decision sync 2026-10-09 — supersedes CR-154 FR-70) ----------------
	// ไม่ระบุ is preselected in every registration form and persists as `null`; there is no
	// "กรุณาเลือกเพศ" error any more. @smoke is read-only on staging, so the registration POST is
	// intercepted (answered with a stubbed 500, like S1e) and the captured request body is asserted
	// instead of letting anything reach the server.

	type QueueSubmitBody = { members: { first_name: string; gender: string | null }[] };

	/** Answer the queue POST locally and collect its JSON body — nothing is written upstream. */
	async function captureQueueSubmit(
		page: Page,
		health: { allow(...p: RegExp[]): void }
	): Promise<QueueSubmitBody[]> {
		health.allow(/500/);
		const bodies: QueueSubmitBody[] = [];
		await page.route('**/api/public/v1/unassigned-registrations', (route) => {
			if (route.request().method() !== 'POST') return route.continue();
			bodies.push(route.request().postDataJSON() as QueueSubmitBody);
			return route.fulfill({
				status: 500,
				contentType: 'application/json',
				body: JSON.stringify({ success: false, error: 'WRITE_FAILED' })
			});
		});
		return bodies;
	}

	async function expectUnspecifiedPreselected(card: Locator) {
		await expect(card.getByRole('radio', { name: 'ไม่ระบุ' })).toBeChecked();
		await expect(card.getByRole('radio', { name: 'ชาย' })).not.toBeChecked();
		await expect(card.getByRole('radio', { name: 'หญิง' })).not.toBeChecked();
	}

	test('E03 gender is optional — ไม่ระบุ preselected, submit not blocked, payload gender is null', async ({
		page,
		health
	}) => {
		await NO_BANNER(page);
		await openPreRegister(page);
		await expectUnspecifiedPreselected(primaryCard(page));
		const bodies = await captureQueueSubmit(page, health);
		await fillBase(page, { member: { gender: undefined } });
		await submitButton(page).click();

		await expect.poll(() => bodies.length).toBe(1);
		expect(bodies[0].members[0].gender).toBeNull();
		await expect(radiogroup(page)).not.toHaveAttribute('aria-invalid', 'true');
		await expect(summaryAlert(page)).toHaveCount(0);
		await expect(page.getByText('กรุณาเลือกเพศ')).toHaveCount(0);
		// the only write is the intercepted one
		expect(health.registrationWrites).toEqual(['POST /api/public/v1/unassigned-registrations']);
	});

	test('E17 gender is optional on member 2 — ไม่ระบุ preselected, payload gender is null', async ({
		page,
		health
	}) => {
		await NO_BANNER(page);
		await openPreRegister(page);
		const bodies = await captureQueueSubmit(page, health);
		await fillBase(page);
		await page.getByRole('button', { name: 'เพิ่มสมาชิก', exact: true }).click();
		await fillMember(page, 1, { firstName: 'สมาชิกสอง' });
		await expectUnspecifiedPreselected(memberCard(page, 2));
		await submitButton(page).click();

		await expect.poll(() => bodies.length).toBe(1);
		expect(bodies[0].members.map((m) => m.gender)).toEqual(['male', null]);
		await expect(radiogroup(page, memberCard(page, 2))).not.toHaveAttribute('aria-invalid', 'true');
		await expect(summaryAlert(page)).toHaveCount(0);
		expect(health.registrationWrites).toEqual(['POST /api/public/v1/unassigned-registrations']);
	});

	test('E23 an invalid family-search phone is flagged once the field loses focus', async ({
		page,
		health
	}) => {
		await openPreRegister(page);
		const search = page.getByRole('textbox', {
			name: 'ค้นหาครอบครัวด้วยเบอร์โทรศัพท์ (เพื่อเข้าร่วมบ้านเดิม)'
		});
		await search.fill('08123');
		await expect(search).not.toHaveAttribute('aria-invalid', 'true');
		await search.blur();
		await expect(search).toHaveAttribute('aria-invalid', 'true');
		expect(
			await messageUnderField(
				search,
				'เบอร์โทรไม่ถูกต้อง — ต้องขึ้นต้นด้วย 0 และมี 9–10 หลัก (หรือ +66)'
			)
		).toBe(true);
		await search.fill('0812345678');
		await search.blur();
		await expect(search).not.toHaveAttribute('aria-invalid', 'true');
		expect(health.registrationWrites).toEqual([]);
	});

	test('E24 a head phone that is neither complete nor blank is rejected for a joined family', async ({
		page,
		health
	}) => {
		await page.route('**/api/public/v1/households/residence-match', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					matches: [
						{
							match_token: 'e2e-join-token',
							landmark: 'บ้านทดสอบ E2E',
							is_in_shelter: false,
							primary_contact_masked: 'ส*** ใ****',
							member_count: 2,
							address: {
								housing_type: 'owned_house',
								address_no: '9/9',
								subdistrict: 'คอหงส์',
								district: 'หาดใหญ่',
								province: 'สงขลา',
								postal_code: '90110'
							}
						}
					]
				})
			})
		);
		await openPreRegister(page);
		await fillAddress(page);
		await page.getByRole('button', { name: 'เข้าร่วมคิวกลาง' }).click();
		await expect(page.getByText('จะเข้าร่วมครอบครัวที่มีอยู่แล้ว')).toBeVisible();

		await fillMember(page, 0, { firstName: 'ทดสอบ', gender: 'male', phone: '12' });
		await acceptDisclaimer(page);
		await submitButton(page).click();
		const phone = page.locator('#member-0-phone');
		await expect(phone).toHaveAttribute('aria-invalid', 'true');
		expect(
			await messageUnderField(phone, 'กรุณากรอกเบอร์ให้ครบ 10 หลัก หรือเว้นว่าง / เลือกไม่มีเบอร์')
		).toBe(true);
		await expect(summaryAlert(page)).toBeVisible();
		expect(health.registrationWrites).toEqual([]);
	});

	test('fixing a field clears its error on the next submit while the others stay', async ({
		page
	}) => {
		await openPreRegister(page);
		await fillAddress(page);
		await fillMember(page, 0, { phone: '0812', nationalId: '123' });
		await acceptDisclaimer(page);
		await submitButton(page).click();

		const first = page.locator('#member-0-first-name');
		const phone = page.locator('#member-0-phone');
		for (const field of [first, phone]) await expect(field).toHaveAttribute('aria-invalid', 'true');

		// 1) fix the name → only its error goes away
		await first.fill('ทดสอบ');
		await submitButton(page).click();
		await expect(first).not.toHaveAttribute('aria-invalid', 'true');
		await expect(phone).toHaveAttribute('aria-invalid', 'true');
		await expect(
			summaryAlert(page).getByRole('listitem').filter({ hasText: 'กรุณากรอกชื่อ' })
		).toHaveCount(0);

		// 2) fix the phone → the remaining error (ID number "123" is still short)
		await phone.fill('0899999999');
		await submitButton(page).click();
		await expect(phone).not.toHaveAttribute('aria-invalid', 'true');
		await expect(page.locator('#member-0-card-number')).toHaveAttribute('aria-invalid', 'true');
		await expect(
			summaryAlert(page)
				.getByRole('listitem')
				.filter({ hasText: 'เลขประจำตัวประชาชนต้องมี 13 หลัก' })
		).toHaveCount(1);
	});

	test('a fixed field loses its error as soon as its value is valid, without another submit', async ({
		page
	}) => {
		await openPreRegister(page);
		await fillAddress(page);
		await fillMember(page, 0, { phone: '0812', nationalId: '123' });
		await acceptDisclaimer(page);
		// no error before the first submit, even for the half-typed phone and ID number
		await expect(page.locator('[aria-invalid="true"]')).toHaveCount(0);
		await submitButton(page).click();

		const first = page.locator('#member-0-first-name');
		const phone = page.locator('#member-0-phone');
		const card = page.locator('#member-0-card-number');
		const summary = summaryAlert(page);
		for (const field of [first, phone, card])
			await expect(field).toHaveAttribute('aria-invalid', 'true');

		// typing a name clears only the name error — message, flag and summary line
		await first.fill('ทดสอบ');
		await expect(first).not.toHaveAttribute('aria-invalid', 'true');
		expect(await messageUnderField(first, 'กรุณากรอกชื่อ')).toBe(false);
		await expect(summary.getByRole('listitem').filter({ hasText: 'กรุณากรอกชื่อ' })).toHaveCount(0);
		await expect(phone).toHaveAttribute('aria-invalid', 'true');

		// a still-invalid value keeps its error while typing, and clears on the last digit
		await phone.fill('089999');
		await expect(phone).toHaveAttribute('aria-invalid', 'true');
		await phone.fill('0899999999');
		await expect(phone).not.toHaveAttribute('aria-invalid', 'true');
		expect(await messageUnderField(phone, HEAD_PHONE_REQUIRED)).toBe(false);

		// the ID number is still short, so it stays flagged, and nothing new appeared
		await expect(card).toHaveAttribute('aria-invalid', 'true');
		await expect(page.locator('[aria-invalid="true"]')).toHaveCount(1);
		await expect(summary.getByRole('listitem')).toHaveCount(1);

		// the last fix empties the summary
		await card.fill(fictitiousNationalId(424242));
		await expect(page.locator('[aria-invalid="true"]')).toHaveCount(0);
		await expect(summary).toBeHidden();
	});

	test('fixing the address, the emergency contact and the pet species clears them at once', async ({
		page
	}) => {
		await openPreRegister(page);
		await fillBase(page, { address: false });
		await fillEmergencyContact(page, { name: '', phone: '12', relation: '' });
		await openPets(page);
		await page.getByRole('button', { name: 'เพิ่มสัตว์อื่นๆ' }).first().click();
		await submitButton(page).click();
		await expect(summaryAlert(page)).toBeVisible();

		const address = page.locator('#address-no');
		const province = page.locator('#province');
		const emergencyPhone = page.locator('#emergency-phone');
		const species = page.getByPlaceholder('เช่น นกแก้ว, กระต่าย, ชูก้าไรเดอร์');
		for (const field of [address, province, emergencyPhone, species])
			await expect(field).toHaveAttribute('aria-invalid', 'true');

		await species.fill('นกแก้ว');
		await expect(species).not.toHaveAttribute('aria-invalid', 'true');
		await emergencyPhone.fill('0812345678');
		await expect(emergencyPhone).not.toHaveAttribute('aria-invalid', 'true');
		await expect(page.locator('#emergency-name')).toHaveAttribute('aria-invalid', 'true');

		// the area error is one error: it goes away once every required piece is filled
		await address.fill('123/45');
		await expect(address).toHaveAttribute('aria-invalid', 'true');
		await pickSearchSelect(page, 'province', 'สงขลา');
		await expect(province).not.toHaveAttribute('aria-invalid', 'true');
		await expect(page.locator('#district')).toHaveAttribute('aria-invalid', 'true');
		await pickSearchSelect(page, 'district', 'หาดใหญ่');
		await pickSearchSelect(page, 'subdistrict', 'คอหงส์');
		await expect(address).not.toHaveAttribute('aria-invalid', 'true');
		await expect(page.locator('#district')).not.toHaveAttribute('aria-invalid', 'true');
		await expect(page.locator('#subdistrict')).not.toHaveAttribute('aria-invalid', 'true');
	});
});

// =============================================================== S — server / page errors

test.describe(
	'Pre-register: server and page-level errors (S)',
	{ tag: ['@pre-register', '@smoke'] },
	() => {
		/** Fill the central-queue form with valid data; the POST is intercepted by the caller. */
		async function fillValidQueueForm(page: Page) {
			await openPreRegister(page);
			await fillBase(page, { member: { firstName: 'ทดสอบ', lastName: LAST_NAME } });
		}

		async function expectFormKept(page: Page) {
			await expect(page.locator('#member-0-first-name')).toHaveValue('ทดสอบ');
			await expect(page.locator('#member-0-last-name')).toHaveValue(LAST_NAME);
			await expect(page.locator('#member-0-phone')).toHaveValue('0899999999');
			await expect(page.locator('#address-no')).toHaveValue('123/45');
			await expect(page.locator('#postal_code')).toHaveValue('90110');
			await expect(page.getByRole('checkbox', { name: DISCLAIMER_LABEL })).toBeChecked();
			await expect(page.getByText('ลงทะเบียนล่วงหน้าสำเร็จ')).toHaveCount(0);
		}

		const serverCases: {
			id: string;
			status: number;
			body: Record<string, unknown>;
			toast: string;
			allow: RegExp;
		}[] = [
			{
				id: 'S1a 409 DUPLICATE_OPEN_IDENTITY',
				status: 409,
				body: { success: false, error: 'DUPLICATE_OPEN_IDENTITY' },
				toast: 'เลขบัตรประชาชน หรือ เบอร์โทรศัพท์นี้ลงทะเบียนเรียบร้อยแล้ว',
				allow: /409/
			},
			{
				id: 'S1b 422 INVALID_INPUT (field message)',
				status: 422,
				body: {
					success: false,
					error: 'INVALID_INPUT',
					details: {
						formErrors: [],
						fieldErrors: { 'members.0.phone': ['เบอร์โทรไม่ถูกต้องจากเซิร์ฟเวอร์'] }
					}
				},
				toast: 'เบอร์โทรไม่ถูกต้องจากเซิร์ฟเวอร์',
				allow: /422/
			},
			{
				id: 'S1c 422 INVALID_INPUT (no details)',
				status: 422,
				body: { success: false, error: 'INVALID_INPUT' },
				toast: 'ข้อมูลไม่ครบหรือไม่ถูกต้อง',
				allow: /422/
			},
			{
				id: 'S1d 429 RATE_LIMITED',
				status: 429,
				body: { success: false, error: 'RATE_LIMITED' },
				toast: 'ส่งคำขอถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
				allow: /429/
			},
			{
				id: 'S1e 500 WRITE_FAILED',
				status: 500,
				body: { success: false, error: 'WRITE_FAILED' },
				toast: 'ไม่สามารถบันทึกการลงทะเบียนได้ กรุณาลองใหม่',
				allow: /500/
			}
		];

		for (const c of serverCases) {
			test(`${c.id}: a readable toast and the form data kept`, async ({ page, health }) => {
				health.allow(c.allow);
				await page.route('**/api/public/v1/unassigned-registrations', (route) =>
					route.request().method() === 'POST'
						? route.fulfill({
								status: c.status,
								contentType: 'application/json',
								body: JSON.stringify(c.body)
							})
						: route.continue()
				);
				await fillValidQueueForm(page);
				await submitButton(page).click();
				const toast = page.locator('[data-sonner-toast]').filter({ hasText: c.toast });
				await expect(toast).toBeVisible();
				// a human sentence, never the raw machine code
				await expect(page.locator('[data-sonner-toast]')).not.toContainText(/[A-Z]{2,}_[A-Z_]+/);
				await expectFormKept(page);
				expect(health.registrationWrites).toHaveLength(1);
			});
		}

		/** The write endpoint drops the connection (offline, proxy reset). */
		async function dropConnection(page: Page, health: { allow(...p: RegExp[]): void }) {
			health.allow(/ERR_FAILED|Failed to load resource/);
			await page.route('**/api/public/v1/unassigned-registrations', (route) =>
				route.request().method() === 'POST' ? route.abort('connectionreset') : route.continue()
			);
			await fillValidQueueForm(page);
			await submitButton(page).click();
			await expect(page.locator('[data-sonner-toast]').first()).toBeVisible();
		}

		test('S1f a dropped connection raises an error toast and keeps the form', async ({
			page,
			health
		}) => {
			await dropConnection(page, health);
			await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(1);
			await expectFormKept(page);
			expect(health.registrationWrites).toHaveLength(1);
		});

		test('S1f a dropped connection is explained in plain language', async ({ page, health }) => {
			await dropConnection(page, health);
			const toast = page.locator('[data-sonner-toast][data-type="error"]');
			await expect(toast).toContainText('เชื่อมต่อไม่สำเร็จ');
			await expect(toast).toContainText('ข้อมูลที่กรอกยังอยู่ครบ');
			await expect(page.locator('[data-sonner-toast]')).not.toContainText('Failed to fetch');
			await expectFormKept(page);
		});

		test('S2 a shelter that does not take pre-registrations cannot be chosen from a link', async ({
			page
		}) => {
			const res = await page.request.get('/api/public/v1/shelters');
			const { shelters } = (await res.json()) as {
				shelters: { code: string; accepts_pre_registration?: boolean }[];
			};
			const closedToBooking = shelters.find((s) => s.accepts_pre_registration !== true);
			test.skip(!closedToBooking, 'every shelter accepts pre-registration on this target');
			await page.goto(`/pre-register?shelter=${closedToBooking!.code}`);
			await expect(
				page.getByText('ศูนย์นี้ยังไม่เปิดรับลงทะเบียนล่วงหน้าจากหน้าสาธารณะ')
			).toBeVisible();
			await expect(page.getByText('กรุณาเลือกศูนย์พักพิง', { exact: true })).toBeVisible();
			await expect(page.locator('#address-no')).toHaveCount(0);
		});

		test('S3 a reCAPTCHA failure blocks the send with its own message', async ({
			page,
			health
		}) => {
			await page.route('**/api/public/v1/recaptcha', (route) =>
				route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ enabled: true })
				})
			);
			// Do not load Google's script: no token can ever be produced.
			await page.route(/google\.com\/recaptcha/, (route) => route.abort());
			health.allow(/recaptcha|ERR_FAILED|Failed to load resource/i);
			await fillValidQueueForm(page);
			await submitButton(page).click();
			await expect(
				page
					.locator('[data-sonner-toast]')
					.filter({ hasText: 'ระบบยืนยันตัวตน (reCAPTCHA) ขัดข้อง กรุณาลองใหม่อีกครั้ง' })
					.first()
			).toBeVisible();
			expect(health.registrationWrites).toEqual([]);
		});

		test('S3 a reCAPTCHA failure raises a single toast', async ({ page, health }) => {
			await page.route('**/api/public/v1/recaptcha', (route) =>
				route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ enabled: true })
				})
			);
			await page.route(/google\.com\/recaptcha/, (route) => route.abort());
			health.allow(/recaptcha|ERR_FAILED|Failed to load resource/i);
			await fillValidQueueForm(page);
			await submitButton(page).click();
			await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(1);
		});

		test('S4 the shelter safety consent is required once a pet comes along', async ({
			page,
			health
		}) => {
			const shelter = {
				code: 'E2E01',
				name: 'ศูนย์ทดสอบ E2E (mock)',
				status: 'open',
				capacity: 50,
				accepts_pre_registration: true,
				province: 'สงขลา',
				vulnerable_groups: [],
				pet_policy: 'conditional'
			};
			await page.route('**/api/public/v1/shelters?*', (route) => route.fallback());
			await page.route('**/api/public/v1/shelters', (route) =>
				route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ shelters: [shelter], count: 1, as_of: new Date().toISOString() })
				})
			);
			await page.route('**/api/public/v1/config/shelter-policy**', (route) =>
				route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						code: shelter.code,
						feature_flags: { allow_pets: true },
						admission_policy: { pet_policy: { policy: 'conditional' } }
					})
				})
			);
			await page.route('**/api/public/v1/registrations', (route) => route.abort());
			await openPreRegister(page, '/pre-register');
			await chooseShelter(page, /ศูนย์ทดสอบ E2E/);
			await fillBase(page, { consent: false });
			await openPets(page);
			await page.getByRole('button', { name: 'เพิ่มสุนัข' }).click();
			await submitButton(page).click();
			await expect(
				page.locator('[data-sonner-toast]').filter({
					hasText: 'กรุณากดยืนยันการรับทราบเงื่อนไขและมาตรการด้านความปลอดภัยของศูนย์พักพิง'
				})
			).toBeVisible();
			expect(health.registrationWrites).toEqual([]);
		});

		test('S5 pets are capped at ten per household', async ({ page }) => {
			await openPreRegister(page);
			await openPets(page);
			const add = page.locator('#unified-pets').getByRole('button', { name: 'แมว', exact: true });
			for (let i = 0; i < 10; i++) await add.click();
			await expect(add).toBeDisabled();
			await expect(
				page.getByText('บันทึกสัตว์เลี้ยงได้สูงสุด 10 ตัวต่อครอบครัว').first()
			).toBeVisible();
		});

		test('S6 a failing shelter list shows the load error instead of a broken form', async ({
			page,
			health
		}) => {
			health.allow(/500|Failed to load resource/);
			await page.route('**/api/public/v1/shelters', (route) =>
				route.fulfill({
					status: 500,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'UPSTREAM_DOWN' })
				})
			);
			await page.goto('/pre-register?shelter=unassigned');
			await expect(
				page.getByText('ไม่สามารถโหลดข้อมูลศูนย์พักพิงได้ กรุณาลองใหม่อีกครั้ง')
			).toBeVisible();
			await expect(page.locator('#address-no')).toHaveCount(0);
			await expect(page.getByRole('button', { name: SUBMIT_LABEL })).toHaveCount(0);
		});
	}
);

// =============================================================== U — layout, i18n

test.describe('Pre-register: layout and language (U)', { tag: ['@pre-register', '@smoke'] }, () => {
	for (const viewport of [
		{ name: '1440 desktop', width: 1440, height: 900 },
		{ name: '390 phone', width: 390, height: 844 }
	]) {
		test(`U1 the sticky submit bar sits above the system banner at ${viewport.name}`, async ({
			page
		}) => {
			await page.setViewportSize({ width: viewport.width, height: viewport.height });
			await mockSystemBanner(page, true);
			await openPreRegister(page);
			await expect(page.locator('html')).toHaveAttribute('data-system-banner', '');
			const banner = page.getByRole('status').filter({ hasText: 'ทดสอบระบบ' });
			await expect(banner).toBeVisible();
			const bar = page.locator('.unified-reg-bottom-chrome');
			await expect(bar).toBeVisible();

			const noOverlap = async () => {
				const [barBox, bannerBox] = [await bar.boundingBox(), await banner.boundingBox()];
				expect(barBox).not.toBeNull();
				expect(bannerBox).not.toBeNull();
				expect(barBox!.y + barBox!.height).toBeLessThanOrEqual(bannerBox!.y + 1);
			};
			// The bar only starts to stick once the form column is in view (on a phone the
			// form starts below the fold), so scroll into the middle of the form first.
			await page.evaluate(() => window.scrollTo({ top: 1200, behavior: 'instant' }));
			await settleScroll(page);
			await noOverlap(); // stuck to the viewport bottom while the form scrolls
			await page.evaluate(() =>
				window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' })
			);
			await settleScroll(page);
			await noOverlap(); // and at the very end of the form
			await expect(submitButton(page)).toBeVisible();
			const [button, bannerBox] = [
				await submitButton(page).boundingBox(),
				await banner.boundingBox()
			];
			expect(button!.y + button!.height).toBeLessThanOrEqual(bannerBox!.y + 1);
		});
	}

	for (const width of [360, 390]) {
		test(`U2 the page fits ${width}px: no sideways scroll, brand uncut, tabs on one line`, async ({
			page
		}) => {
			await page.setViewportSize({ width, height: 800 });
			await NO_BANNER(page);
			await openPreRegister(page);

			const overflow = await page.evaluate(
				() => document.documentElement.scrollWidth - window.innerWidth
			);
			expect(overflow).toBeLessThanOrEqual(0);

			const brand = page.locator('header').getByText('PSU Smart Shelter', { exact: true });
			await expect(brand).toBeVisible();
			expect(await brand.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

			const tabs = [
				page.getByRole('button', { name: 'ลงทะเบียนใหม่' }),
				page.getByRole('button', { name: 'ใบลงทะเบียนของฉัน' })
			];
			const boxes = await Promise.all(tabs.map((t) => t.boundingBox()));
			expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThan(2);
			for (const [i, tab] of tabs.entries()) {
				// one text line: the button is not taller than a single-line control
				expect(boxes[i]!.height, `tab ${i} height`).toBeLessThan(48);
				expect(await tab.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
			}
			// the register link is icon-only here but still announced
			await expect(
				page.locator('header').getByRole('link', { name: 'ลงทะเบียนล่วงหน้า', exact: true })
			).toBeVisible();
		});
	}

	test('U3 switching to English retitles the page', async ({ page }) => {
		await openPreRegister(page);
		await page.getByRole('button', { name: 'Switch to English' }).click();
		await expect(page.getByRole('heading', { name: 'Pre-registration', level: 1 })).toBeVisible();
		await expect(page.getByRole('button', { name: 'My registrations' })).toBeVisible();
		await expect(page).toHaveTitle('Pre-registration | SmartShelter');
		await page.getByRole('button', { name: 'เปลี่ยนเป็นภาษาไทย' }).click();
		await expect(page.getByRole('heading', { name: 'ลงทะเบียนล่วงหน้า', level: 1 })).toBeVisible();
	});

	test('U3 on a phone the language toggle lives in the hamburger menu', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await openPreRegister(page);
		// the header toggle is hidden below sm
		await expect(
			page.locator('header').getByRole('button', { name: 'Switch to English' })
		).toBeHidden();
		await page.getByRole('button', { name: /เปิดเมนู/ }).click();
		await page.getByRole('button', { name: /เปลี่ยนภาษา/ }).click();
		await page.keyboard.press('Escape');
		await expect(page.getByRole('heading', { name: 'Pre-registration', level: 1 })).toBeVisible();
	});
});

// =============================================================== W — live registration

const TICKET_STORAGE_KEY = 'smartshelter_public_booking_tickets';
const CLAIMED_TOAST = 'ใบลงทะเบียนได้รับการยืนยันเข้าศูนย์พักพิงแล้ว';
const QR_ALT_QUEUE = 'QR สำหรับแสดงต่อเจ้าหน้าที่ลงทะเบียนประจำศูนย์';
const QR_ALT_SHELTER = 'QR สำหรับยืนยันตัวตนที่ประตูศูนย์';
const FIRST_NAME = 'E2Eสมชาย';
const MEMBER2_NAME = 'E2Eสมหญิง';

function storedTicketCodes(page: Page): Promise<string[]> {
	return page.evaluate((key) => {
		try {
			const raw = JSON.parse(localStorage.getItem(key) ?? '[]') as { code: string }[];
			return raw.map((t) => t.code);
		} catch {
			return [];
		}
	}, TICKET_STORAGE_KEY);
}

/**
 * The ticket-status BFF allows 10 requests per sliding minute per IP (`registerLookupIpLimiter`).
 * Every real status request this file makes is timestamped in `statusHits`, so a test that is
 * about to spend `needed` more waits only until enough older hits have left the window — instead
 * of tripping a 429 (the sync only ever fires from the page, so the budget cannot be raised from
 * the test). Timestamps are taken on the response, i.e. never earlier than the server's own.
 */
const STATUS_LIMIT = 10;
const STATUS_WINDOW_MS = 61_000;
const statusHits: number[] = [];
async function waitForStatusBudget(needed: number): Promise<void> {
	for (;;) {
		const now = Date.now();
		while (statusHits.length > 0 && now - statusHits[0] >= STATUS_WINDOW_MS) statusHits.shift();
		if (statusHits.length + needed <= STATUS_LIMIT) return;
		await new Promise((r) => setTimeout(r, statusHits[0] + STATUS_WINDOW_MS - now));
	}
}

interface StatusCall {
	status: number;
	body: Record<string, unknown> | null;
}

/** Record the ticket-status BFF responses the page receives. */
function recordStatusCalls(page: Page): StatusCall[] {
	const calls: StatusCall[] = [];
	page.on('response', async (res) => {
		if (!res.url().includes('/api/public/v1/registrations/status')) return;
		statusHits.push(Date.now());
		calls.push({ status: res.status(), body: await res.json().catch(() => null) });
	});
	return calls;
}

/** Click the confirm button and return the registration POST's response. */
async function submitAndWait(page: Page, endpoint: 'unassigned-registrations' | 'registrations') {
	const [response] = await Promise.all([
		page.waitForResponse(
			(r) =>
				r.request().method() === 'POST' &&
				new URL(r.url()).pathname === `/api/public/v1/${endpoint}`
		),
		submitButton(page).click()
	]);
	return response;
}

test.describe(
	'Pre-register: unassigned registration against the real stack (W1–W4, W6)',
	{ tag: ['@pre-register', '@critical', '@release'] },
	() => {
		test.describe.configure({ mode: 'serial' });

		let context: BrowserContext;
		let page: Page;
		let health: PageHealth;
		let statusCalls: StatusCall[];
		let queueId = '';

		// This suite writes through the real reCAPTCHA gate (recaptcha-gate.ts) — a fake
		// __captchaToken never passes real Google verification — so disable the switch for
		// the duration of the writes and restore whatever it was set to beforehand.
		let adminContext: BrowserContext;
		let adminPage: Page;
		let recaptchaWasEnabled = true;

		test.beforeAll(async ({ browser }) => {
			if (!CAN_WRITE) return;
			context = await browser.newContext();
			page = await context.newPage();
			health = watchPage(page);
			statusCalls = recordStatusCalls(page);

			const admin = await bootstrapAdminSession();
			adminContext = await browser.newContext();
			adminPage = await adminContext.newPage();
			await routeBrowserCouchThroughApp(adminPage);
			await injectSession(adminPage, admin.user, admin.cookie);
			recaptchaWasEnabled = await setRecaptcha(adminPage, false);
		});
		test.afterAll(async () => {
			if (CAN_WRITE) await setRecaptcha(adminPage, recaptchaWasEnabled);
			await adminContext?.close();
			await context?.close();
		});
		test.beforeEach(() => {
			test.skip(!CAN_WRITE, READ_ONLY_REASON);
		});

		test('W1 a full family registers in the central queue and gets its QR ticket', async () => {
			test.setTimeout(120_000);
			liveWritesStarted = true;
			await page.goto('/');
			await page.getByRole('link', { name: 'ลงทะเบียนผู้ประสบภัยล่วงหน้า' }).click();
			await expect(page).toHaveURL(/\/pre-register\?shelter=unassigned$/);
			await expect(page.locator('#address-no')).toBeVisible({ timeout: 20_000 });
			await expect(shelterTrigger(page)).toContainText('ไม่ระบุศูนย์พักพิง');

			// address
			await fillAddress(page, {
				landmark: `E2E ใกล้ตลาดทดสอบ ${RUN_ID}`,
				houseNo: '99/9',
				villageNo: 'หมู่ 9 ถ.ทดสอบ'
			});
			await expect(page.locator('#postal_code')).toHaveValue('90110');

			// head of family + religion + emergency contact
			await fillMember(page, 0, {
				firstName: FIRST_NAME,
				lastName: LAST_NAME,
				nationalId: HEAD_ID,
				birthYear: '2535',
				gender: 'male',
				phone: HEAD_PHONE
			});
			await primaryCard(page).getByRole('button', { name: 'ไม่ระบุ', exact: true }).click();
			await page.getByRole('option', { name: 'อิสลาม' }).click();
			await fillEmergencyContact(page, {
				name: 'E2E ผู้ติดต่อฉุกเฉิน',
				phone: EMERGENCY_PHONE,
				relation: 'ญาติ'
			});

			// member 2 with vulnerable groups + a special need
			await page.getByRole('button', { name: 'เพิ่มสมาชิก', exact: true }).click();
			const card2 = memberCard(page, 2);
			await fillMember(page, 1, {
				firstName: MEMBER2_NAME,
				lastName: LAST_NAME,
				nationalId: MEMBER2_ID,
				birthYear: '2490',
				gender: 'female'
			});
			await openMemberAccordion(card2, 'กลุ่มเปราะบาง');
			await page.locator('#vg-1-elderly_dependent').click();
			await page.locator('#vg-1-chronic_illness').click();
			await openMemberAccordion(card2, 'ความต้องการพิเศษ');
			await card2.getByRole('checkbox', { name: 'ใช้วีลแชร์', exact: true }).last().click();

			// one cat
			await openPets(page);
			await page.getByRole('button', { name: 'เพิ่มแมว' }).click();
			await page.getByPlaceholder('เช่น ถุงเงิน, เจ้าส้ม, บ๊อบบี้').fill('มะลิ');
			await page.getByPlaceholder(/มีโรคประจำตัว/).fill(`แมวทดสอบ E2E ${RUN_ID}`);
			await page.getByText('มีกรง / สายจูง / ตะกร้า').click();

			await acceptDisclaimer(page);
			const response = await submitAndWait(page, 'unassigned-registrations');
			expect(response.status()).toBe(201);
			const body = (await response.json()) as { id: string; members: unknown[] };
			queueId = body.id;
			createdQueueIds.add(queueId);
			recordCreatedQueueId(queueId);
			expect(body.members).toHaveLength(2);

			// the ticket
			await expect(page.getByText('ลงทะเบียนล่วงหน้าสำเร็จ')).toBeVisible();
			await expect(page.getByAltText(QR_ALT_QUEUE)).toBeVisible();
			await expect(page.getByText(`${FIRST_NAME} ${LAST_NAME}`)).toBeVisible();
			await expect(page.getByText('2 คน', { exact: true })).toBeVisible();
			await expect(
				page.getByText('แสดง QR Code นี้ต่อเจ้าหน้าที่ เพื่อรับเข้าศูนย์')
			).toBeVisible();
			// the id rides in the QR only — never printed for a human
			await expect(page.getByText(queueId)).toHaveCount(0);
			await expect.poll(() => storedTicketCodes(page)).toContain(queueId);
			await expect(page.locator('main')).toMatchAriaSnapshot({ name: 'ticket.aria.yml' });
			expectHealthy(health);
		});

		test('W2 the ticket survives the history tab and a reload (BUG-01 regression)', async () => {
			test.setTimeout(90_000);
			const claimedToast = page.getByText(CLAIMED_TOAST);
			statusCalls.length = 0;

			await page.getByRole('button', { name: /ใบลงทะเบียนของฉัน/ }).click();
			await expect(page.getByText(`${FIRST_NAME} ${LAST_NAME}`)).toBeVisible();
			// the sync really asked the status endpoint, and was told "still waiting"
			await expect.poll(() => statusCalls.length, { timeout: 15_000 }).toBeGreaterThan(0);
			expect(statusCalls.at(-1)).toMatchObject({
				status: 200,
				body: { success: true, verified: false }
			});
			expect(statusCalls.at(-1)?.body).not.toHaveProperty('notFound');
			await expect(claimedToast).toHaveCount(0);
			expect(await storedTicketCodes(page)).toContain(queueId);

			// reload, open the tab again: the first sync after a reload is where BUG-01 deleted it
			statusCalls.length = 0;
			await page.reload();
			await page.getByRole('button', { name: /ใบลงทะเบียนของฉัน/ }).click();
			await expect(page.getByText(`${FIRST_NAME} ${LAST_NAME}`)).toBeVisible();
			await expect.poll(() => statusCalls.length, { timeout: 15_000 }).toBeGreaterThan(0);
			await expect(claimedToast).toHaveCount(0);
			expect(await storedTicketCodes(page)).toContain(queueId);

			// the QR is still reachable from the history list
			await page.getByText(`${FIRST_NAME} ${LAST_NAME}`).click();
			await expect(page.getByAltText(QR_ALT_QUEUE)).toBeVisible();
			expectHealthy(health);
		});

		test('W3 the status BFF reports the real ticket as still open, never as not found', async () => {
			// page.request fires no page 'response' events — count these two by hand
			const res = await page.request.post('/api/public/v1/registrations/status', {
				data: { code: queueId }
			});
			statusHits.push(Date.now());
			expect(res.status()).toBe(200);
			const body = (await res.json()) as Record<string, unknown>;
			expect(body).toMatchObject({ success: true, verified: false, status: 'open' });
			expect(body).not.toHaveProperty('notFound');

			// an id that never existed is the one case reported as not found
			const missing = await page.request.post('/api/public/v1/registrations/status', {
				data: { code: '01ZZZZZZZZZZZZZZZZZZZZZZZZ' }
			});
			statusHits.push(Date.now());
			expect(await missing.json()).toMatchObject({ verified: false, notFound: true });
		});

		test('W4 the same identity cannot enter the queue twice', async () => {
			test.setTimeout(90_000);
			health.problems.length = 0; // the 409 below logs a console error on purpose
			await page.goto(PRE_REGISTER_PATH);
			await expect(page.locator('#address-no')).toBeVisible({ timeout: 20_000 });
			await fillAddress(page);
			await fillMember(page, 0, {
				firstName: FIRST_NAME,
				lastName: LAST_NAME,
				nationalId: HEAD_ID,
				gender: 'male',
				phone: HEAD_PHONE
			});
			await acceptDisclaimer(page);
			const response = await submitAndWait(page, 'unassigned-registrations');
			expect(response.status()).toBe(409);
			expect(await response.json()).toMatchObject({
				success: false,
				error: 'DUPLICATE_OPEN_IDENTITY'
			});
			await expect(
				page
					.locator('[data-sonner-toast]')
					.filter({ hasText: 'เลขบัตรประชาชน หรือ เบอร์โทรศัพท์นี้ลงทะเบียนเรียบร้อยแล้ว' })
			).toBeVisible();
			// nothing was lost: the form keeps what was typed and no ticket appeared
			await expect(page.locator('#member-0-first-name')).toHaveValue(FIRST_NAME);
			await expect(page.locator('#member-0-card-number')).toHaveValue(HEAD_ID);
			await expect(page.getByText('ลงทะเบียนล่วงหน้าสำเร็จ')).toHaveCount(0);
			expect(health.problems.filter((p) => !/409/.test(p))).toEqual([]);
			// and the queue still holds exactly the one registration of this run
			expect(await listUnassignedRegistrations(LAST_NAME)).toEqual([queueId]);
		});

		test('W6 the stored registration matches what was typed', async () => {
			const doc = (await getUnassignedRegistration(queueId)) as {
				status: string;
				household: Record<string, unknown> & { pets: Record<string, unknown>[] };
				members: Record<string, unknown>[];
			};
			expect(doc.status).toBe('open');
			expect(doc.household).toMatchObject({
				housing_type: 'owned_house',
				residence_landmark: `E2E ใกล้ตลาดทดสอบ ${RUN_ID}`,
				address_no: '99/9',
				village_no: 'หมู่ 9 ถ.ทดสอบ',
				subdistrict: 'คอหงส์',
				district: 'หาดใหญ่',
				province: 'สงขลา',
				postal_code: '90110'
			});
			expect(doc.household.pets).toHaveLength(1);
			expect(doc.household.pets[0]).toMatchObject({ species: 'cat', has_cage: true });
			expect(String(doc.household.pets[0].notes)).toContain('มะลิ');
			expect(String(doc.household.pets[0].notes)).toContain(`แมวทดสอบ E2E ${RUN_ID}`);

			expect(doc.members).toHaveLength(2);
			const [head, second] = doc.members;
			expect(head).toMatchObject({
				status: 'open',
				first_name: FIRST_NAME,
				last_name: LAST_NAME,
				gender: 'male',
				phone: HEAD_PHONE,
				birth_year: 2535,
				religion: 'muslim',
				country: 'THAILAND',
				emergency_contact: {
					name: 'E2E ผู้ติดต่อฉุกเฉิน',
					phone: EMERGENCY_PHONE,
					relation: 'ญาติ'
				}
			});
			// Public channel omits the nickname field — stored value stays empty/absent.
			expect(head.nickname == null || head.nickname === '').toBe(true);
			expect(head.person_id).toMatchObject({ number: HEAD_ID });
			expect(head.vulnerable_groups).toEqual([]);
			expect(second).toMatchObject({
				status: 'open',
				first_name: MEMBER2_NAME,
				last_name: LAST_NAME,
				gender: 'female',
				birth_year: 2490
			});
			expect(second.person_id).toMatchObject({ number: MEMBER2_ID });
			expect([...(second.vulnerable_groups as string[])].sort()).toEqual([
				'chronic_illness',
				'elderly_dependent'
			]);
			expect(second.special_needs).toEqual(['ใช้วีลแชร์']);
		});
	}
);

test.describe(
	'Pre-register: shelter booking against the real stack (W5, W6)',
	{ tag: ['@pre-register', '@critical', '@release'] },
	() => {
		test.describe.configure({ mode: 'serial' });

		const SHELTER_NAME = `E2E ศูนย์ทดสอบจองล่วงหน้า ${RUN_ID}`;
		let context: BrowserContext;
		let page: Page;
		let health: PageHealth;
		let statusCalls: StatusCall[];
		let ticketCode = '';

		// This booking also writes through the real reCAPTCHA gate (recaptcha-gate.ts) — see
		// the W1-W4/W6 block above for why it must be disabled for the duration of the writes.
		let adminContext: BrowserContext;
		let adminPage: Page;
		let recaptchaWasEnabled = true;
		const canWrite = () => CAN_WRITE && Boolean(process.env.COUCHDB_PUBLIC_WRITER_URL);

		test.beforeEach(() => {
			test.skip(!CAN_WRITE, READ_ONLY_REASON);
			// the production-mode app writes bookings as the limited `public_writer` CouchDB user
			test.skip(
				!process.env.COUCHDB_PUBLIC_WRITER_URL,
				'COUCHDB_PUBLIC_WRITER_URL is not set (and public_writer provisioned via pnpm seed:master)'
			);
		});
		test.beforeAll(async ({ browser }) => {
			if (!canWrite()) return;
			const admin = await bootstrapAdminSession();
			adminContext = await browser.newContext();
			adminPage = await adminContext.newPage();
			await routeBrowserCouchThroughApp(adminPage);
			await injectSession(adminPage, admin.user, admin.cookie);
			recaptchaWasEnabled = await setRecaptcha(adminPage, false);
		});
		test.afterAll(async () => {
			if (canWrite()) await setRecaptcha(adminPage, recaptchaWasEnabled);
			await adminContext?.close();
			await context?.close();
		});

		test('W5 staff opens a shelter to pre-registration; a citizen books it and keeps the ticket', async ({
			browser,
			baseURL
		}) => {
			test.setTimeout(240_000);
			liveWritesStarted = true;

			// staff: create the shelter through the UI, accepting pre-registrations
			const staffContext = await browser.newContext();
			const staffPage = await staffContext.newPage();
			const admin = await bootstrapAdminSession();
			await routeBrowserCouchThroughApp(staffPage);
			await injectSession(staffPage, admin.user, admin.cookie);
			shelterCode = await createShelterViaUi(staffPage, {
				name: SHELTER_NAME,
				siteKind: 'evacuation_center',
				lat: 7.0,
				lng: 100.48,
				subdistrict: 'คอหงส์',
				capacity: 40,
				acceptsPreRegistration: true
			});
			recordCreatedShelter(shelterCode);
			await staffContext.close();

			// the worker projects it asynchronously — wait until the public API offers it
			await waitForProjection('shelter bookable in /shelters', async () => {
				const res = await fetch(`${baseURL}/api/public/v1/shelters`);
				const { shelters } = (await res.json()) as {
					shelters: { code: string; status: string; accepts_pre_registration?: boolean }[];
				};
				const row = shelters.find((s) => s.code === shelterCode);
				return row?.status === 'open' && row.accepts_pre_registration === true;
			});

			// citizen: a fresh browser, no staff session
			context = await browser.newContext();
			page = await context.newPage();
			health = watchPage(page);
			statusCalls = recordStatusCalls(page);
			await page.goto('/pre-register');
			await expect(page.locator('#address-no')).toBeVisible({ timeout: 20_000 });
			await chooseShelter(page, new RegExp(SHELTER_NAME));
			await expect(page).toHaveURL(new RegExp(`shelter=${shelterCode}`));
			await expect(shelterTrigger(page)).toContainText(SHELTER_NAME);

			await fillAddress(page, { houseNo: '5/5' });
			await fillMember(page, 0, {
				firstName: FIRST_NAME,
				lastName: LAST_NAME,
				nationalId: fictitiousNationalId((Number.parseInt(RUN_ID, 36) + 2) % 1e11),
				gender: 'female',
				phone: fictitiousPhone(31)
			});
			await openMemberAccordion(primaryCard(page), 'กลุ่มเปราะบาง');
			await page.locator('#vg-0-pregnant').click();

			const response = await submitAndWait(page, 'registrations');
			expect(response.status()).toBe(201);
			const body = (await response.json()) as {
				code: string;
				shelter_code: string;
				status: string;
			};
			ticketCode = body.code;
			expect(body.shelter_code).toBe(shelterCode);

			await expect(page.getByAltText(QR_ALT_SHELTER)).toBeVisible();
			await expect(page.getByText(SHELTER_NAME).first()).toBeVisible();
			await expect(page.getByText(`${FIRST_NAME} ${LAST_NAME}`)).toBeVisible();
			await expect.poll(() => storedTicketCodes(page)).toContain(ticketCode);

			// reload → the ticket is still in "my registrations" and still pending
			// the reload's mount sync + the history tab's own sync, one ticket each
			await waitForStatusBudget(2);
			statusCalls.length = 0;
			await page.reload();
			await page.getByRole('button', { name: /ใบลงทะเบียนของฉัน/ }).click();
			await expect(page.getByText(`${FIRST_NAME} ${LAST_NAME}`)).toBeVisible();
			await expect.poll(() => statusCalls.length, { timeout: 15_000 }).toBeGreaterThan(0);
			expect(statusCalls.at(-1)).toMatchObject({
				status: 200,
				body: { success: true, verified: false, status: 'pre_registered' }
			});
			await expect(page.getByText(CLAIMED_TOAST)).toHaveCount(0);
			expect(await storedTicketCodes(page)).toContain(ticketCode);
			expectHealthy(health);
		});

		test('W6 the booked evacuee and household in CouchDB match what was typed', async () => {
			const db = `shelter_${shelterCode!.toLowerCase()}`;
			const res = await couchReq('GET', `/${db}/_all_docs?include_docs=true`);
			expect(res.status).toBe(200);
			const docs = (res.data as { rows: { doc: Record<string, unknown> }[] }).rows.map(
				(r) => r.doc
			);
			const evacuees = docs.filter((d) => d.type === 'evacuee' && d.last_name === LAST_NAME);
			const households = docs.filter((d) => d.type === 'household');
			expect(evacuees).toHaveLength(1);
			expect(households).toHaveLength(1);
			expect(evacuees[0]).toMatchObject({
				first_name: FIRST_NAME,
				gender: 'female',
				vulnerable_groups: ['pregnant'],
				current_stay: { status: 'pre_registered' }
			});
			expect(households[0]).toMatchObject({
				address_no: '5/5',
				subdistrict: 'คอหงส์',
				district: 'หาดใหญ่',
				province: 'สงขลา',
				postal_code: '90110'
			});
		});
	}
);

// =============================================================== zero-leak

/** Registered last, so it runs after every W group. */
test.describe(
	'Pre-register: teardown leaves nothing behind',
	{ tag: ['@pre-register', '@critical', '@release'] },
	() => {
		test.beforeEach(() => {
			test.skip(!CAN_WRITE, READ_ONLY_REASON);
		});

		test('Z the central queue and CouchDB hold nothing of this run', async () => {
			test.setTimeout(240_000);
			// remove what this suite created (ledger + this run's registrations) …
			const created = await purgeCreatedData(LAST_NAME, createdQueueIds);
			// … then prove it is gone
			expect(await listUnassignedRegistrations(LAST_NAME)).toEqual([]);
			for (const id of created.queue) expect(await getUnassignedRegistration(id)).toBeNull();
			for (const code of created.shelters) {
				expect((await couchReq('GET', `/shelter_${code.toLowerCase()}`)).status).toBe(404);
				const byCode = await couchReq(
					'GET',
					`/registry/_design/app/_view/by_code?key=${encodeURIComponent(JSON.stringify(code))}`
				);
				expect((byCode.data as { rows: unknown[] }).rows).toEqual([]);
			}
			// the top-level afterAll safety net finds nothing left to do
			shelterCode = undefined;
			createdQueueIds.clear();
		});
	}
);
