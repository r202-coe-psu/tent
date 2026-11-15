/**
 * Supply module (คลังพัสดุ, /back-office/supply) — two journeys, real stack, nothing mocked.
 *
 * - Flow 1 (two shelters, `warehouse_staff` of each): view stock → manage storage points →
 *   receive (other + walk-in donation) → create a new item from the receive form → one
 *   distribution list of two items (created only, no dispatch) → adjust → cycle count →
 *   movements ledger (filters + CSV) → inter-shelter transfer (the source's staff request,
 *   hold/resume/cancel and dispatch; the destination's staff receive) → a stocked storage
 *   point cannot be deleted.
 * - Flow 2 (one shelter, `warehouse_staff`, 50 seeded residents): add a catalog item →
 *   food-sphere analysis → "ตั้งค่าพารามิเตอร์" (reference parameters, calculation groups,
 *   replenishment policy) → edit a group from the analysis.
 *
 * Each journey runs in its own `E2E Supply …` shelters (README §4.3), created through system
 * management as the CouchDB admin and dropped with their databases. The only central writes are
 * the staff users and the `stock_transfer` docs in `central_ops`; both are recorded by id,
 * deleted, and checked for leaks (§4.2, §4.6). The seeded central item "น้ำดื่ม 600 มล."
 * (`pnpm seed:master`) is read, never written: a transfer must reference the central catalog,
 * and it is the item mapped to the "กลุ่มน้ำดื่มสะอาด" requirement group.
 *
 * Flow 2 seeds its 50 active evacuees with the admin API: occupancy is a prerequisite of the
 * analysis, not its subject (same rule as README §8.4).
 *
 * Run (preview build, local CouchDB with `pnpm seed:master` + `pnpm db:sync`):
 * `pnpm test:e2e:supply`
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { test as base, expect, type Locator, type Page } from '@playwright/test';
import { ulid } from '../../src/lib/db/ulid';
import {
	allDocuments,
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
import { createShelterViaUi } from '../helpers/staff-ui';
import { assertRunLeftNothing, warmShelterIndexes } from '../distribution/distribution';

const SUPPLY_SHELTER_PREFIX = `${E2E_SHELTER_PREFIX} Supply`;
const CENTRAL_DBS = ['registry', 'catalog'] as const;
const WATER = 'น้ำดื่ม 600 มล.';
const WATER_GROUP = 'กลุ่มน้ำดื่มสะอาด';
const RESIDENTS = 50;
const PASSWORD = 'Password1!';
const LEDGER_SUITE = 'supply-flows';

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
				const adminPage = await context.newPage();
				try {
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
					recordCreatedShelter(code, LEDGER_SUITE);
					shelters.push(code);
					await warmShelterIndexes(code);
					return code;
				} finally {
					await adminPage.unrouteAll({ behavior: 'ignoreErrors' });
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

// ─── More page helpers ─────────────────────────────────────────────────────────

const stockTabs = (page: Page) => page.getByRole('navigation', { name: 'แท็บคลัง' });
const moreTools = (page: Page) => page.getByRole('navigation', { name: 'เครื่องมือเพิ่มเติม' });

/**
 * Run `action` (a save/delete click) and wait until the storage-points snapshot has been
 * re-read. Each mutation carries the snapshot's `rev`, so the next one must not start before
 * the refetch lands — a stale `rev` loses the write and the list never shows it.
 */
async function untilStoragePointsRefetched(page: Page, action: () => Promise<void>): Promise<void> {
	const refetched = page.waitForResponse(
		(res) =>
			res.request().method() === 'GET' && /\/storage-points$/.test(new URL(res.url()).pathname)
	);
	await action();
	await refetched;
}

/** Add a storage point from the "จัดการคลัง" tab and wait for it to be listed. */
async function addStoragePoint(
	page: Page,
	point: { name: string; area: string; types: string[] }
): Promise<void> {
	await page.getByRole('button', { name: 'เพิ่มจุดเก็บของ' }).click();
	const dialog = page.getByRole('dialog', { name: 'เพิ่มจุดเก็บของ' });
	await dialog.locator('#sp-name').fill(point.name);
	await dialog.locator('#sp-area').fill(point.area);
	for (const type of point.types) await dialog.getByText(type, { exact: true }).click();
	await untilStoragePointsRefetched(page, () =>
		dialog.getByRole('button', { name: 'บันทึก', exact: true }).click()
	);
	await expect(toast(page, 'เพิ่มจุดเก็บของสำเร็จ').last()).toBeVisible();
	await expect(dialog).toBeHidden();
	await expect(storagePointRow(page, point.name)).toBeVisible();
}

/** One storage point's row in the "จัดการคลัง" list. */
function storagePointRow(page: Page, name: string): Locator {
	return page.getByRole('listitem').filter({ has: page.getByText(name, { exact: true }) });
}

/** Open the "ตั้งค่าพารามิเตอร์" sheet of the food-sphere tab on one of its three tabs. */
async function openParameterSheet(
	page: Page,
	tab: 'นโยบายการเติมสต็อก' | 'กลุ่มสำหรับการคำนวณ' | 'พารามิเตอร์อ้างอิงอาหาร'
): Promise<Locator> {
	await page.getByRole('button', { name: 'ตั้งค่าพารามิเตอร์' }).click();
	const sheet = page.getByRole('dialog', { name: 'ตั้งค่าพารามิเตอร์สต็อกของศูนย์' });
	await expect(sheet).toBeVisible();
	await sheet.getByRole('tab', { name: tab }).click();
	return sheet;
}

/** Pick an option of a shadcn Select (a button trigger that opens a listbox). */
async function selectOption(page: Page, trigger: Locator, option: string | RegExp): Promise<void> {
	await trigger.click();
	await page.getByRole('option', { name: option }).first().click();
}

// ─── Journeys ──────────────────────────────────────────────────────────────────

test.describe('Supply module journeys', { tag: ['@critical', '@supply'] }, () => {
	// The journeys read the central seed (`pnpm seed:master`); without it they would fail
	// deep inside a flow, so skip up front with the reason.
	test.beforeAll(async () => {
		const catalog = await allDocuments('catalog');
		const hasWater = catalog.some((d) => d.type === 'item_master' && d.name === WATER);
		const hasWaterGroup = catalog.some(
			(d) => d.type === 'requirement_group' && d.name === WATER_GROUP
		);
		test.skip(
			!hasWater || !hasWaterGroup,
			`Central seed missing "${WATER}" / "${WATER_GROUP}" — run \`pnpm seed:master\` first`
		);
	});
	// Every test builds its own shelters, so the tests are independent of each other.
	test.use({ actionTimeout: 15_000 });

	test('flow 1 — stock, receive, new item, distribute list, adjust, count, ledger, transfer, storage', async ({
		page,
		run
	}) => {
		test.setTimeout(420_000);
		const source = await run.createShelter('source');
		const destination = await run.createShelter('destination');
		const sourceStaff = await run.warehouseStaff(source);
		const destinationStaff = await run.warehouseStaff(destination);
		const marker = ulid().toLowerCase();
		const donor = `E2E ผู้บริจาค ${marker}`;
		const destinationLabel = `E2E จุดแจก ${marker}`;
		const kit = `E2E ถุงยังชีพ ${marker}`;
		const waterShelf = `E2E ชั้นน้ำดื่ม ${marker}`;
		const spareShelf = `E2E ห้องสำรอง ${marker}`;

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

		await test.step('จัดการคลัง — add, edit and delete storage points', async () => {
			await stockTabs(page).getByRole('button', { name: 'จัดการคลัง' }).click();
			await expect(page).toHaveURL(/tab=storage/);
			await expect(page.getByTestId('main-store-row')).toContainText('คลังหลัก');

			await addStoragePoint(page, { name: waterShelf, area: '20', types: ['น้ำดื่ม'] });
			await addStoragePoint(page, { name: spareShelf, area: '8', types: ['ทั่วไป'] });
			await expect(storagePointRow(page, waterShelf)).toContainText('น้ำดื่ม');
			await expect(storagePointRow(page, waterShelf)).toContainText('20 ตร.ม.');

			await page.getByRole('button', { name: `แก้ไขจุดเก็บของ ${spareShelf}` }).click();
			const edit = page.getByRole('dialog', { name: 'แก้ไขจุดเก็บของ' });
			await expect(edit.locator('#sp-name')).toHaveValue(spareShelf);
			await edit.locator('#sp-area').fill('12');
			await untilStoragePointsRefetched(page, () =>
				edit.getByRole('button', { name: 'บันทึก', exact: true }).click()
			);
			await expect(toast(page, 'บันทึกจุดเก็บของสำเร็จ').last()).toBeVisible();
			await expect(edit).toBeHidden();
			await expect(storagePointRow(page, spareShelf)).toContainText('12 ตร.ม.');

			// Nothing is stored in the spare room, so it can go.
			await page.getByRole('button', { name: `ลบจุดเก็บของ ${spareShelf}` }).click();
			const confirm = page.getByRole('alertdialog', { name: 'ลบจุดเก็บของ' });
			await untilStoragePointsRefetched(page, () =>
				confirm.getByRole('button', { name: 'ลบจุดเก็บของ' }).click()
			);
			await expect(toast(page, 'ลบจุดเก็บของสำเร็จ').last()).toBeVisible();
			await expect(storagePointRow(page, spareShelf)).toHaveCount(0);
			await expect(storagePointRow(page, waterShelf)).toBeVisible();
		});

		await test.step('รับเข้า — "other" into the water shelf, a walk-in donation into the main store', async () => {
			await stockTabs(page).getByRole('button', { name: 'สต็อก' }).click();
			const sheet = await openMovement(page, 'รับเข้า', 'รับเข้า');
			await expect(sheet.getByRole('radio', { name: /รับเข้าอื่นๆ/ })).toHaveAttribute(
				'aria-checked',
				'true'
			);
			await pickItem(page, sheet.getByPlaceholder('ค้นหา…'), WATER);
			await chooseUnit(page, sheet, 'ขวด');
			await sheet.getByRole('spinbutton', { name: /จำนวน/ }).fill('120');
			await sheet.getByRole('button', { name: '+1ปี' }).click();
			await selectOption(
				page,
				sheet.getByRole('button', { name: /สถานที่จัดเก็บ/ }),
				new RegExp(escapeRegExp(waterShelf))
			);
			await sheet.getByRole('button', { name: 'บันทึกแล้วรับชิ้นถัดไป' }).click();
			await expect(toast(page, 'รับเข้าแล้ว').last()).toBeVisible();

			await sheet.getByRole('radio', { name: /บริจาคหน้างาน/ }).click();
			await sheet.locator('#walkin-donor-name').fill(donor);
			await sheet.locator('#walkin-donor-phone').fill('0800000000');
			await pickItem(page, sheet.getByPlaceholder('ค้นหา…'), WATER);
			await chooseUnit(page, sheet, 'ขวด');
			await sheet.getByRole('spinbutton', { name: /จำนวน/ }).fill('30');
			await sheet.getByRole('button', { name: '+6ด' }).click();
			await sheet.getByRole('button', { name: 'บันทึกแล้วรับชิ้นถัดไป' }).click();
			await expect(toast(page, 'รับเข้าแล้ว').last()).toBeVisible();
			await closeSheet(page, sheet);

			await expectOnHand(page, WATER, 150);
			await expect(stockRow(page, WATER)).toContainText('2 ล็อต');
		});

		await test.step('เพิ่มของใหม่ — create a shelter item from the receive form', async () => {
			const sheet = await openMovement(page, 'รับเข้า', 'รับเข้า');
			await sheet.getByRole('radio', { name: /รับเข้าอื่นๆ/ }).click();
			await receiveNewItem(page, sheet, {
				name: kit,
				category: /^ชุดพัสดุยังชีพรวม/,
				unit: 'ถุง',
				qty: '12'
			});
			await closeSheet(page, sheet);
			await expectOnHand(page, kit, 12);
			// The new item is in the shelter's own catalog too.
			await moreTools(page).getByRole('link', { name: 'สินค้า (Master)' }).click();
			await page.getByLabel('ค้นหาชื่อหรือ SKU').fill(kit);
			await expect(page.getByRole('button', { name: kit, exact: true })).toBeVisible();
			await stockTabs(page).getByRole('button', { name: 'สต็อก' }).click();
		});

		await test.step('ดูสต็อก — item detail: lots (FEFO) and history', async () => {
			await stockRow(page, WATER).getByRole('button', { name: WATER, exact: true }).click();
			const detail = page.getByRole('dialog', { name: WATER });
			await expect(detail).toBeVisible();
			await expect(detail.getByText('คงเหลือ').locator('..')).toContainText('150');
			const lots = detail.getByRole('tabpanel').getByRole('listitem');
			await expect(lots).toHaveCount(2);
			// The walk-in lot expires first, so it is the one issued next.
			await expect(lots.first()).toContainText('30');
			await expect(lots.first()).toContainText('เบิกถัดไป');
			await expect(lots.filter({ hasText: waterShelf })).toHaveCount(1);
			await detail.getByRole('tab', { name: 'ประวัติ' }).click();
			await expect(detail.getByRole('row').filter({ hasText: '+120' })).toBeVisible();
			await expect(detail.getByRole('row').filter({ hasText: '+30' })).toBeVisible();
			await closeSheet(page, detail);
		});

		await test.step('เบิกจ่าย — one list with two items (create only, no dispatch)', async () => {
			const sheet = await openMovement(page, 'เบิกจ่าย', 'เบิกจ่าย');
			const items = sheet.locator('input[id^="distribute-item-"]');
			const qtys = sheet.locator('input[id^="distribute-qty-"]');
			await pickItem(page, items.nth(0), WATER);
			await expect(sheet.getByText('แผนการตัดล็อต')).toBeVisible();
			await qtys.nth(0).fill('10');
			await sheet.getByRole('button', { name: 'เพิ่มรายการ' }).click();
			await expect(items).toHaveCount(2);
			await pickItem(page, items.nth(1), kit);
			await qtys.nth(1).fill('3');
			await expect(sheet.getByText('2 รายการ · 2 แถวในบัญชีสต็อก')).toBeVisible();
			await sheet.getByRole('button', { name: 'อื่นๆ...' }).click();
			await sheet.getByPlaceholder('ปลายทาง / ผู้รับ').fill(destinationLabel);
			await sheet.getByRole('button', { name: 'เบิก 2 รายการ' }).click();
			await expect(toast(page, 'เบิกแล้ว').first()).toBeVisible();
			if (await sheet.isVisible()) await closeSheet(page, sheet);
			await expectOnHand(page, WATER, 140);
			await expectOnHand(page, kit, 9);
		});

		await test.step('ปรับยอด — write off 2 damaged from the water-shelf lot', async () => {
			const sheet = await openMovement(page, 'ปรับยอด', 'ปรับยอดทีละรายการ');
			await pickItem(page, sheet.locator('#item-search'), WATER);
			await sheet.locator('#lot-select').click();
			// The lot FEFO did not touch: the 120 bottles on the water shelf.
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

		await test.step('ตรวจนับ — count the water shelf, one bottle short', async () => {
			const sheet = await openMovement(page, 'ตรวจนับ', 'ตรวจนับตามจุดเก็บ');
			await sheet.getByRole('button', { name: new RegExp(escapeRegExp(waterShelf)) }).click();
			const lots = sheet.locator('form li');
			await expect(lots).toHaveCount(1);
			await lots.filter({ hasText: 'ในระบบ 118' }).locator('input').fill('117');
			await expect(sheet.getByText('ไม่ตรง 1')).toBeVisible();
			await sheet.locator('#cycle-count-note').fill(`E2E ${marker} ตรวจนับประจำวัน`);
			await sheet.getByRole('button', { name: /บันทึกผลตรวจนับ \(1 รายการที่ไม่ตรง\)/ }).click();
			await expect(toast(page, /บันทึกผลตรวจนับ .* แล้ว \(1 รายการไม่ตรง\)/)).toBeVisible();
			await closeSheet(page, sheet);
			await expectOnHand(page, WATER, 137);
		});

		await test.step('ความเคลื่อนไหว — every movement, filters and CSV export', async () => {
			await stockTabs(page).getByRole('button', { name: 'ความเคลื่อนไหว' }).click();
			await expect(page).toHaveURL(/tab=movements/);
			const rows = page.getByRole('row').filter({ hasText: WATER });
			await expect(rows).toHaveCount(5);
			// "รับเข้าอื่นๆ" is booked as an adjust/found (CR-143 §C, CR-156 FR-C7).
			await expect(rows.filter({ hasText: /\+120 ขวด.*พบของเพิ่ม/ })).toBeVisible();
			await expect(rows.filter({ hasText: /รับบริจาค.*\+30 ขวด.*ผู้บริจาค/ })).toBeVisible();
			await expect(
				rows.filter({ hasText: new RegExp(`-10 ขวด.*${destinationLabel}`) })
			).toBeVisible();
			await expect(rows.filter({ hasText: /-2 ขวด.*เสียหาย/ })).toBeVisible();
			await expect(rows.filter({ hasText: /-1 ขวด.*นับไม่ตรง/ })).toBeVisible();
			await expect(rows.first()).toContainText(sourceStaff.user.name);

			const types = page.getByRole('group', { name: 'ประเภทรายการ' });
			await types.getByRole('button', { name: /^ปรับยอด/ }).click();
			await expect(rows).toHaveCount(3);
			await types.getByRole('button', { name: /^ทั้งหมด/ }).click();
			await expect(rows).toHaveCount(5);

			// The one distribution list left two ledger rows, one per item, with one destination.
			const search = page.getByLabel('ค้นหาสินค้า ผู้รับ หรือเลขอ้างอิง');
			await search.fill(destinationLabel);
			await expect(page.getByRole('row').filter({ hasText: destinationLabel })).toHaveCount(2);
			await expect(rows).toHaveCount(1);
			await search.fill('');

			const download = page.waitForEvent('download');
			await page.getByRole('button', { name: /ส่งออก CSV/ }).click();
			const csv = readFileSync(await (await download).path(), 'utf8');
			expect(csv).toContain(WATER);
			expect(csv).toContain(kit);
			expect(csv).toContain(destinationLabel);
		});

		await test.step('โอนย้าย — request, hold, resume, cancel, dispatch, receive', async () => {
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
			await expect(stockTabs(page).getByRole('button', { name: /โอนย้าย/ })).toContainText('2');

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

			// "ประวัติการโอน" is the only table on the tab; its rows only open the detail sheet.
			const historyRow = (qty: string) =>
				page
					.getByRole('row')
					.filter({ hasText: route })
					.filter({ hasText: new RegExp(`(^|\\s)${qty} ขวด`) });
			await small.getByRole('button', { name: 'ยกเลิก' }).click();
			const cancel = page.getByRole('dialog');
			await cancel.locator('#transfer-reason').fill('E2E ปลายทางแจ้งว่าไม่ต้องการแล้ว');
			await cancel.getByRole('button', { name: /ยืนยัน/ }).click();
			await expect(toast(page, 'ยกเลิกคำร้องสำเร็จ')).toBeVisible();
			await expect(historyRow('5')).toContainText('ยกเลิก');
			await expect(historyRow('5').getByRole('button')).toHaveCount(1);
			await expect(outgoingRoutes).toHaveCount(1);

			// Dispatch the 20-bottle request: stock leaves the source at once.
			await large.getByRole('button', { name: 'ยืนยันส่ง' }).click();
			const dispatch = page.getByRole('dialog', { name: 'ยืนยันการส่งมอบ' });
			await dispatch.locator('#dispatch-driver-name').fill('E2E สมศักดิ์ ขับดี');
			await dispatch.locator('#dispatch-vehicle-plate').fill('1กข 2345 สงขลา');
			// Wait for the dispatch write itself (the toast can come and go within the default
			// assertion timeout), then for the dialog to close.
			const dispatched = page.waitForResponse(
				(res) =>
					res.request().method() !== 'GET' &&
					new URL(res.url()).pathname.startsWith('/api/back-office/transfer')
			);
			await dispatch.getByRole('button', { name: 'ยืนยันส่งมอบ' }).click();
			expect((await dispatched).ok()).toBe(true);
			await expect(dispatch).toBeHidden({ timeout: 15_000 });

			await stockTabs(page).getByRole('button', { name: 'สต็อก' }).click();
			await expectOnHand(page, WATER, 117);
			await page.goto('/back-office/supply?tab=movements');
			await page
				.getByRole('group', { name: 'ประเภทรายการ' })
				.getByRole('button', { name: /^โอน/ })
				.click();
			await expect(page.getByRole('row').filter({ hasText: WATER })).toHaveCount(1);
			await expect(page.getByRole('row').filter({ hasText: WATER })).toContainText('-20 ขวด');

			// The destination's own warehouse staff receive it.
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

		await test.step('จัดการคลัง — a point that still holds stock cannot be deleted', async () => {
			await run.signIn(sourceStaff);
			await page.goto('/back-office/supply?tab=storage');
			const row = storagePointRow(page, waterShelf);
			await expect(row).toContainText('ยังมีของ 1 ล็อต');
			await expect(row.getByRole('button', { name: `ลบจุดเก็บของ ${waterShelf}` })).toBeDisabled();
			await expect(
				row.getByRole('button', { name: `แก้ไขจุดเก็บของ ${waterShelf}` })
			).toBeEnabled();
		});
	});

	test('flow 2 — add item, food-sphere analysis, calculation groups, reference parameters, replenishment policy', async ({
		page,
		run
	}) => {
		test.setTimeout(420_000);
		const code = await run.createShelter('analysis');
		const staff = await run.warehouseStaff(code);
		await seedOccupancy(code, RESIDENTS);
		const marker = ulid().toLowerCase();
		const rice = `E2E ข้าวสาร ${marker}`;
		// The calculation-group form only offers the central catalog, so the group maps a seeded item.
		const salt = 'เกลือ';
		const groupId = `E2E_SALT_${marker.slice(-8).toUpperCase()}`;
		const groupName = `E2E กลุ่มเกลือ ${marker.slice(-8)}`;

		await run.signIn(staff);
		await page.goto('/back-office/supply');

		await test.step('เพิ่มสินค้า — create a shelter item in the catalog', async () => {
			await moreTools(page).getByRole('link', { name: 'สินค้า (Master)' }).click();
			await expect(page).toHaveURL(/tab=catalog/);
			await page.getByRole('button', { name: 'เพิ่มสินค้า' }).click();
			const sheet = page.getByRole('dialog');
			await expect(sheet.getByRole('heading', { name: 'เพิ่มสินค้า' })).toBeVisible();
			await sheet.getByPlaceholder('เช่น ข้าวสาร, น้ำดื่ม').fill(rice);
			await selectOption(page, sheet.getByRole('button', { name: 'หมวดสินค้า' }), /อาหาร/);
			await sheet.getByText('-- เลือกหน่วย --').click();
			await page
				.getByRole('option', { name: /^กิโลกรัม/ })
				.first()
				.click();
			await sheet.getByRole('button', { name: 'บันทึก', exact: true }).click();
			await expect(toast(page, `เพิ่มข้อมูล ${rice} สำเร็จ`)).toBeVisible();

			await page.getByLabel('ค้นหาชื่อหรือ SKU').fill(rice);
			await expect(page.getByRole('row').filter({ hasText: rice })).toContainText('เฉพาะศูนย์');
		});

		await test.step('รับเข้า — stock the new item and the seeded water', async () => {
			await stockTabs(page).getByRole('button', { name: 'สต็อก' }).click();
			const sheet = await openMovement(page, 'รับเข้า', 'รับเข้า');
			await pickItem(page, sheet.getByPlaceholder('ค้นหา…'), WATER);
			await chooseUnit(page, sheet, 'ขวด');
			await sheet.getByRole('spinbutton', { name: /จำนวน/ }).fill('600');
			await sheet.getByRole('button', { name: '+1ปี' }).click();
			await sheet.getByRole('button', { name: 'บันทึกแล้วรับชิ้นถัดไป' }).click();
			await expect(toast(page, 'รับเข้าแล้ว').last()).toBeVisible();
			await pickItem(page, sheet.getByPlaceholder('ค้นหา…'), rice);
			await sheet.getByRole('spinbutton', { name: /จำนวน/ }).fill('20');
			await sheet.getByRole('button', { name: '+1ปี' }).click();
			await sheet.getByRole('button', { name: 'บันทึกแล้วรับชิ้นถัดไป' }).click();
			await expect(toast(page, 'รับเข้าแล้ว').last()).toBeVisible();
			await pickItem(page, sheet.getByPlaceholder('ค้นหา…'), salt);
			await sheet.getByRole('spinbutton', { name: /จำนวน/ }).fill('200');
			await sheet.getByRole('button', { name: '+1ปี' }).click();
			await sheet.getByRole('button', { name: 'บันทึกแล้วรับชิ้นถัดไป' }).click();
			await expect(toast(page, 'รับเข้าแล้ว').last()).toBeVisible();
			await closeSheet(page, sheet);
			await expectOnHand(page, WATER, 600);
			await expectOnHand(page, rice, 20);
			await expectOnHand(page, salt, 200);
		});

		const waterGroup = () =>
			page.getByRole('button', { name: new RegExp(`^${WATER_GROUP} \\d+ รายการ`) });
		// Headcount = the residents plus the one staff account (the tooltip says so).
		const headcount = RESIDENTS + 1;
		const perDay = (n: number) => n.toLocaleString('en-US');
		const openFoodSphere = async () => {
			await moreTools(page).getByRole('link', { name: 'วิเคราะห์เสบียงอาหาร' }).click();
			await expect(page).toHaveURL(/tab=food-sphere/);
			await expect(page.getByRole('heading', { name: 'วิเคราะห์เสบียงอาหาร' })).toBeVisible();
			await expect(page.getByRole('button', { name: /^ทั้งหมด \d+ คน$/ }).first()).toBeVisible();
		};

		await test.step('วิเคราะห์เสบียงอาหาร — 50 residents set the water target', async () => {
			await openFoodSphere();
			const people = page.getByRole('button', { name: `ทั้งหมด ${headcount} คน` }).first();
			await people.click();
			const tip = page.locator('[data-slot="tooltip-content"]').filter({ hasText: 'เจ้าหน้าที่' });
			await expect(tip.first()).toContainText('ผู้ประสบภัย');
			await expect(tip.first()).toContainText(String(RESIDENTS));
			await people.click();

			// The target is headcount × the seeded per-person standard: read it, don't hard-code it.
			const targetText = (await waterGroup().innerText()).match(/เป้าหมาย: ([\d,.]+) ลิตร\/วัน/);
			expect(targetText, 'water target shown on the group').not.toBeNull();
			const seededTarget = Number(targetText![1].replace(/,/g, ''));
			const seededPerPerson = seededTarget / headcount;
			expect(seededPerPerson).toBeGreaterThan(0);
			const search = page.getByLabel('ค้นหารายการเสบียง');
			await search.fill(WATER);
			await page.getByRole('button', { name: 'ขยายทั้งหมด' }).click();
			const row = page.getByRole('row').filter({ hasText: WATER });
			await expect(row).toContainText('600 ขวด');
			await expect(row).toContainText(/[\d,.]+ ขวด\/วัน/);
			await search.fill('');
		});

		await test.step('พารามิเตอร์อ้างอิงอาหาร — raise the water standard to 5 L per person', async () => {
			const sheet = await openParameterSheet(page, 'พารามิเตอร์อ้างอิงอาหาร');
			// Three segments carry a water standard; residents without an age fall under "ทุกคน".
			await sheet
				.getByRole('row')
				.filter({ hasText: 'ทุกคน' })
				.getByRole('button', { name: 'แก้ไข DRINKING_WATER' })
				.click();
			await sheet.locator('#form-daily-demand').fill('5');
			await sheet.getByRole('button', { name: /^บันทึก/ }).click();
			await expect(toast(page, /ปรับปรุงเกณฑ์โภชนาการ.*DRINKING_WATER.*สำเร็จ/)).toBeVisible();
			await page.keyboard.press('Escape');
			await expect(sheet).toBeHidden();
			await expect(waterGroup()).toContainText(`เป้าหมาย: ${perDay(5 * headcount)} ลิตร/วัน`);
		});

		await test.step('กลุ่มสำหรับการคำนวณ — add a salt group that maps a seeded item', async () => {
			const sheet = await openParameterSheet(page, 'กลุ่มสำหรับการคำนวณ');
			await sheet.getByRole('button', { name: 'เพิ่มกลุ่มความต้องการ' }).click();
			await sheet.getByRole('textbox', { name: /ชื่อกลุ่มความต้องการ/ }).fill(groupName);
			await sheet.getByRole('textbox', { name: /รหัสกลุ่ม/ }).fill(groupId);
			await selectOption(page, sheet.getByRole('button', { name: /หน่วยนับมาตรฐาน/ }), /^กรัม$/);
			await sheet.getByRole('button', { name: /เพิ่มสินค้าคู่เทียบ/ }).click();
			await sheet.getByRole('combobox').filter({ hasText: '-- เลือกสิ่งของ --' }).click();
			await page.getByPlaceholder('ค้นหาชื่อสิ่งของ หรือ SKU...').fill(salt);
			await page.getByRole('option', { name: /^เกลือ(\s|$)/ }).click();
			// The group counts grams; the item is stocked in kilograms.
			await sheet.locator('#item-map-cf-0').fill('1000');
			await sheet.locator('#item-map-share-0').fill('100');
			await sheet.getByRole('button', { name: /^บันทึก/ }).click();
			await expect(toast(page, `บันทึกกลุ่มความต้องการ "${groupName}" สำเร็จ`)).toBeVisible();
			await expect(sheet.getByRole('row').filter({ hasText: groupId })).toContainText(groupName);
			await page.keyboard.press('Escape');
			await expect(sheet).toBeHidden();
		});

		await test.step('พารามิเตอร์อ้างอิงอาหาร — a daily need for the new salt group', async () => {
			const sheet = await openParameterSheet(page, 'พารามิเตอร์อ้างอิงอาหาร');
			await sheet.getByRole('button', { name: 'เพิ่มเกณฑ์โภชนาการ' }).click();
			await selectOption(page, sheet.locator('#form-req-group'), new RegExp(escapeRegExp(groupId)));
			await sheet.locator('#form-daily-demand').fill('500');
			await expect(sheet.getByTestId('uom-display')).toHaveText('gram');
			await sheet.getByRole('button', { name: /^บันทึก/ }).click();
			await expect(toast(page, new RegExp(`เพิ่มเกณฑ์โภชนาการ.*${groupId}.*สำเร็จ`))).toBeVisible();
			await page.keyboard.press('Escape');
			await expect(sheet).toBeHidden();
			// headcount × 500 g a day; 200 kg last ~7.8 days at 51 people.
			const group = page.getByRole('button', { name: new RegExp(`^${groupName} 1 รายการ`) });
			await expect(group).toContainText(`เป้าหมาย: ${perDay(headcount * 500)} กรัม/วัน`);
		});

		await test.step('นโยบายเติมสต็อก — a policy for the salt group, then a tighter one for water', async () => {
			const sheet = await openParameterSheet(page, 'นโยบายการเติมสต็อก');
			await sheet.getByRole('button', { name: 'เพิ่มนโยบาย' }).click();
			await selectOption(
				page,
				sheet.locator('#form-replen-group'),
				new RegExp(escapeRegExp(groupId))
			);
			await sheet.locator('#form-lead-time').fill('2');
			await sheet.locator('#form-review-period').fill('2');
			await sheet.locator('#form-safety-days').fill('1');
			await expect(sheet.getByTestId('standard-reorder-days')).toHaveText('5');
			await sheet.locator('#form-min-doc').fill('9');
			await sheet.locator('#form-max-doc').fill('30');
			await sheet.getByRole('button', { name: /^บันทึก/ }).click();
			await expect(toast(page, 'บันทึกนโยบายการเติมสต็อกสำเร็จ')).toHaveCount(0);
			// Min days must stay below lead + review + safety (5).
			await sheet.locator('#form-min-doc').fill('3');
			await sheet.getByRole('button', { name: /^บันทึก/ }).click();
			await expect(toast(page, 'บันทึกนโยบายการเติมสต็อกสำเร็จ')).toBeVisible();

			// Water keeps its central policy except for one more safety day, as a shelter override.
			const water = sheet.getByRole('row').filter({ hasText: 'DRINKING_WATER' });
			await water.getByRole('button', { name: 'แก้ไข' }).click();
			const safety = sheet.getByLabel(/วันสำรอง/);
			const current = Number(await safety.inputValue());
			await safety.fill(String(current + 1));
			await sheet.getByRole('button', { name: /^บันทึก/ }).click();
			await expect(toast(page, 'บันทึกนโยบายการเติมสต็อกสำเร็จ').last()).toBeVisible();
			await page.keyboard.press('Escape');
			await expect(sheet).toBeHidden();
		});

		await test.step('วิเคราะห์เสบียงอาหาร — edit the group from the analysis, filter and search', async () => {
			// 200 kg ÷ 25.5 kg/day ≈ 7.8 days, past the 3-day minimum and inside the 30-day maximum.
			const riskFilter = page.getByLabel('กรองสถานะ');
			await riskFilter.selectOption('ADEQUATE');
			await expect(page.getByRole('button', { name: new RegExp(`^${groupName}`) })).toBeVisible();
			await riskFilter.selectOption('ALL');

			await page.getByRole('button', { name: `แก้ไขกลุ่ม ${groupName}` }).click();
			const edit = page.getByRole('dialog', { name: new RegExp(`แก้ไขกลุ่ม ${groupName}`) });
			const renamed = `${groupName} (แก้ไข)`;
			await edit.getByRole('textbox', { name: /ชื่อกลุ่มความต้องการ/ }).fill(renamed);
			await edit.getByRole('button', { name: 'บันทึกการแก้ไข' }).first().click();
			await expect(toast(page, `ปรับปรุงกลุ่มความต้องการ "${renamed}" สำเร็จ`)).toBeVisible();
			await page.keyboard.press('Escape');
			await expect(edit).toBeHidden();
			await expect(
				page.getByRole('button', { name: new RegExp(`^${escapeRegExp(renamed)}`) })
			).toBeVisible();

			const search = page.getByLabel('ค้นหารายการเสบียง');
			await search.fill(salt);
			// "ผงเกลือแร่" matches the search too: pick the row of the renamed group.
			const saltRow = page.getByRole('row').filter({ hasText: `กลุ่มคำนวณ: ${renamed}` });
			await expect(saltRow).toContainText('200 กิโลกรัม');
			await search.fill('ไม่มีของนี้ E2E');
			await expect(page.getByText('ไม่พบรายการเสบียงตามเงื่อนไขที่เลือก')).toBeVisible();
		});
	});
});
