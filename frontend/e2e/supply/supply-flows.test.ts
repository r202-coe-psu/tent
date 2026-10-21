/**
 * Supply module (คลังพัสดุ, /back-office/supply) — two journeys from the supply user guide:
 *
 * - Flow 1: view stock → receive (other + walk-in donation) → distribute → adjust → cycle
 *   count → movements ledger (filters + CSV) → inter-shelter transfer (request,
 *   hold/resume/cancel, dispatch, receive at the destination).
 * - Flow 2: merge a duplicate shelter item → resource needs (recalculate + CSV) →
 *   food-sphere analysis → per-item replenishment policy, read back in the analysis.
 *
 * Real stack, nothing mocked. Each journey runs in its own `E2E Supply …` shelters (README
 * §4.3), created through system management as the CouchDB admin and dropped with their
 * databases — stock, shelter-scoped items, walk-in donations, daily calcs and policies all
 * live there. The only central writes are the staff users and the `stock_transfer` docs in
 * `central_ops`; both are recorded by id, deleted, and checked for leaks (§4.2, §4.6).
 * The seeded central item "น้ำดื่ม 600 มล." (`pnpm seed:master`) is read, never written: a
 * transfer must reference the central catalog, and it is the one item mapped to a food-sphere
 * requirement group.
 *
 * Flow 2 seeds ten active evacuees into its own shelter with the admin API: occupancy is a
 * prerequisite of the analysis tabs, not their subject (same rule as README §8.4).
 *
 * Run (preview build, local CouchDB with `pnpm seed:master` + `pnpm db:sync`):
 * `pnpm test:e2e:supply`
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { test as base, expect, type Locator, type Page } from '@playwright/test';
import { ulid } from '../../src/lib/db/ulid';
import {
	bootstrapAdminSession,
	couchLogin,
	couchReq,
	createCouchUser,
	deleteCouchUser,
	getDocument,
	putDocument,
	routeBrowserCouchThroughApp,
	seedSecurityQuestion,
	type CouchDocument,
	type TestUser
} from '../helpers/couch';
import { clearSession, injectSession } from '../helpers/login';
import {
	E2E_SHELTER_PREFIX,
	forgetCreatedShelter,
	recordCreatedShelter
} from '../helpers/public-cleanup';
import { createShelterViaUi, selectActiveShelter } from '../helpers/staff-ui';
import { assertRunLeftNothing, warmShelterIndexes } from '../distribution/distribution';

const SUPPLY_SHELTER_PREFIX = `${E2E_SHELTER_PREFIX} Supply`;
const CENTRAL_DBS = ['registry', 'catalog'] as const;
const WATER = 'น้ำดื่ม 600 มล.';
const PASSWORD = 'Password1!';

type CouchSecurity = {
	admins?: { names?: string[]; roles?: string[] };
	members?: { names?: string[]; roles?: string[] };
};

/**
 * Remove one of this run's shelters: close it, delete its registry master and database, and
 * take `shelter:{code}` back out of the central DBs' `_security`. Refuses any shelter that is
 * not an `E2E Supply …` one.
 */
async function teardownSupplyShelter(code: string): Promise<void> {
	const byCode = await couchReq(
		'GET',
		`/registry/_design/app/_view/by_code?key=${encodeURIComponent(JSON.stringify(code))}&include_docs=true`
	);
	const master = (byCode.data as { rows?: { doc?: CouchDocument }[] } | null)?.rows?.[0]?.doc;
	if (master) {
		if (!String(master.name ?? '').startsWith(SUPPLY_SHELTER_PREFIX)) {
			throw new Error(`Refusing to tear down non-E2E shelter ${code} ("${String(master.name)}")`);
		}
		// Closed first, so a running sync worker projects the shelter out of the public plane.
		const path = `/registry/${encodeURIComponent(master._id)}`;
		const closed = await couchReq('PUT', path, {
			...master,
			operation_status: 'closed',
			updated_at: new Date().toISOString()
		});
		if (closed.status >= 400) throw new Error(`close ${code} failed (HTTP ${closed.status})`);
		const rev = (closed.data as { rev: string }).rev;
		const removed = await couchReq('DELETE', `${path}?rev=${encodeURIComponent(rev)}`);
		if (removed.status >= 400 && removed.status !== 404) {
			throw new Error(`delete registry master of ${code} failed (HTTP ${removed.status})`);
		}
	}
	const dropped = await couchReq('DELETE', `/shelter_${code.toLowerCase()}`);
	if (dropped.status >= 400 && dropped.status !== 404) {
		throw new Error(`delete database of ${code} failed (HTTP ${dropped.status})`);
	}
	for (const db of CENTRAL_DBS) {
		const security = ((await couchReq('GET', `/${db}/_security`)).data ?? {}) as CouchSecurity;
		const roles = security.members?.roles ?? [];
		if (!roles.includes(`shelter:${code}`)) continue;
		const res = await couchReq('PUT', `/${db}/_security`, {
			...security,
			members: { ...security.members, roles: roles.filter((r) => r !== `shelter:${code}`) }
		});
		if (res.status >= 400) throw new Error(`${db}/_security cleanup failed (HTTP ${res.status})`);
	}
	forgetCreatedShelter(code);
}

interface Staff {
	user: TestUser;
	session: string;
}

interface SupplyRun {
	/** A fresh `E2E Supply <label> …` shelter, torn down after the test. Returns its code. */
	createShelter: (label: string) => Promise<string>;
	/** A warehouse user scoped to `code`, deleted after the test. */
	warehouseStaff: (code: string) => Promise<Staff>;
	/** A system admin (all shelters), deleted after the test. */
	systemAdmin: () => Promise<Staff>;
	/** Sign the page in as `staff` (clears the previous session and shelter pick first). */
	signIn: (staff: Staff) => Promise<void>;
}

const test = base.extend<{ run: SupplyRun }>({
	run: async ({ browser, page }, use, testInfo) => {
		const shelters: string[] = [];
		const users: string[] = [];
		// `stock_transfer` lives in `central_ops`; the UI never shows its id, so take it from
		// the create response.
		const transferIds = new Set<string>();
		const pendingIds: Promise<void>[] = [];
		page.on('response', (res) => {
			if (res.request().method() !== 'POST' || res.status() !== 201) return;
			if (new URL(res.url()).pathname !== '/api/back-office/transfer') return;
			pendingIds.push(
				res
					.json()
					.then((body: { _id?: string }) => {
						if (body._id) transferIds.add(body._id);
					})
					.catch(() => undefined)
			);
		});
		// README §5 hygiene: failed calls, page errors and console errors; attached on failure.
		const failedCalls: string[] = [];
		page.on('response', (res) => {
			if (res.status() >= 400) {
				failedCalls.push(`${res.status()} ${res.request().method()} ${res.url()}`);
			}
		});
		page.on('pageerror', (error) => failedCalls.push(`pageerror ${error.stack ?? error.message}`));
		page.on('console', (msg) => {
			if (msg.type() === 'error') failedCalls.push(`console.error ${msg.text()}`);
		});
		await routeBrowserCouchThroughApp(page);

		const createStaff = async (prefix: string, roles: string[]): Promise<Staff> => {
			const user: TestUser = {
				name: `${prefix}_${ulid().toLowerCase()}`,
				password: PASSWORD,
				roles,
				display_name: `E2E Supply ${prefix}`
			};
			users.push(user.name);
			await createCouchUser(user);
			await seedSecurityQuestion(user.name);
			return { user, session: await couchLogin(user.name, user.password) };
		};

		await use({
			createShelter: async (label) => {
				const admin = await bootstrapAdminSession();
				const context = await browser.newContext();
				try {
					const adminPage = await context.newPage();
					await routeBrowserCouchThroughApp(adminPage);
					await injectSession(adminPage, admin.user, admin.cookie);
					const code = await createShelterViaUi(adminPage, {
						name: `${SUPPLY_SHELTER_PREFIX} ${label} ${ulid().toLowerCase()}`,
						siteKind: 'evacuation_center',
						lat: 7.006,
						lng: 100.498,
						subdistrict: 'คอหงส์',
						capacity: 50
					});
					recordCreatedShelter(code);
					shelters.push(code);
					await warmShelterIndexes(code);
					return code;
				} finally {
					await context.close();
				}
			},
			warehouseStaff: (code) =>
				createStaff(`e2e_supply_wh_${code.toLowerCase()}`, [`shelter:${code}`, 'warehouse_staff']),
			systemAdmin: () => createStaff('e2e_supply_sa', ['system_admin']),
			signIn: async (staff) => {
				// Before the first navigation the page is about:blank, where localStorage throws.
				if (page.url() !== 'about:blank') await clearSession(page);
				await injectSession(page, staff.user, staff.session);
				// Each staff member works on their own device: drop the previous user's shelter pick.
				await page.evaluate(() => localStorage.removeItem('tent.activeShelterCode'));
			}
		});

		if (testInfo.status !== testInfo.expectedStatus) {
			const path = testInfo.outputPath('failed-calls.txt');
			writeFileSync(path, [`final url: ${page.url()}`, ...failedCalls].join('\n'));
			await testInfo.attach('failed-calls', { path, contentType: 'text/plain' });
		}
		await clearSession(page).catch(() => undefined);
		await page.unrouteAll({ behavior: 'ignoreErrors' });
		await Promise.all(pendingIds);

		const errors: unknown[] = [];
		const attempt = async (fn: () => Promise<void>) => {
			try {
				await fn();
			} catch (error) {
				errors.push(error);
			}
		};
		for (const id of transferIds) {
			await attempt(async () => {
				const doc = await getDocument('central_ops', id);
				if (!doc?._rev) return;
				const res = await couchReq(
					'DELETE',
					`/central_ops/${encodeURIComponent(id)}?rev=${encodeURIComponent(doc._rev)}`
				);
				if (res.status >= 400 && res.status !== 404) {
					throw new Error(`Could not remove E2E transfer ${id} (HTTP ${res.status})`);
				}
			});
		}
		for (const name of users) await attempt(() => deleteCouchUser(name));
		for (const code of shelters) {
			await attempt(() => teardownSupplyShelter(code));
		}

		// Zero-leak check (README §4.6).
		for (const code of shelters) await attempt(() => assertRunLeftNothing(code));
		await attempt(async () => {
			const leaks: string[] = [];
			for (const id of transferIds) {
				if (await getDocument('central_ops', id)) leaks.push(`central_ops ${id}`);
			}
			for (const name of users) {
				const res = await couchReq('GET', `/_users/org.couchdb.user:${encodeURIComponent(name)}`);
				if (res.status !== 404) leaks.push(`user ${name}`);
			}
			if (leaks.length > 0) throw new Error(`E2E supply run leaked: ${leaks.join(', ')}`);
		});
		if (errors.length > 0) throw new AggregateError(errors, 'E2E supply teardown failed');
	}
});

// ─── Page helpers ──────────────────────────────────────────────────────────────

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A sonner toast carrying `text`. */
function toast(page: Page, text: string | RegExp): Locator {
	return page.locator('[data-sonner-toast]').filter({ hasText: text });
}

/** The desktop stock-table row of one item. */
function stockRow(page: Page, name: string): Locator {
	return page.getByRole('row').filter({ has: page.getByRole('button', { name, exact: true }) });
}

/**
 * Type into an item combobox. It opens on key input, not on `fill()`, and keys sent while
 * it re-renders on open can be dropped — so check the value and type again if needed.
 */
async function typeInCombobox(input: Locator, text: string): Promise<void> {
	await expect(async () => {
		await input.click();
		await input.clear();
		await input.pressSequentially(text);
		await expect(input).toHaveValue(text, { timeout: 1_000 });
	}).toPass({ timeout: 15_000 });
}

/** Type into an item combobox and pick the item whose name starts the option. */
async function pickItem(page: Page, input: Locator, name: string): Promise<void> {
	await typeInCombobox(input, name);
	await page
		.getByRole('option', { name: new RegExp(`^${escapeRegExp(name)}`) })
		.first()
		.click();
}

/** Pick the unit in a movement form (items like water default to their pack unit). */
async function chooseUnit(page: Page, scope: Locator, unit: string): Promise<void> {
	await scope.getByRole('button', { name: /^หน่วย/ }).click();
	await page.getByRole('option', { name: unit, exact: true }).click();
}

/** Open one of the header movement sheets (รับเข้า / เบิกจ่าย / ปรับยอด / ตรวจนับ). */
async function openMovement(
	page: Page,
	button: 'รับเข้า' | 'เบิกจ่าย' | 'ปรับยอด' | 'ตรวจนับ',
	title: string
): Promise<Locator> {
	await page.getByRole('button', { name: button, exact: true }).click();
	const sheet = page.getByRole('dialog', { name: title });
	await expect(sheet).toBeVisible();
	return sheet;
}

async function closeSheet(page: Page, sheet: Locator): Promise<void> {
	await page.keyboard.press('Escape');
	await expect(sheet).toBeHidden();
}

/** On-hand quantity printed in the stock row. */
async function expectOnHand(page: Page, name: string, qty: number): Promise<void> {
	await expect(stockRow(page, name).getByRole('cell').nth(1)).toContainText(
		new RegExp(`^\\s*${qty}\\b`)
	);
}

/** Receive `qty` of a brand-new shelter item, created from the receive form's item picker. */
async function receiveNewItem(
	page: Page,
	sheet: Locator,
	item: { name: string; category: RegExp; unit: string; qty: string }
): Promise<void> {
	await typeInCombobox(sheet.getByPlaceholder('ค้นหา…'), item.name);
	await page.getByRole('option', { name: `สร้างสินค้าใหม่ “${item.name}”` }).click();
	const create = page.getByRole('dialog', { name: 'สร้างสินค้าใหม่' });
	await expect(create.locator('#qc-name')).toHaveValue(item.name);
	await create.getByRole('button', { name: item.category }).click();
	await create.getByRole('button', { name: item.unit, exact: true }).click();
	await create.getByRole('button', { name: 'สร้างแล้วใช้ในรายการนี้' }).click();
	await expect(create).toBeHidden();
	await sheet.getByRole('spinbutton', { name: /จำนวน/ }).fill(item.qty);
	await sheet.getByRole('button', { name: '+7ว' }).click();
	await sheet.getByRole('button', { name: 'บันทึกแล้วรับชิ้นถัดไป' }).click();
	await expect(toast(page, 'รับเข้าแล้ว').last()).toBeVisible();
}

/** `count` active evacuees in `code` — the occupancy the analysis tabs compute from. */
async function seedOccupancy(code: string, count: number): Promise<void> {
	const db = `shelter_${code.toLowerCase()}`;
	const now = new Date().toISOString();
	for (let i = 0; i < count; i++) {
		await putDocument(db, {
			_id: `evacuee:${ulid()}`,
			type: 'evacuee',
			schema_v: 10,
			shelter_code: code,
			created_at: now,
			updated_at: now,
			created_by: 'e2e_supply_seed',
			first_name: `E2E ผู้พัก${i + 1}`,
			last_name: 'คลังพัสดุ',
			gender: 'other',
			phone: null,
			person_id: { cardType: 'anonymous', number: `ANON-${ulid()}` },
			country: 'THAILAND',
			religion: 'buddhist',
			vulnerable_groups: [],
			special_needs: [],
			household_id: null,
			current_stay: { status: 'active', zone: 'A', since: now },
			privacy: { search_excluded: false },
			registered_via: 'staff'
		});
	}
}

// ─── Journeys ──────────────────────────────────────────────────────────────────

test.describe('Supply module journeys', { tag: ['@critical', '@supply'] }, () => {
	// Every test builds its own shelters, so the tests are independent of each other.
	test.use({ actionTimeout: 15_000 });

	test('flow 1 — stock, receive, distribute, adjust, count, ledger, transfer', async ({
		page,
		run
	}) => {
		test.setTimeout(300_000);
		const source = await run.createShelter('source');
		const destination = await run.createShelter('destination');
		const sourceStaff = await run.warehouseStaff(source);
		const destinationStaff = await run.warehouseStaff(destination);
		const admin = await run.systemAdmin();
		const marker = ulid().toLowerCase();
		const donor = `E2E ผู้บริจาค ${marker}`;
		const point = `E2E จุดแจก ${marker}`;

		await run.signIn(sourceStaff);

		await test.step('ดูสต็อก — a new shelter has received nothing yet', async () => {
			await page.goto('/back-office/supply');
			await expect(page.getByRole('heading', { name: 'คลังของศูนย์' })).toBeVisible();
			await expect(page.getByText('ศูนย์นี้ยังไม่เคยรับสินค้าเข้าคลัง')).toBeVisible();
			const cards = page.getByRole('region', { name: 'สรุปสิ่งที่ต้องจัดการ' });
			for (const label of ['หมดอายุ', 'หมด', 'ใกล้หมด', 'ใกล้หมดอายุ']) {
				await expect(cards.getByRole('button', { name: new RegExp(`^${label} 0 `) })).toBeVisible();
			}
		});

		await test.step('รับเข้า — receive "other" and a walk-in donation', async () => {
			const sheet = await openMovement(page, 'รับเข้า', 'รับเข้า');
			await expect(sheet.getByRole('radio', { name: /รับเข้าอื่นๆ/ })).toHaveAttribute(
				'aria-checked',
				'true'
			);
			await pickItem(page, sheet.getByPlaceholder('ค้นหา…'), WATER);
			await chooseUnit(page, sheet, 'ขวด');
			await sheet.getByRole('spinbutton', { name: /จำนวน/ }).fill('120');
			await sheet.getByRole('button', { name: '+1ปี' }).click();
			await sheet.getByRole('button', { name: 'บันทึกแล้วรับชิ้นถัดไป' }).click();
			await expect(toast(page, 'รับเข้าแล้ว')).toBeVisible();

			await sheet.getByRole('radio', { name: /บริจาคหน้างาน/ }).click();
			await sheet.locator('#walkin-donor-name').fill(donor);
			await sheet.locator('#walkin-donor-phone').fill('0800000000');
			await pickItem(page, sheet.getByPlaceholder('ค้นหา…'), WATER);
			await chooseUnit(page, sheet, 'ขวด');
			await sheet.getByRole('spinbutton', { name: /จำนวน/ }).fill('30');
			await sheet.getByRole('button', { name: '+6ด' }).click();
			await sheet.getByRole('button', { name: 'บันทึกแล้วรับชิ้นถัดไป' }).click();
			await expect(toast(page, 'รับเข้าแล้ว').nth(1)).toBeVisible();
			await closeSheet(page, sheet);

			await expectOnHand(page, WATER, 150);
			await expect(stockRow(page, WATER)).toContainText('2 ล็อต');
		});

		await test.step('ดูสต็อก — item detail: lots (FEFO), history', async () => {
			await stockRow(page, WATER).getByRole('button', { name: WATER, exact: true }).click();
			const detail = page.getByRole('dialog', { name: WATER });
			await expect(detail).toBeVisible();
			await expect(detail.getByText('คงเหลือ').locator('..')).toContainText('150');
			const lots = detail.getByRole('tabpanel').getByRole('listitem');
			await expect(lots).toHaveCount(2);
			// The walk-in lot expires first, so it is the one issued next.
			await expect(lots.first()).toContainText('30');
			await expect(lots.first()).toContainText('เบิกถัดไป');
			await detail.getByRole('tab', { name: 'ประวัติ' }).click();
			await expect(detail.getByRole('row').filter({ hasText: '+120' })).toBeVisible();
			await expect(detail.getByRole('row').filter({ hasText: '+30' })).toBeVisible();
			await closeSheet(page, detail);
		});

		await test.step('เบิกจ่าย — distribute 10 from the auto lot plan', async () => {
			const sheet = await openMovement(page, 'เบิกจ่าย', 'เบิกจ่าย');
			await pickItem(page, sheet.getByPlaceholder('ค้นหา…'), WATER);
			await expect(sheet.getByText('แผนการตัดล็อต')).toBeVisible();
			await sheet.getByRole('button', { name: '10', exact: true }).click();
			await sheet.getByRole('button', { name: 'อื่นๆ...' }).click();
			await sheet.getByPlaceholder('ปลายทาง / ผู้รับ').fill(point);
			await sheet.getByRole('button', { name: 'เบิก 10 ขวด' }).click();
			await expect(toast(page, 'เบิกแล้ว')).toBeVisible();
			if (await sheet.isVisible()) await closeSheet(page, sheet);
			await expectOnHand(page, WATER, 140);
		});

		await test.step('ปรับยอด — write off 2 damaged from the 120-bottle lot', async () => {
			const sheet = await openMovement(page, 'ปรับยอด', 'ปรับยอดทีละรายการ');
			await pickItem(page, sheet.locator('#item-search'), WATER);
			await sheet.locator('#lot-select').click();
			// The lot FEFO did not touch (see the GAP test below for the walk-in lot).
			await page.getByRole('option', { name: /คงเหลือ 120 ขวด$/ }).click();
			await expect(sheet.getByText('ยอดในระบบ').locator('..')).toContainText('120');
			await sheet.locator('#new-qty').fill('118');
			await sheet.getByRole('button', { name: /เสียหาย/ }).click();
			await sheet.locator('#adjust-note').fill(`E2E ${marker} กล่องเปียกน้ำ`);
			await sheet.getByRole('button', { name: /^ตัดออก 2/ }).click();
			await expect(toast(page, 'ปรับยอดแล้ว')).toBeVisible();
			await closeSheet(page, sheet);
			await expectOnHand(page, WATER, 138);
		});

		await test.step('ตรวจนับ — one lot counted short, the rest as the system says', async () => {
			const sheet = await openMovement(page, 'ตรวจนับ', 'ตรวจนับตามจุดเก็บ');
			await sheet.getByRole('button', { name: /^คลังหลัก/ }).click();
			const lots = sheet.locator('form li');
			await expect(lots).toHaveCount(2);
			await lots.filter({ hasText: 'ในระบบ 118' }).locator('input').fill('117');
			await sheet.getByRole('button', { name: 'ที่เหลือตรงตามระบบ' }).click();
			await expect(sheet.getByText('ไม่ตรง 1')).toBeVisible();
			await sheet.locator('#cycle-count-note').fill(`E2E ${marker} ตรวจนับประจำวัน`);
			await sheet.getByRole('button', { name: /บันทึกผลตรวจนับ \(1 รายการที่ไม่ตรง\)/ }).click();
			await expect(toast(page, /บันทึกผลตรวจนับ .* แล้ว \(1 รายการไม่ตรง\)/)).toBeVisible();
			await closeSheet(page, sheet);
			await expectOnHand(page, WATER, 137);
		});

		await test.step('ความเคลื่อนไหว — every movement, filters and CSV export', async () => {
			await page
				.getByRole('navigation', { name: 'แท็บคลัง' })
				.getByRole('button', {
					name: 'ความเคลื่อนไหว'
				})
				.click();
			await expect(page).toHaveURL(/tab=movements/);
			const rows = page.getByRole('row').filter({ hasText: WATER });
			await expect(rows).toHaveCount(5);
			// "รับเข้าอื่นๆ" is booked as an adjust/found (CR-143 §C, CR-156 FR-C7).
			await expect(rows.filter({ hasText: /\+120 ขวด.*พบของเพิ่ม/ })).toBeVisible();
			await expect(rows.filter({ hasText: /รับบริจาค.*\+30 ขวด.*donation:/ })).toBeVisible();
			await expect(rows.filter({ hasText: new RegExp(`-10 ขวด.*${point}`) })).toBeVisible();
			await expect(rows.filter({ hasText: /-2 ขวด.*เสียหาย/ })).toBeVisible();
			await expect(rows.filter({ hasText: /-1 ขวด.*นับไม่ตรง/ })).toBeVisible();
			await expect(rows.first()).toContainText(sourceStaff.user.name);

			const types = page.getByRole('group', { name: 'ประเภทรายการ' });
			await types.getByRole('button', { name: /^ปรับยอด/ }).click();
			await expect(rows).toHaveCount(3);
			await types.getByRole('button', { name: /^ทั้งหมด/ }).click();
			await expect(rows).toHaveCount(5);

			await page.getByLabel('ค้นหาสินค้า ผู้รับ หรือเลขอ้างอิง').fill(point);
			await expect(rows).toHaveCount(1);
			await page.getByLabel('ค้นหาสินค้า ผู้รับ หรือเลขอ้างอิง').fill('');

			const download = page.waitForEvent('download');
			await page.getByRole('button', { name: /ส่งออก CSV/ }).click();
			const csv = readFileSync(await (await download).path(), 'utf8');
			expect(csv).toContain(WATER);
			expect(csv).toContain(point);
		});

		await test.step('โอนย้าย — request, hold, resume, cancel, dispatch, receive', async () => {
			// Only a system admin gets destination shelters today (GAP test below), so the admin
			// raises the requests with the source shelter selected; the source's warehouse
			// staff work them and the destination's warehouse staff receive.
			await run.signIn(admin);
			await selectActiveShelter(page, source);
			await page.goto('/back-office/supply?tab=transfer');
			await expect(page.getByRole('heading', { name: 'สร้างคำขอโอนออก' })).toBeVisible();

			const route = `${source} → ${destination}`;
			const outgoing = page.locator('section').filter({
				has: page.getByRole('heading', { name: 'ต้องส่งออก' })
			});
			const outgoingRoutes = outgoing.getByRole('listitem').filter({ hasText: route });
			const createRequest = async (qty: string, note: string, expectedCount: number) => {
				await page.getByRole('button', { name: /^ศูนย์ปลายทาง/ }).click();
				await page.getByRole('option', { name: new RegExp(` ${destination}$`) }).click();
				await pickItem(page, page.getByPlaceholder('ค้นหา…'), WATER);
				await chooseUnit(page, page.locator('form').filter({ hasText: 'สร้างคำขอโอนออก' }), 'ขวด');
				await page.getByPlaceholder('ระบุจำนวน').fill(qty);
				await page.getByPlaceholder('รายละเอียดเพิ่มเติม').fill(note);
				await page.getByRole('button', { name: 'ส่งคำขอโอน' }).click();
				await expect(toast(page, 'สร้างคำร้องโอนย้ายสำเร็จ!').last()).toBeVisible();
				await expect(outgoingRoutes).toHaveCount(expectedCount);
			};
			await createRequest('20', `E2E ${marker} ส่งน้ำช่วยศูนย์ปลายทาง`, 1);
			await createRequest('5', `E2E ${marker} คำขอที่จะยกเลิก`, 2);

			await run.signIn(sourceStaff);
			await page.goto('/back-office/supply?tab=transfer');
			await expect(
				page.getByRole('navigation', { name: 'แท็บคลัง' }).getByRole('button', { name: /โอนย้าย/ })
			).toContainText('2');

			await expect(outgoingRoutes).toHaveCount(2);
			const small = outgoingRoutes.filter({ hasText: / 5 / });
			const large = outgoingRoutes.filter({ hasText: / 20 / });

			// Hold the 5-bottle request, resume it, then cancel it.
			await small.getByRole('button', { name: 'ระงับ' }).click();
			const hold = page.getByRole('dialog');
			await hold.locator('#transfer-reason').fill('E2E รอยืนยันจำนวนจากปลายทาง');
			await hold.getByRole('button', { name: /ยืนยัน/ }).click();
			await expect(toast(page, 'ระงับคำร้องแล้ว')).toBeVisible();
			await small.getByRole('button', { name: 'กลับมาดำเนินการต่อ' }).click();
			await expect(toast(page, 'กลับมาดำเนินการต่อแล้ว')).toBeVisible();

			// "ประวัติการโอน" is the only table on the tab.
			const historyRow = (qty: string) =>
				page
					.getByRole('row')
					.filter({ hasText: route })
					.filter({ hasText: `— ${qty} bottle` });
			await historyRow('5').getByRole('button', { name: 'ยกเลิก' }).click();
			const cancel = page.getByRole('dialog');
			await cancel.locator('#transfer-reason').fill('E2E ปลายทางแจ้งว่าไม่ต้องการแล้ว');
			await cancel.getByRole('button', { name: /ยืนยัน/ }).click();
			await expect(toast(page, 'ยกเลิกคำร้องสำเร็จ')).toBeVisible();
			await expect(historyRow('5')).toContainText('ยกเลิก');
			await expect(historyRow('5').getByRole('button')).toHaveCount(0);
			await expect(outgoingRoutes).toHaveCount(1);

			// Dispatch the 20-bottle request: stock leaves the source at once.
			await large.getByRole('button', { name: 'ยืนยันส่ง' }).click();
			const dispatch = page.getByRole('dialog', { name: 'ยืนยันการส่งมอบ' });
			await dispatch.locator('#dispatch-driver-name').fill('E2E สมศักดิ์ ขับดี');
			await dispatch.locator('#dispatch-vehicle-plate').fill('1กข 2345 สงขลา');
			await dispatch.getByRole('button', { name: 'ยืนยันส่งมอบ' }).click();
			await expect(toast(page, 'อนุมัติส่งมอบสำเร็จ')).toBeVisible();
			await expect(dispatch).toBeHidden();

			await page
				.getByRole('navigation', { name: 'แท็บคลัง' })
				.getByRole('button', {
					name: 'สต็อก'
				})
				.click();
			await expectOnHand(page, WATER, 117);
			await page.goto('/back-office/supply?tab=movements');
			await page
				.getByRole('group', { name: 'ประเภทรายการ' })
				.getByRole('button', { name: /^โอน/ })
				.click();
			await expect(page.getByRole('row').filter({ hasText: WATER })).toHaveCount(1);
			await expect(page.getByRole('row').filter({ hasText: WATER })).toContainText('-20 ขวด');

			// The destination receives it.
			await run.signIn(destinationStaff);
			await page.goto('/back-office/supply?tab=transfer');
			const incoming = page.locator('section').filter({
				has: page.getByRole('heading', { name: 'ต้องรับเข้า' })
			});
			await incoming
				.getByRole('listitem')
				.filter({ hasText: route })
				.getByRole('button', { name: 'ตรวจรับ' })
				.click();
			await expect(toast(page, 'ยืนยันรับเข้าสำเร็จ')).toBeVisible();
			await expect(incoming.getByText('ไม่มีรายการรอตรวจรับ')).toBeVisible();
			await page.goto('/back-office/supply');
			await expectOnHand(page, WATER, 20);
			await page.goto('/back-office/supply?tab=movements');
			await expect(page.getByRole('row').filter({ hasText: WATER })).toHaveCount(1);
			await expect(page.getByRole('row').filter({ hasText: WATER })).toContainText('+20 ขวด');
		});
	});

	test('flow 2 — merge, resource needs, food sphere, replenishment policy', async ({
		page,
		run
	}) => {
		test.setTimeout(240_000);
		const code = await run.createShelter('analysis');
		const staff = await run.warehouseStaff(code);
		await seedOccupancy(code, 10);
		const marker = ulid().toLowerCase();
		const kit = `E2E ถุงยังชีพ ${marker}`;
		const duplicate = `E2E ถุงยังชีพ ซ้ำ ${marker}`;
		const secondary = page.getByRole('navigation', { name: 'เครื่องมือเพิ่มเติม' });

		await run.signIn(staff);
		await page.goto('/back-office/supply');

		await test.step('setup — receive water and two shelter items (one a duplicate)', async () => {
			const sheet = await openMovement(page, 'รับเข้า', 'รับเข้า');
			await pickItem(page, sheet.getByPlaceholder('ค้นหา…'), WATER);
			await chooseUnit(page, sheet, 'ขวด');
			await sheet.getByRole('spinbutton', { name: /จำนวน/ }).fill('600');
			await sheet.getByRole('button', { name: '+1ปี' }).click();
			await sheet.getByRole('button', { name: 'บันทึกแล้วรับชิ้นถัดไป' }).click();
			await expect(toast(page, 'รับเข้าแล้ว')).toBeVisible();
			const kits = /^ชุดพัสดุยังชีพรวม/;
			await receiveNewItem(page, sheet, { name: kit, category: kits, unit: 'ถุง', qty: '12' });
			await receiveNewItem(page, sheet, { name: duplicate, category: kits, unit: 'ถุง', qty: '8' });
			await closeSheet(page, sheet);
			await expectOnHand(page, kit, 12);
			await expectOnHand(page, duplicate, 8);
		});

		await test.step('รวมสินค้า — merge the duplicate into the item it repeats', async () => {
			await secondary.getByRole('link', { name: 'สินค้า (Master)' }).click();
			await expect(page).toHaveURL(/tab=catalog/);
			await page.getByLabel('ค้นหาชื่อหรือ SKU').fill(duplicate);
			await page.getByRole('button', { name: duplicate, exact: true }).click();
			const detail = page.getByRole('dialog', { name: new RegExp(escapeRegExp(duplicate)) });
			await detail.getByRole('button', { name: 'รวมกับรายการอื่น' }).click();

			const merge = page.getByRole('dialog', { name: 'รวมกับรายการอื่น' });
			await pickItem(page, merge.locator('#merge-target'), kit);
			await expect(merge).toContainText('ยอดที่จะย้าย 8 ถุง จาก 1 ล็อต');
			await merge.getByRole('button', { name: 'ยืนยันรวมสินค้า' }).click();
			await expect(toast(page, `รวม “${duplicate}” เข้ากับ “${kit}” แล้ว`)).toBeVisible();
			await expect(merge).toBeHidden();

			// The duplicate is now deactivated: gone from the active catalog and from stock.
			await page.getByLabel('ค้นหาชื่อหรือ SKU').fill(duplicate);
			await expect(page.getByRole('button', { name: duplicate, exact: true })).toHaveCount(0);
			await page
				.getByRole('navigation', { name: 'แท็บคลัง' })
				.getByRole('button', {
					name: 'สต็อก'
				})
				.click();
			await expectOnHand(page, kit, 20);
			await expect(stockRow(page, duplicate)).toHaveCount(0);

			await page
				.getByRole('navigation', { name: 'แท็บคลัง' })
				.getByRole('button', {
					name: 'ความเคลื่อนไหว'
				})
				.click();
			const merged = page.getByRole('row').filter({ hasText: 'รวมสินค้า' });
			await expect(merged.filter({ hasText: kit }).filter({ hasText: '+8' })).toHaveCount(1);
			await expect(merged.filter({ hasText: duplicate }).filter({ hasText: '-8' })).toHaveCount(1);
		});

		await test.step('วิเคราะห์ความต้องการ — recalculate for today and export', async () => {
			await secondary.getByRole('link', { name: 'วิเคราะห์ความต้องการ' }).click();
			await expect(page.getByRole('heading', { name: 'วิเคราะห์ความต้องการเสบียง' })).toBeVisible();
			await expect(page.getByText(/ยังไม่มีผลคำนวณสำหรับวันที่/)).toBeVisible();
			await page.getByRole('button', { name: 'คำนวณใหม่' }).click();
			await expect(toast(page, 'คำนวณใหม่เรียบร้อย')).toBeVisible();
			await expect(page.getByText(/^คำนวณล่าสุด /)).toBeVisible();
			await expect(page.getByText('ผู้พักพิง 10 คน', { exact: true })).toBeVisible();
			await expect(page.getByText(/^ยอดผู้พักพิง\s*10\s*คน/)).toBeVisible();
			// A new shelter has no readiness (facility) data yet: every need waits for it.
			const needs = page.getByRole('row').filter({ hasText: 'รอข้อมูล' });
			await expect(page.getByRole('button', { name: 'รอข้อมูล 9' })).toBeVisible();
			await expect(page.getByRole('button', { name: 'ต้องเร่งจัดหา 0' })).toBeVisible();
			await expect(needs).toHaveCount(9);
			await page.getByRole('button', { name: 'น้ำ 3' }).click();
			await expect(needs).toHaveCount(3);
			await page.getByRole('button', { name: 'ทุกหมวดหมู่ 9' }).click();

			const download = page.waitForEvent('download');
			await page.getByRole('button', { name: /ส่งออกรายงาน/ }).click();
			const file = await download;
			expect(file.suggestedFilename()).toMatch(/^resource-needs-\d{4}-\d{2}-\d{2}\.csv$/);
			await expect(toast(page, 'ส่งออกรายงานแล้ว')).toBeVisible();
			const lines = readFileSync(await file.path(), 'utf8')
				.trim()
				.split(/\r?\n/);
			expect(lines[0]).toContain('"หมวดหมู่","รายการ","เป้าหมาย/วัน"');
			expect(lines.slice(1)).toHaveLength(9);
			expect(lines.slice(1).every((line) => line.endsWith('"รอข้อมูล"'))).toBe(true);
		});

		// Water sits in the central "กลุ่มน้ำดื่มสะอาด" group (70% share): with the seeded Sphere
		// standard, 10 people need 35 bottles a day, so 600 bottles last ~17.1 days.
		const openFoodSphere = async () => {
			await secondary.getByRole('link', { name: 'วิเคราะห์เสบียงอาหาร' }).click();
			await expect(page).toHaveURL(/tab=food-sphere/);
			await expect(page.getByText('อัตราครองเตียง 10 คน')).toBeVisible();
			await page.getByPlaceholder('ค้นหา SKU, ชื่อรายการ หรือกลุ่มความต้องการ...').fill(WATER);
			const row = page.getByRole('row').filter({ hasText: WATER });
			await expect(row).toContainText('กลุ่มน้ำดื่มสะอาด');
			await expect(row).toContainText('35.0 ขวด/วัน');
			await expect(row).toContainText('600 ขวด');
			await expect(row).toContainText('(17.1 วัน)');
			return row;
		};
		const riskFilter = page
			.locator('select')
			.filter({ has: page.locator('option[value="OVERSTOCK"]') });

		await test.step('วิเคราะห์เสบียงอาหาร — water against the group policy', async () => {
			const row = await openFoodSphere();
			// The central group policy caps stock at 14 days.
			await expect(row).toContainText('สต็อกเกินเกณฑ์');
			await expect(row).toContainText('สต็อกเกินเกณฑ์สูงสุด (14 วัน)');
			await riskFilter.selectOption('OVERSTOCK');
			await expect(row).toBeVisible();
			await riskFilter.selectOption('UNCONFIGURED');
			await expect(row).toHaveCount(0);
			await riskFilter.selectOption('ALL');
		});

		await test.step('ตั้งนโยบายเติมสต็อก — an item policy overrides the group', async () => {
			await page
				.getByRole('navigation', { name: 'แท็บคลัง' })
				.getByRole('button', {
					name: 'สต็อก'
				})
				.click();
			await stockRow(page, WATER).getByRole('button', { name: WATER, exact: true }).click();
			const detail = page.getByRole('dialog', { name: WATER });
			await detail.getByRole('tab', { name: 'ตั้งค่าเกณฑ์' }).click();
			await expect(detail).toContainText('ยังไม่ได้ตั้งค่าเฉพาะสินค้านี้');

			await detail.locator('#item-policy-lead').fill('2');
			await detail.locator('#item-policy-review').fill('3');
			await detail.locator('#item-policy-safety').fill('2');
			await expect(detail.getByTestId('item-policy-reorder-days')).toHaveText('7');
			await detail.locator('#item-policy-max').fill('30');
			// Min days must stay below lead + review + safety (7).
			await detail.locator('#item-policy-min').fill('8');
			await detail.getByRole('button', { name: 'บันทึกนโยบาย' }).click();
			await expect(
				detail.getByText(/Min DoC Days ต้องน้อยกว่า Standard Reorder Days/)
			).toBeVisible();
			await expect(toast(page, 'บันทึกนโยบายการเติมสต็อกสำเร็จ')).toHaveCount(0);

			await detail.locator('#item-policy-min').fill('2');
			await detail.getByRole('button', { name: 'บันทึกนโยบาย' }).click();
			await expect(toast(page, 'บันทึกนโยบายการเติมสต็อกสำเร็จ')).toBeVisible();
			await expect(detail).toContainText('เฉพาะรายสินค้า');
			await closeSheet(page, detail);

			// The policy does not change the stock table's "เกณฑ์" (guide, Flow B e.)…
			await expect(stockRow(page, WATER)).toContainText('ไม่มีเกณฑ์');
			// …it drives the food-sphere analysis: 17.1 days is now within 7–30.
			const row = await openFoodSphere();
			await expect(row).toContainText('สต็อกปลอดภัย');
			await riskFilter.selectOption('ADEQUATE');
			await expect(row).toBeVisible();
		});
	});

	// Known app gaps (README §9.0): flip `test.fixme` to `test` in the PR that fixes each one.

	test.fixme('GAP: after a direct distribution, adjust and cycle count show the issued lot at its old qty plus a negative lot at the destination', async ({
		page,
		run
	}) => {
		// createDistributeEntry stores the destination in `lot.note` (CR-143 FR-E1), but the
		// adjust form and the cycle count group rows by lotStorageKey, which still reads
		// `lot.note` as a pre-schema_v 5 location — so the issue lands in a phantom
		// "<destination> (ไม่ระบุวันหมดอายุ)" lot instead of the lot it was cut from.
		const code = await run.createShelter('gap-lot');
		await run.signIn(await run.warehouseStaff(code));
		const point = `E2E จุดแจก ${ulid().toLowerCase()}`;
		await page.goto('/back-office/supply');

		const receive = await openMovement(page, 'รับเข้า', 'รับเข้า');
		await pickItem(page, receive.getByPlaceholder('ค้นหา…'), WATER);
		await chooseUnit(page, receive, 'ขวด');
		await receive.getByRole('spinbutton', { name: /จำนวน/ }).fill('30');
		await receive.getByRole('button', { name: '+1ปี' }).click();
		await receive.getByRole('button', { name: 'บันทึกแล้วรับชิ้นถัดไป' }).click();
		await expect(toast(page, 'รับเข้าแล้ว')).toBeVisible();
		await closeSheet(page, receive);

		const distribute = await openMovement(page, 'เบิกจ่าย', 'เบิกจ่าย');
		await pickItem(page, distribute.getByPlaceholder('ค้นหา…'), WATER);
		await distribute.getByRole('button', { name: '10', exact: true }).click();
		await distribute.getByRole('button', { name: 'อื่นๆ...' }).click();
		await distribute.getByPlaceholder('ปลายทาง / ผู้รับ').fill(point);
		await distribute.getByRole('button', { name: 'เบิก 10 ขวด' }).click();
		await expect(toast(page, 'เบิกแล้ว')).toBeVisible();
		if (await distribute.isVisible()) await closeSheet(page, distribute);
		await expectOnHand(page, WATER, 20);

		const adjust = await openMovement(page, 'ปรับยอด', 'ปรับยอดทีละรายการ');
		await pickItem(page, adjust.locator('#item-search'), WATER);
		await adjust.locator('#lot-select').click();
		const lots = page.getByRole('option').filter({ hasText: 'คงเหลือ' });
		await expect(lots).toHaveCount(1);
		await expect(lots).toContainText(/คงเหลือ 20 ขวด$/);
		await page.keyboard.press('Escape');
		await closeSheet(page, adjust);

		const count = await openMovement(page, 'ตรวจนับ', 'ตรวจนับตามจุดเก็บ');
		await expect(count.getByRole('button', { name: /ล็อต$/ })).toHaveCount(1);
		await count.getByRole('button', { name: /^คลังหลัก/ }).click();
		await expect(count.locator('form li')).toHaveCount(1);
		await expect(count.locator('form li')).toContainText('ในระบบ 20');
	});

	test.fixme('GAP: warehouse staff cannot pick a destination shelter for a transfer', async ({
		page,
		run
	}) => {
		// The transfer API admits system_admin / shelter_manager / warehouse_staff, but the form
		// lists destinations from useShelters(), whose visibleSheltersSummary keeps only the
		// caller's own shelter for every non-admin — minus the own shelter, nothing is left.
		const source = await run.createShelter('gap-transfer-source');
		const destination = await run.createShelter('gap-transfer-destination');
		await run.signIn(await run.warehouseStaff(source));
		await page.goto('/back-office/supply?tab=transfer');
		const picker = page.getByRole('button', { name: /^ศูนย์ปลายทาง/ });
		await expect(picker).toBeEnabled();
		await picker.click();
		await expect(page.getByRole('option', { name: new RegExp(` ${destination}$`) })).toBeVisible();
	});
});
