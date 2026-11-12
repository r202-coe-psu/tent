/**
 * Food sphere analysis page — supply `?tab=food-sphere` ("วิเคราะห์เสบียงอาหาร").
 *
 * One live suite against the real stack, read-only on the page: it opens SH001's analysis tab as
 * three real roles and never saves anything. Assertions are data-adaptive (they compare the
 * page with itself, e.g. a status card's count with the rows it filters to), so they hold on
 * any seeded shelter without hardcoding stock numbers.
 *
 * Covers:
 *   - structure: header, six summary cards with a hint each, search, filters, column headers
 *   - labels: plain Thai only (no "DoC", "ความคุ้มครอง", "สั่งเติม"), "คงเหลือ" replaces the
 *     duplicate "สต็อกจริง" / "ใช้งานได้จริง" columns
 *   - consistency: every status card's count equals the rows it filters to, each row's badge
 *     carries that status, and the five status counts add up to "ทั้งหมด"
 *   - search / clear filters / expand and collapse all
 *   - phone width: card layout, no horizontal page scroll
 *   - roles (CR-235): warehouse_staff and SA see "ตั้งค่าพารามิเตอร์" and can open its sheet;
 *     supply_coordinator sees the analysis but no edit buttons
 *   - page health: no console errors / pageerror / failed responses
 *   - create / update / delete (second describe, own E2E shelter): warehouse_staff creates a group,
 *     turns a central group into a shelter override, renames it, deactivates and reactivates it,
 *     and edits a replenishment policy; supply_coordinator is refused by CouchDB (403)
 *
 * Data safety (first describe): the page is only read. The suite writes just three throwaway `_users` accounts
 * (`E2E FoodSphere` + run id) and the last test asserts they are gone. SH001 is read, never
 * modified. The CUD describe never touches SH001 or the central catalog: it creates its own
 * `E2E FoodSphere CUD <run id>` shelter through the staff UI, all writes land in that shelter's
 * database, and its Z test drops the shelter and the accounts (zero-leak). Tags: `@critical` (creates accounts, so it needs CAN_WRITE: local, or a remote with
 * ALLOW_REMOTE_WRITES=true) + `@food-sphere`.
 *
 * Local run (slow, watch it):
 *   docker compose up -d && cd frontend && pnpm seed:master   # once
 *   pnpm exec vite build --mode test
 *   PLAYWRIGHT_TEST_BASE_URL=http://localhost:4173 PW_SLOWMO=400 \
 *     pnpm exec playwright test e2e/food-sphere-analysis.test.ts --headed --workers=1
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import {
	allDocuments,
	bootstrapAdminSession,
	COUCH_BASE,
	couchLogin,
	couchReq,
	createCouchUser,
	deleteCouchUser,
	getDocument,
	seedSecurityQuestion,
	SA_ROLES,
	type TestUser
} from './helpers/couch';
import { CAN_WRITE, LOCAL_RUN_ID as RUN_ID, READ_ONLY_REASON } from './helpers/e2e-env';
import { clearSession, injectSession, routeBrowserCouchThroughApp } from './helpers/login';
import { expectHealthy, watchPage } from './helpers/pre-register';
import { recordCreatedShelter, teardownShelter } from './helpers/public-cleanup';
import { createShelterViaUi, pinActiveShelter } from './helpers/staff-ui';

const SHELTER = 'SH001';
const PAGE_PATH = '/back-office/supply?tab=food-sphere';
const PASSWORD = 'Password1!';

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 15_000 });

const SA: TestUser = {
	name: `fsa_sa_${RUN_ID}`,
	password: PASSWORD,
	roles: SA_ROLES,
	display_name: 'E2E FoodSphere SA'
};
const WAREHOUSE: TestUser = {
	name: `fsa_wh_${RUN_ID}`,
	password: PASSWORD,
	roles: [`shelter:${SHELTER}`, 'warehouse_staff'],
	display_name: 'E2E FoodSphere Warehouse'
};
const SUPPLY: TestUser = {
	name: `fsa_sc_${RUN_ID}`,
	password: PASSWORD,
	roles: [`shelter:${SHELTER}`, 'supply_coordinator'],
	display_name: 'E2E FoodSphere Supply'
};
const USERS = [SA, WAREHOUSE, SUPPLY];
const sessions: Record<string, string> = {};

/** Status cards in page order. `key` is the card label, `badge` is the row badge text it filters to. */
const STATUS_CARDS = [
	{ label: 'เสี่ยงขาดของ', hint: 'เหลือใช้น้อยกว่าเวลารอที่กำหนด' },
	{ label: 'ควรจัดหาเพิ่ม', hint: 'ของเหลือถึงจุดที่ควรเริ่มหาเพิ่มแล้ว' },
	{ label: 'เพียงพอ', hint: 'ใช้ได้นานพอ ยังไม่ต้องหาเพิ่ม' },
	{ label: 'ของเกินจำเป็น', hint: 'มีมากกว่าจำนวนวันสูงสุดที่ตั้งไว้' },
	{ label: 'ยังไม่ตั้งนโยบาย', hint: 'ตั้งที่แท็บ นโยบายการเติมสต็อก' }
] as const;
const ALL_CARD = { label: 'ของทั้งหมด', hint: 'รายการที่วิเคราะห์' } as const;

/** Words the page must not show: jargon and the "ordering" wording the system does not support. */
const BANNED_WORDS = ['DoC', 'ความคุ้มครอง', 'สั่งเติม', 'สั่งเพิ่ม', 'Item Maps', 'สต็อกจริง'];

test.beforeAll(async () => {
	if (!CAN_WRITE) return;
	for (const user of USERS) {
		await createCouchUser(user);
		await seedSecurityQuestion(user.name);
		sessions[user.name] = await couchLogin(user.name, user.password);
	}
});

test.afterAll(async () => {
	if (!CAN_WRITE) return;
	for (const user of USERS) await deleteCouchUser(user.name);
});

test.beforeEach(() => {
	test.skip(!CAN_WRITE, READ_ONLY_REASON);
});

test.afterEach(async ({ page }) => {
	await clearSession(page);
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Sign in as `user`, pin SH001 and open the analysis tab once its data has loaded. */
async function openAnalysis(page: Page, user: TestUser): Promise<void> {
	await routeBrowserCouchThroughApp(page);
	await injectSession(page, user, sessions[user.name]);
	await pinActiveShelter(page, SHELTER);
	await page.goto(PAGE_PATH);
	await expect(page.getByRole('heading', { name: 'วิเคราะห์เสบียงอาหาร' })).toBeVisible({
		timeout: 30_000
	});
	await expect(
		page.getByRole('status', { name: /กำลังโหลดข้อมูลการวิเคราะห์เสบียงอาหาร/ })
	).toHaveCount(0, { timeout: 30_000 });
}

function cardsRegion(page: Page): Locator {
	return page.getByRole('region', { name: 'สรุปสถานะเสบียง' });
}

function card(page: Page, label: string): Locator {
	return cardsRegion(page).getByRole('button', { name: new RegExp(`^${label}`) });
}

/** The big number on a card (second line of its text: label, count, hint). */
async function cardCount(page: Page, label: string): Promise<number> {
	const lines = (await card(page, label).innerText())
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
	return Number(lines[1]);
}

/** "กำลังแสดง N รายการ…" — the number of items the current filters leave. */
async function shownCount(page: Page): Promise<number> {
	const text = await page
		.locator('p', { hasText: /กำลังแสดง/ })
		.first()
		.innerText();
	const match = text.replace(/\s+/g, ' ').match(/กำลังแสดง (\d+) รายการ/);
	if (!match) throw new Error(`Cannot read the shown-items count from: ${text}`);
	return Number(match[1]);
}

async function expandAll(page: Page): Promise<void> {
	await page.getByRole('button', { name: 'ขยายทั้งหมด' }).click();
}

/** Status badges currently visible (the phone list and the desktop table both render, one is hidden). */
function visibleBadges(page: Page): Locator {
	return page.locator('[data-testid^="doc-badge-"]:visible');
}

// ─── Suite ────────────────────────────────────────────────────────────────────

test.describe('Food sphere analysis page', { tag: ['@critical', '@food-sphere'] }, () => {
	test('A1: SA sees the header, six summary cards with hints, search and filters', async ({
		page
	}) => {
		const health = watchPage(page);
		await openAnalysis(page, SA);

		await expect(page.getByRole('button', { name: 'ขยายทั้งหมด' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'ย่อทั้งหมด' })).toBeVisible();
		await expect(page.getByLabel('ค้นหารายการเสบียง')).toBeVisible();

		for (const c of [ALL_CARD, ...STATUS_CARDS]) {
			const button = card(page, c.label);
			await expect(button, `card "${c.label}"`).toBeVisible();
			await expect(button).toContainText(c.hint);
			// "ของทั้งหมด" is the active filter on first load; the five status cards start unpressed
			await expect(button).toHaveAttribute('aria-pressed', c === ALL_CARD ? 'true' : 'false');
		}

		// the status filter offers the same six choices
		const statusSelect = page.getByLabel('กรองสถานะ');
		for (const label of ['ทั้งหมด', ...STATUS_CARDS.map((c) => c.label)]) {
			await expect(statusSelect.locator('option', { hasText: label }).first()).toBeAttached();
		}
		expectHealthy(health);
	});

	test('A2: wording is plain Thai and the two stock columns became one "คงเหลือ"', async ({
		page
	}) => {
		await openAnalysis(page, SA);
		test.skip(
			(await cardCount(page, ALL_CARD.label)) === 0,
			'this shelter has no items to analyse'
		);
		await expandAll(page);

		const body = page.locator('body');
		for (const word of BANNED_WORDS) {
			await expect(body, `page must not show "${word}"`).not.toContainText(word);
		}

		const desktop = page.viewportSize() && page.viewportSize()!.width >= 768;
		if (desktop) {
			const headers = page.locator('table:visible thead th');
			await expect(headers.filter({ hasText: 'คงเหลือ' }).first()).toBeVisible();
			await expect(headers.filter({ hasText: 'ใช้ได้อีก (วัน)' }).first()).toBeVisible();
			await expect(headers.filter({ hasText: 'สต็อกจริง' })).toHaveCount(0);
			await expect(headers.filter({ hasText: 'ใช้งานได้จริง' })).toHaveCount(0);
		}
	});

	test('A3: every status card matches the rows it filters to', async ({ page }) => {
		const health = watchPage(page);
		await openAnalysis(page, SA);

		const total = await cardCount(page, ALL_CARD.label);
		test.skip(total === 0, 'this shelter has no items to analyse');
		await expect
			.poll(() => shownCount(page), { message: 'unfiltered list shows every counted item' })
			.toBe(total);

		let sum = 0;
		for (const c of STATUS_CARDS) sum += await cardCount(page, c.label);
		expect(sum, 'the five status counts add up to "ทั้งหมด"').toBe(total);

		for (const c of STATUS_CARDS) {
			const count = await cardCount(page, c.label);
			await card(page, c.label).click();
			await expect(card(page, c.label)).toHaveAttribute('aria-pressed', 'true');
			await expect
				.poll(() => shownCount(page), { message: `"${c.label}" card vs shown items` })
				.toBe(count);

			if (count > 0) {
				await expandAll(page);
				const badges = visibleBadges(page);
				await expect(badges).toHaveCount(count);
				for (const text of await badges.allInnerTexts()) {
					expect(text, `badge in "${c.label}" filter`).toContain(c.label);
				}
			} else {
				await expect(page.getByText('ไม่พบรายการเสบียงตามเงื่อนไขที่เลือก')).toBeVisible();
			}

			// pressing the active card again goes back to the full list
			await card(page, c.label).click();
			await expect(card(page, c.label)).toHaveAttribute('aria-pressed', 'false');
			await expect.poll(() => shownCount(page)).toBe(total);
		}
		expectHealthy(health);
	});

	test('A4: the status dropdown filters like the cards, and "ล้างตัวกรอง" resets it', async ({
		page
	}) => {
		await openAnalysis(page, SA);
		const total = await cardCount(page, ALL_CARD.label);
		test.skip(total === 0, 'this shelter has no items to analyse');

		const pick = STATUS_CARDS.find((c) => c.label === 'ยังไม่ตั้งนโยบาย')!;
		const count = await cardCount(page, pick.label);
		await page.getByLabel('กรองสถานะ').selectOption('UNCONFIGURED');
		await expect.poll(() => shownCount(page)).toBe(count);
		await expect(card(page, pick.label)).toHaveAttribute('aria-pressed', 'true');

		await page.getByRole('button', { name: 'ล้างตัวกรอง' }).first().click();
		await expect.poll(() => shownCount(page)).toBe(total);
		await expect(card(page, pick.label)).toHaveAttribute('aria-pressed', 'false');
	});

	test('A5: searching for nothing shows the empty state, clearing brings the list back', async ({
		page
	}) => {
		await openAnalysis(page, SA);
		const total = await cardCount(page, ALL_CARD.label);
		test.skip(total === 0, 'this shelter has no items to analyse');

		const search = page.getByLabel('ค้นหารายการเสบียง');
		await search.fill(`ไม่มีสินค้านี้ ${RUN_ID}`);
		await expect(page.getByText('ไม่พบรายการเสบียงตามเงื่อนไขที่เลือก')).toBeVisible();
		await expect.poll(() => shownCount(page)).toBe(0);

		await page.getByRole('button', { name: 'ล้างคำค้นหา' }).click();
		await expect(search).toHaveValue('');
		await expect.poll(() => shownCount(page)).toBe(total);
	});

	test('A6: expand all opens every group and collapse all closes them', async ({ page }) => {
		await openAnalysis(page, SA);
		test.skip(
			(await cardCount(page, ALL_CARD.label)) === 0,
			'this shelter has no items to analyse'
		);

		await expandAll(page);
		const expanded = await visibleBadges(page).count();
		expect(expanded, 'rows are visible after "ขยายทั้งหมด"').toBeGreaterThan(0);

		await page.getByRole('button', { name: 'ย่อทั้งหมด' }).click();
		await expect(visibleBadges(page)).toHaveCount(0);
	});

	test('A7: on a phone the rows become cards and the page does not scroll sideways', async ({
		page
	}) => {
		await page.setViewportSize({ width: 375, height: 812 });
		await openAnalysis(page, SA);
		test.skip(
			(await cardCount(page, ALL_CARD.label)) === 0,
			'this shelter has no items to analyse'
		);
		await expandAll(page);

		await expect(cardsRegion(page)).toBeVisible();
		await expect(page.locator('table:visible')).toHaveCount(0);
		await expect(visibleBadges(page).first()).toBeVisible();
		// the card hints stay readable on a phone
		await expect(card(page, STATUS_CARDS[0].label)).toContainText(STATUS_CARDS[0].hint);

		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow, 'horizontal page overflow in px').toBeLessThanOrEqual(1);
	});

	test('R1: warehouse_staff can open the parameter sheet from the analysis page', async ({
		page
	}) => {
		const health = watchPage(page);
		await openAnalysis(page, WAREHOUSE);

		const open = page.getByRole('button', { name: 'ตั้งค่าพารามิเตอร์' });
		await expect(open).toBeVisible();
		await open.click();
		const sheet = page.getByRole('dialog');
		await expect(sheet).toBeVisible();
		await expect(sheet.getByText('ตั้งค่าพารามิเตอร์สต็อกของศูนย์')).toBeVisible();
		for (const tab of ['นโยบายการเติมสต็อก', 'กลุ่มสำหรับการคำนวณ', 'พารามิเตอร์อ้างอิงอาหาร']) {
			await expect(sheet.getByRole('tab', { name: tab })).toBeVisible();
		}
		await page.keyboard.press('Escape');
		await expect(sheet).toBeHidden();
		expectHealthy(health);
	});

	test('R2: supply_coordinator sees the analysis but no edit buttons (CR-235)', async ({
		page
	}) => {
		await openAnalysis(page, SUPPLY);

		await expect(card(page, ALL_CARD.label)).toBeVisible();
		await expect(page.getByRole('button', { name: 'ตั้งค่าพารามิเตอร์' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: /^แก้ไขกลุ่ม / })).toHaveCount(0);
	});

	test('R3: SA sees a per-group edit button next to each configured group', async ({ page }) => {
		await openAnalysis(page, SA);
		test.skip(
			(await cardCount(page, ALL_CARD.label)) === 0,
			'this shelter has no items to analyse'
		);

		await expect(page.getByRole('button', { name: 'ตั้งค่าพารามิเตอร์' })).toBeVisible();
		const editButtons = page.getByRole('button', { name: /^แก้ไขกลุ่ม / });
		test.skip((await editButtons.count()) === 0, 'this shelter has only the general group');
		await editButtons.first().click();
		await expect(page.getByRole('dialog')).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog')).toBeHidden();
	});

	test('Z: teardown leaves no E2E account behind', async () => {
		for (const user of USERS) await deleteCouchUser(user.name);
		for (const user of USERS) {
			const res = await couchReq(
				'GET',
				`/_users/org.couchdb.user:${encodeURIComponent(user.name)}`
			);
			expect(res.status, `account ${user.name} removed`).toBe(404);
		}
	});
});

// ─── Create / update / delete (own E2E shelter) ───────────────────────────────

const LEDGER_SUITE = 'food-sphere-analysis';
const GROUP_NAME = 'กลุ่มน้ำดื่มสะอาด'; // central group DRINKING_WATER (seeded baseline)
const GROUP_ID = 'DRINKING_WATER';
const FRESH_ID = `E2E_${RUN_ID.toUpperCase().replace(/[^A-Z0-9]/g, '')}`;
const FRESH_NAME = `E2E กลุ่มทดสอบ ${RUN_ID}`;
const RENAMED = `${GROUP_NAME} E2E ${RUN_ID}`;
const RENAMED_AGAIN = `${GROUP_NAME} E2E2 ${RUN_ID}`;

let cudShelter: string | undefined;
let cudWarehouse: TestUser | undefined;
let cudSupply: TestUser | undefined;
const cudSessions: Record<string, string> = {};

const cudDb = () => `shelter_${cudShelter!.toLowerCase()}`;
const groupDocId = (id: string) => `requirement_group:${id}`;

const toast = (page: Page, text: string) =>
	page.locator('[data-sonner-toast]').filter({ hasText: text });

/** Open the parameter sheet on `tab` and return it. */
async function openSheet(page: Page, tab: string): Promise<Locator> {
	await page.getByRole('button', { name: 'ตั้งค่าพารามิเตอร์' }).click();
	const sheet = page.getByRole('dialog', { name: 'ตั้งค่าพารามิเตอร์สต็อกของศูนย์' });
	await expect(sheet).toBeVisible();
	await sheet.getByRole('tab', { name: tab }).click();
	return sheet;
}

async function closeSheet(page: Page): Promise<void> {
	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog', { name: 'ตั้งค่าพารามิเตอร์สต็อกของศูนย์' })).toBeHidden();
}

const groupRow = (sheet: Locator, id: string) => sheet.getByRole('row').filter({ hasText: id });
const groupHeader = (page: Page, name: string) =>
	page.getByRole('button', { name: new RegExp(`^${name} \\d+ รายการ`) });

/** Open the analysis tab of the E2E shelter as `user`. */
async function openCudAnalysis(page: Page, user: TestUser): Promise<void> {
	await routeBrowserCouchThroughApp(page);
	await injectSession(page, user, cudSessions[user.name]);
	await pinActiveShelter(page, cudShelter!);
	await page.goto(PAGE_PATH);
	await expect(page.getByRole('heading', { name: 'วิเคราะห์เสบียงอาหาร' })).toBeVisible({
		timeout: 30_000
	});
	await expect(
		page.getByRole('status', { name: /กำลังโหลดข้อมูลการวิเคราะห์เสบียงอาหาร/ })
	).toHaveCount(0, { timeout: 30_000 });
}

test.describe(
	'Food sphere parameters: create, update, delete',
	{ tag: ['@critical', '@food-sphere'] },
	() => {
		test.describe.configure({ mode: 'serial' });

		// A failed test skips the rest of the serial run, Z included: still drop the shelter and
		// accounts so a red run leaves nothing behind. Idempotent after Z.
		test.afterAll(async () => {
			test.setTimeout(240_000);
			if (cudShelter) await teardownShelter(cudShelter);
			for (const user of [cudWarehouse, cudSupply]) if (user) await deleteCouchUser(user.name);
			cudShelter = undefined;
		});

		test('C0: set up an E2E shelter and two accounts', async ({ page }) => {
			test.setTimeout(180_000);
			const admin = await bootstrapAdminSession();
			await routeBrowserCouchThroughApp(page);
			await injectSession(page, admin.user, admin.cookie);
			cudShelter = await createShelterViaUi(page, {
				name: `E2E FoodSphere CUD ${RUN_ID}`,
				siteKind: 'evacuation_center',
				lat: 7.006,
				lng: 100.498,
				subdistrict: 'คอหงส์',
				capacity: 60
			});
			recordCreatedShelter(cudShelter, LEDGER_SUITE);

			cudWarehouse = {
				name: `fsa_cud_wh_${RUN_ID}`,
				password: PASSWORD,
				roles: [`shelter:${cudShelter}`, 'warehouse_staff'],
				display_name: 'E2E FoodSphere CUD Warehouse'
			};
			cudSupply = {
				name: `fsa_cud_sc_${RUN_ID}`,
				password: PASSWORD,
				roles: [`shelter:${cudShelter}`, 'supply_coordinator'],
				display_name: 'E2E FoodSphere CUD Supply'
			};
			for (const user of [cudWarehouse, cudSupply]) {
				await createCouchUser(user);
				await seedSecurityQuestion(user.name);
				cudSessions[user.name] = await couchLogin(user.name, user.password);
			}
			expect(await getDocument(cudDb(), groupDocId(GROUP_ID)), 'no override yet').toBeNull();
		});

		test('C1: create — warehouse_staff adds a new group to the shelter', async ({ page }) => {
			// not asserting page health here: saving first looks the id up, a normal 404 on create
			await openCudAnalysis(page, cudWarehouse!);
			const sheet = await openSheet(page, 'กลุ่มสำหรับการคำนวณ');

			await sheet.getByRole('button', { name: 'เพิ่มกลุ่มความต้องการ' }).click();
			await sheet.getByRole('textbox', { name: /ชื่อกลุ่มความต้องการ/ }).fill(FRESH_NAME);
			await sheet.getByRole('textbox', { name: /รหัสกลุ่ม/ }).fill(FRESH_ID);
			await sheet.getByRole('button', { name: /หน่วยนับมาตรฐาน/ }).click();
			await page.getByRole('listbox').getByRole('option').first().click();
			await sheet.getByRole('button', { name: /^บันทึก/ }).click();

			await expect(toast(page, 'บันทึกกลุ่มความต้องการสำเร็จ')).toBeVisible();
			const row = groupRow(sheet, FRESH_ID);
			await expect(row).toContainText(FRESH_NAME);
			await expect(row).toContainText('เฉพาะศูนย์พักพิงนี้');

			const doc = await getDocument(cudDb(), groupDocId(FRESH_ID));
			expect(doc).toMatchObject({
				name: FRESH_NAME,
				source: 'SHELTER_OVERRIDE',
				shelter_code: cudShelter,
				created_by: cudWarehouse!.name
			});
			expect(await getDocument('catalog', groupDocId(FRESH_ID)), 'catalog untouched').toBeNull();
		});

		test('C2: update — editing a central group saves a shelter override, catalog stays', async ({
			page
		}) => {
			await openCudAnalysis(page, cudWarehouse!);
			await expect(groupHeader(page, GROUP_NAME)).toBeVisible();
			const sheet = await openSheet(page, 'กลุ่มสำหรับการคำนวณ');

			const central = groupRow(sheet, GROUP_ID);
			await expect(central).toContainText('ส่วนกลาง');
			// a warehouse member may edit a central row (it becomes an override) but never deactivate it
			await expect(central.getByRole('button', { name: 'ปิดใช้งาน' })).toHaveCount(0);
			await central.getByRole('button', { name: 'แก้ไข' }).click();
			await sheet.getByRole('textbox', { name: /ชื่อกลุ่มความต้องการ/ }).fill(RENAMED);
			await sheet.locator('#item-map-share-0').fill('40');
			await sheet.getByRole('button', { name: 'บันทึกการแก้ไข' }).click();

			await expect(toast(page, 'บันทึกกลุ่มความต้องการสำเร็จ')).toBeVisible();
			const row = groupRow(sheet, GROUP_ID);
			await expect(row).toContainText(RENAMED);
			await expect(row).toContainText('เฉพาะศูนย์พักพิงนี้');

			expect(await getDocument(cudDb(), groupDocId(GROUP_ID))).toMatchObject({
				name: RENAMED,
				source: 'SHELTER_OVERRIDE',
				shelter_code: cudShelter
			});
			expect(
				(await getDocument('catalog', groupDocId(GROUP_ID)))?.name,
				'the central group is not modified'
			).toBe(GROUP_NAME);

			// Clearing a previously saved value must remove it, not retain 40.
			await row.getByRole('button', { name: 'แก้ไข' }).click();
			await expect(sheet.locator('#item-map-share-0')).toHaveValue('40');
			await sheet.locator('#item-map-share-0').clear();
			await sheet.getByRole('button', { name: 'บันทึกการแก้ไข' }).click();
			await expect
				.poll(
					async () =>
						(
							(await getDocument(cudDb(), groupDocId(GROUP_ID)))?.item_maps as Array<
								Record<string, unknown>
							>
						)?.[0]?.share_percent
				)
				.toBeUndefined();
			await row.getByRole('button', { name: 'แก้ไข' }).click();
			await expect(sheet.locator('#item-map-share-0')).toHaveValue('');
			await sheet.getByRole('button', { name: /ยกเลิก/ }).click();

			// the analysis behind the sheet picked the change up without a reload
			await closeSheet(page);
			await expect(groupHeader(page, RENAMED)).toBeVisible();
			await expect(groupHeader(page, GROUP_NAME)).toHaveCount(0);
		});

		test('C3: update — a second edit changes the same override', async ({ page }) => {
			await openCudAnalysis(page, cudWarehouse!);
			const before = await getDocument(cudDb(), groupDocId(GROUP_ID));
			const sheet = await openSheet(page, 'กลุ่มสำหรับการคำนวณ');

			await groupRow(sheet, GROUP_ID).getByRole('button', { name: 'แก้ไข' }).click();
			await sheet.getByRole('textbox', { name: /ชื่อกลุ่มความต้องการ/ }).fill(RENAMED_AGAIN);
			await sheet.getByRole('button', { name: 'บันทึกการแก้ไข' }).click();
			await expect(toast(page, 'บันทึกกลุ่มความต้องการสำเร็จ')).toBeVisible();

			const after = await getDocument(cudDb(), groupDocId(GROUP_ID));
			expect(after?.name).toBe(RENAMED_AGAIN);
			expect(after?._rev, 'a new revision of the same document').not.toBe(before?._rev);
			expect(
				(await allDocuments(cudDb())).filter((d) => d._id === groupDocId(GROUP_ID)),
				'still one document'
			).toHaveLength(1);
			await closeSheet(page);
			await expect(groupHeader(page, RENAMED_AGAIN)).toBeVisible();
		});

		test('C4: delete — deactivating the override hides the group, reactivating brings it back', async ({
			page
		}) => {
			await openCudAnalysis(page, cudWarehouse!);
			await expect(groupHeader(page, RENAMED_AGAIN)).toBeVisible();
			const sheet = await openSheet(page, 'กลุ่มสำหรับการคำนวณ');

			await groupRow(sheet, GROUP_ID).getByRole('button', { name: 'ปิดใช้งาน' }).click();
			const confirm = page.getByRole('alertdialog');
			await expect(confirm).toContainText(RENAMED_AGAIN);
			await confirm.getByRole('button', { name: 'ยืนยันปิดใช้งาน' }).click();
			await expect(toast(page, 'ปิดใช้งานกลุ่มความต้องการสำเร็จ')).toBeVisible();

			const row = groupRow(sheet, GROUP_ID);
			await expect(row).toContainText('ปิดใช้งาน');
			await expect(row.getByRole('button', { name: 'เปิดใช้งาน' })).toBeVisible();
			expect((await getDocument(cudDb(), groupDocId(GROUP_ID)))?.status).toBe('inactive');
			// soft delete: the document and the central group both remain
			expect(await getDocument('catalog', groupDocId(GROUP_ID))).not.toBeNull();

			await closeSheet(page);
			await expect(groupHeader(page, RENAMED_AGAIN)).toHaveCount(0);

			const reopened = await openSheet(page, 'กลุ่มสำหรับการคำนวณ');
			await groupRow(reopened, GROUP_ID).getByRole('button', { name: 'เปิดใช้งาน' }).click();
			await expect(toast(page, 'เปิดใช้งานกลุ่มความต้องการสำเร็จ')).toBeVisible();
			await expect(
				groupRow(reopened, GROUP_ID).getByRole('button', { name: 'ปิดใช้งาน' })
			).toBeVisible();
			expect((await getDocument(cudDb(), groupDocId(GROUP_ID)))?.status).toBe('active');
			await closeSheet(page);
			await expect(groupHeader(page, RENAMED_AGAIN)).toBeVisible();
		});

		test('C5: delete — the group warehouse_staff created can be deactivated too', async ({
			page
		}) => {
			await openCudAnalysis(page, cudWarehouse!);
			const sheet = await openSheet(page, 'กลุ่มสำหรับการคำนวณ');

			await groupRow(sheet, FRESH_ID).getByRole('button', { name: 'ปิดใช้งาน' }).click();
			await page.getByRole('alertdialog').getByRole('button', { name: 'ยืนยันปิดใช้งาน' }).click();
			await expect(toast(page, 'ปิดใช้งานกลุ่มความต้องการสำเร็จ')).toBeVisible();
			expect((await getDocument(cudDb(), groupDocId(FRESH_ID)))?.status).toBe('inactive');
		});

		test('C6: update — a replenishment policy is edited into a shelter override', async ({
			page
		}) => {
			await openCudAnalysis(page, cudWarehouse!);
			const sheet = await openSheet(page, 'นโยบายการเติมสต็อก');

			const first = sheet.getByRole('row').filter({ hasText: 'ส่วนกลาง' }).first();
			await first.getByRole('button', { name: 'แก้ไข' }).click();
			const safety = sheet.getByLabel(/วันสำรอง/);
			const current = Number(await safety.inputValue());
			await safety.fill(String(current + 1));
			await sheet.getByRole('button', { name: /^บันทึก/ }).click();
			await expect(toast(page, 'บันทึกนโยบายการเติมสต็อกสำเร็จ')).toBeVisible();

			const policies = (await allDocuments(cudDb())).filter(
				(d) => d.type === 'replenishment_policy'
			);
			expect(policies, 'exactly the one policy this test saved').toHaveLength(1);
			expect(policies[0]).toMatchObject({
				source: 'SHELTER_OVERRIDE',
				shelter_code: cudShelter,
				safety_days: current + 1
			});
		});

		test('C7: supply_coordinator is refused by CouchDB for every write (CR-235)', async () => {
			const cookie = `AuthSession=${cudSessions[cudSupply!.name]}`;
			const send = (method: string, id: string, body?: Record<string, unknown>, query = '') =>
				fetch(`${COUCH_BASE}/${cudDb()}/${encodeURIComponent(id)}${query}`, {
					method,
					headers: { 'Content-Type': 'application/json', Cookie: cookie },
					body: body ? JSON.stringify(body) : undefined
				});

			const existing = (await getDocument(cudDb(), groupDocId(GROUP_ID)))!;
			const create = await send('PUT', groupDocId('E2E_SC_REFUSED'), {
				type: 'requirement_group',
				name: 'E2E refused',
				standard_uom: 'gram',
				source: 'SHELTER_OVERRIDE',
				shelter_code: cudShelter
			});
			expect(create.status, 'create').toBe(403);
			const update = await send('PUT', groupDocId(GROUP_ID), { ...existing, name: 'E2E refused' });
			expect(update.status, 'update').toBe(403);
			const remove = await send('DELETE', groupDocId(GROUP_ID), undefined, `?rev=${existing._rev}`);
			expect(remove.status, 'delete').toBe(403);

			const after = await getDocument(cudDb(), groupDocId(GROUP_ID));
			expect(after?.name, 'nothing changed').toBe(RENAMED_AGAIN);
			expect(await getDocument(cudDb(), groupDocId('E2E_SC_REFUSED'))).toBeNull();
		});

		test('Z: teardown leaves no E2E shelter database or account behind', async () => {
			test.setTimeout(240_000);
			const code = cudShelter;
			test.skip(!code, 'the shelter was never created');
			await teardownShelter(code!);
			for (const user of [cudWarehouse, cudSupply]) if (user) await deleteCouchUser(user.name);
			cudShelter = undefined;

			expect((await couchReq('GET', `/shelter_${code!.toLowerCase()}`)).status).toBe(404);
			for (const user of [cudWarehouse, cudSupply]) {
				const res = await couchReq(
					'GET',
					`/_users/org.couchdb.user:${encodeURIComponent(user!.name)}`
				);
				expect(res.status, `${user!.name} removed`).toBe(404);
			}
		});
	}
);
