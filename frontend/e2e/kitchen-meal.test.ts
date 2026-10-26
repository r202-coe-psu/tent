/**
 * Kitchen journey (ครัวกลางและอาหาร ↔ เบิกวัตถุดิบครัว) against the real local CouchDB.
 *
 * 1. Shelter manager adds an E2E recipe (BOM) from "ฐานสูตร BOM" — kitchen staff can only read
 *    recipes (recipe-tab gates editing to shelter manager / warehouse staff).
 * 2. Kitchen staff creates a meal session ("สร้างมื้อใหม่") for two target groups.
 * 3. Kitchen staff adds two production batches (ชุดการผลิต) to that one session — one per group —
 *    deleting every ingredient flagged "ขาดสต็อก" and opening one requisition ticket per batch.
 * 4. Warehouse staff works both tickets in "เบิกวัตถุดิบครัว": check the allocation and the
 *    on-hand stock, "อนุมัติ" (PENDING_PICK → READY_FOR_DISPATCH), then "ปล่อยของและตัดสต็อก"
 *    (→ IN_TRANSIT, writes the stock_ledger rows). Kitchen staff then confirms receipt
 *    ("ยืนยันรับวัตถุดิบ", → COMPLETED) from the production board.
 * 5. Batch A is cooked, recorded and confirmed into stock first; the session must stay
 *    "กำลังดำเนินการ" with only its group complete. Then batch B goes through the same steps and
 *    the session becomes "เสร็จสิ้นแล้ว".
 *
 * Fixtures (catalog only): three E2E item masters — an ingredient with stock, an ingredient
 * without stock, and a ready-meal item — plus one stock lot for the stocked ingredient. Every
 * session, plan, ticket, service, receipt and ledger row is written by the browser.
 *
 * Roles follow the CouchDB guard (shelter-access-design.ts): only `kitchen_staff` may open or
 * receive a kitchen ticket, `warehouse_staff` approves and dispatches it (dispatch is warehouse
 * only), and `shelter_manager` confirms cooked food into stock.
 *
 * Teardown deletes only documents this run created (fixture ids + `created_by` of the three
 * throw-away users) and ends with a zero-leak check.
 */

import {
	expect,
	test,
	type Browser,
	type BrowserContext,
	type Locator,
	type Page
} from '@playwright/test';
import { ulid } from '../src/lib/db/ulid';
import {
	allDocuments,
	couchLogin,
	createCouchUser,
	deleteCouchUser,
	deleteDocument,
	putDocument,
	routeBrowserCouchThroughApp,
	seedSecurityQuestion,
	type CouchDocument,
	type TestUser
} from './helpers/couch';
import { CAN_WRITE, LOCAL_RUN_ID, READ_ONLY_REASON } from './helpers/e2e-env';
import { injectSession } from './helpers/login';

const SHELTER_DB = 'shelter_sh001';
const CATALOG_DB = 'catalog';
const RUN = `${LOCAL_RUN_ID}${ulid().slice(-4).toLowerCase()}`;

const KITCHEN: TestUser = {
	name: `e2e_kitchen_ks_${RUN}`,
	password: 'Password1!',
	roles: ['shelter:SH001', 'kitchen_staff'],
	display_name: 'E2E Kitchen Staff'
};
const MANAGER: TestUser = {
	name: `e2e_kitchen_sm_${RUN}`,
	password: 'Password1!',
	roles: ['shelter:SH001', 'shelter_manager'],
	display_name: 'E2E Kitchen Manager'
};

const WAREHOUSE: TestUser = {
	name: `e2e_kitchen_wh_${RUN}`,
	password: 'Password1!',
	roles: ['shelter:SH001', 'warehouse_staff'],
	display_name: 'E2E Kitchen Warehouse'
};

const RICE = `E2E ข้าวสาร ${RUN}`;
const CHICKEN = `E2E เนื้อไก่ ${RUN}`;
const READY_MEAL = `E2E ข้าวต้มไก่กล่อง ${RUN}`;
const RECIPE = `E2E ข้าวต้มไก่ ${RUN}`;
const SESSION_NAME = `E2E มื้อกลางวัน ${RUN}`;

const HALAL_MENU = `E2E ข้าวต้มฮาลาล ${RUN}`;

const REGULAR_LABEL = 'ทั่วไป';
const HALAL_LABEL = 'ฮาลาล (มุสลิม)';
const REGULAR_HEADCOUNT = 10;
const RICE_STOCK = 50;
const HALAL_HEADCOUNT = 5;

interface Batch {
	label: string;
	/** The one target group this batch covers. */
	group: string;
	/** The session's other group, unticked so the batch covers `group` only. */
	otherGroup: string;
	target: number;
	actualYield: number;
	served: number;
	waste: number;
	ticketNo: string;
}

const BATCH_A: Batch = {
	label: RECIPE,
	group: REGULAR_LABEL,
	otherGroup: HALAL_LABEL,
	target: REGULAR_HEADCOUNT,
	actualYield: REGULAR_HEADCOUNT,
	served: REGULAR_HEADCOUNT - 1,
	waste: 1,
	ticketNo: ''
};
const BATCH_B: Batch = {
	label: HALAL_MENU,
	group: HALAL_LABEL,
	otherGroup: REGULAR_LABEL,
	target: HALAL_HEADCOUNT,
	actualYield: HALAL_HEADCOUNT,
	served: HALAL_HEADCOUNT,
	waste: 0,
	ticketNo: ''
};

const ownedIds = new Set<string>();
const owners = [KITCHEN.name, MANAGER.name, WAREHOUSE.name];
const sessions: Record<string, string> = {};
const contexts: BrowserContext[] = [];

function isOwned(doc: CouchDocument): boolean {
	return ownedIds.has(doc._id) || owners.includes(String(doc.created_by ?? ''));
}

async function seedItemMaster(name: string, unit: string, category: string): Promise<string> {
	const id = `item_master:${ulid()}`;
	const now = new Date().toISOString();
	await putDocument(CATALOG_DB, {
		_id: id,
		type: 'item_master',
		schema_v: 4,
		created_at: now,
		updated_at: now,
		created_by: MANAGER.name,
		name,
		category,
		sku: `e2e-kitchen-${RUN}`,
		base_unit: unit,
		conversions: [],
		default_inventory_uom: unit,
		default_issue_uom: unit,
		distribution_type: 'recurring',
		type_class: 'CONSUMABLE',
		deactivated: false,
		dietary: [],
		returnable: false
	});
	ownedIds.add(id);
	return id;
}

async function seedStockLot(itemId: string, qty: string, unit: string): Promise<void> {
	const id = `stock_ledger:${ulid()}`;
	const now = new Date().toISOString();
	await putDocument(SHELTER_DB, {
		_id: id,
		type: 'stock_ledger',
		schema_v: 6,
		shelter_code: 'SH001',
		created_at: now,
		updated_at: now,
		created_by: MANAGER.name,
		item_id: itemId,
		qty,
		unit,
		reason: 'adjust',
		adjust_reason: 'found',
		ref_id: null,
		lot_ref: id,
		occurred_at: now
	});
	ownedIds.add(id);
}

async function cleanupOwnedDocuments(): Promise<void> {
	const errors: unknown[] = [];
	for (const db of [SHELTER_DB, CATALOG_DB]) {
		for (let pass = 0; pass < 3; pass += 1) {
			const owned = (await allDocuments(db)).filter(isOwned);
			if (owned.length === 0) break;
			const results = await Promise.allSettled(owned.map((doc) => deleteDocument(db, doc)));
			for (const result of results) {
				if (result.status === 'rejected') errors.push(result.reason);
			}
		}
	}
	for (const user of [KITCHEN, MANAGER, WAREHOUSE]) {
		try {
			await deleteCouchUser(user.name);
		} catch (error) {
			errors.push(error);
		}
	}
	if (errors.length > 0) {
		throw new AggregateError(errors, `Could not fully clean kitchen E2E run ${RUN}`);
	}
}

async function openAs(browser: Browser, user: TestUser): Promise<Page> {
	const context = await browser.newContext();
	contexts.push(context);
	const page = await context.newPage();
	await routeBrowserCouchThroughApp(page);
	await injectSession(page, user, sessions[user.name]);
	return page;
}

/** Click a back-office sidebar link, expanding its parent group first when collapsed. */
async function openSidebar(page: Page, label: string, group?: string): Promise<void> {
	const sidebar = page.locator('aside').first();
	const link = sidebar.getByRole('link', { name: label, exact: true });
	if (group && !(await link.isVisible())) {
		await sidebar.getByRole('button', { name: group }).click();
	}
	const href = (await link.getAttribute('href')) ?? '';
	await link.click();
	await expect(page).toHaveURL((url) => url.pathname === href);
}

/**
 * Reload before reading another user's write. Open staff pages can miss live `_changes` events
 * (see the GAP test below), so the journey does what a person does today: refresh.
 */
async function refresh(page: Page): Promise<void> {
	await page.reload();
}

function toast(page: Page, text: string | RegExp) {
	return page.locator('[data-sonner-toast]').filter({ hasText: text });
}

/** A number input whose (unbound) label is `label`, inside `scope`. */
function numberUnder(scope: ReturnType<Page['locator']>, label: string) {
	return scope
		.getByText(label, { exact: true })
		.locator('xpath=..')
		.getByRole('spinbutton')
		.first();
}

async function findSessionCard(page: Page) {
	await page.getByPlaceholder('ค้นหาชื่อมื้อ หรือวันที่...').fill(SESSION_NAME);
	const card = page.locator('[data-slot="accordion-item"]').filter({ hasText: SESSION_NAME });
	await expect(card).toBeVisible({ timeout: 15_000 });
	// Only sessions present on first load start expanded; a new one renders collapsed.
	const trigger = card.locator('[data-slot="accordion-trigger"]');
	if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
	await expect(trigger).toHaveAttribute('aria-expanded', 'true');
	return card;
}

async function findTicketRow(page: Page, text: string | RegExp) {
	await expect(
		page.getByRole('heading', { name: /จัดการคำร้องโรงครัวและเสบียงอาหาร/ })
	).toBeVisible({ timeout: 15_000 });
	const row = page.getByRole('row').filter({ hasText: text });
	await expect(row).toBeVisible({ timeout: 15_000 });
	return row;
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** One batch row of the session card's "ชุดการผลิต & แผนอาหาร" tab. */
function planRow(card: Locator, batch: Batch) {
	return card
		.locator('div')
		.filter({ hasText: batch.ticketNo })
		.filter({ has: card.page().getByRole('link', { name: 'จัดการ / สูตร' }) })
		.last();
}

/** One row of the session card's 5-group target table: group, target, cooked, status. */
async function expectGroupProgress(
	card: Locator,
	group: string,
	target: number,
	cooked: number,
	status: 'ครบแล้ว' | 'ยังไม่ครบ'
): Promise<void> {
	const cells = card.getByRole('row').filter({ hasText: group }).getByRole('cell');
	await expect(cells.nth(1)).toHaveText(String(target));
	await expect(cells.nth(2)).toHaveText(String(cooked));
	await expect(cells.nth(3)).toContainText(status);
}

/** Kitchen: add one production batch to the session and open its requisition ticket. */
async function planBatch(kitchen: Page, batch: Batch): Promise<void> {
	await openSidebar(kitchen, 'ครัวกลางและอาหาร');
	const card = await findSessionCard(kitchen);
	await card.getByRole('link', { name: 'เพิ่มเมนูผลิต' }).click();
	await expect(
		kitchen.getByRole('heading', { name: 'แผงควบคุมและจัดสรรเครื่องครัวภัยพิบัติ' })
	).toBeVisible({ timeout: 15_000 });
	await expect(kitchen.getByText(SESSION_NAME)).toBeVisible();

	const recipeSelect = kitchen.locator('select');
	const option = recipeSelect.locator('option', { hasText: RECIPE });
	await expect(option).toHaveCount(1, { timeout: 15_000 });
	await recipeSelect.selectOption((await option.getAttribute('value')) ?? '');
	const menuLabel = kitchen.getByPlaceholder(/ข้าวต้มไก่ฮาลาล/);
	await expect(menuLabel).toHaveValue(RECIPE);
	await menuLabel.fill(batch.label);

	// Both session groups start ticked; this batch covers one of them only.
	const other = kitchen.getByRole('checkbox', {
		name: new RegExp(`^${escapeRegExp(batch.otherGroup)}`)
	});
	await expect(other).toBeChecked();
	await other.uncheck();
	await expect(
		kitchen.getByRole('checkbox', { name: new RegExp(`^${escapeRegExp(batch.group)}`) })
	).toBeChecked();
	await expect(
		kitchen.locator('p', { hasText: 'เป้าจัดสรร' }).locator('xpath=following-sibling::p')
	).toHaveText(`${batch.target} จาน`);

	const bom = kitchen.locator('[data-slot="card"]').filter({
		hasText: '2. คำนวณวัตถุดิบ & สต็อกในคลัง'
	});
	const rows = bom.getByRole('row');
	await expect(rows.filter({ hasText: RICE })).toContainText('พร้อม', { timeout: 15_000 });
	await expect(rows.filter({ hasText: CHICKEN })).toContainText('ขาดสต็อก');

	// Delete every ingredient the warehouse cannot cover, so the ticket only asks for what's in
	// stock (the warehouse could also allocate 0 for it, but this journey keeps every line filled).
	const deleteButtons = rows.filter({ hasText: 'ขาดสต็อก' });
	while ((await deleteButtons.count()) > 0) {
		await deleteButtons.first().getByRole('button', { name: 'ลบวัตถุดิบนี้' }).click();
		await expect(deleteButtons.first())
			.not.toBeVisible({ timeout: 5_000 })
			.catch(() => {});
	}
	await expect(rows.filter({ hasText: CHICKEN })).toHaveCount(0);
	await expect(rows.filter({ hasText: RICE })).toContainText('พร้อม');

	await kitchen.getByRole('button', { name: 'สร้างใบเบิกวัตถุดิบ' }).click();
	await expect(toast(kitchen, /เปิดตั๋วเบิกวัตถุดิบ \S+ แล้ว/).last()).toBeVisible({
		timeout: 15_000
	});
	await expect(kitchen.getByText(`รอคลังอนุมัติใบเบิก: ${batch.label}`)).toBeVisible();
	// Read the number from this page's Stage B card, not the toast: the previous batch's toast
	// can still be on screen (the toaster lives in the root layout).
	const summary = kitchen.getByText(new RegExp(`^\\S+ · เป้าหมาย ${batch.target} จาน$`));
	await expect(summary).toBeVisible();
	batch.ticketNo = (await summary.innerText()).split(' · ')[0].trim();
	expect(batch.ticketNo, `ticket number for ${batch.label}`).toMatch(/^TKT-KITCHEN-\d+$/);
	await expect(kitchen.getByRole('heading', { name: 'รอคลังจัดของ' })).toBeVisible();
}

/** Warehouse: check allocation + stock, approve, then release the goods (stock-out). */
async function approveBatch(warehouse: Page, batch: Batch, onHand: number): Promise<void> {
	// Straight to the queue: the warehouse role is not guaranteed the kitchen sidebar group.
	await warehouse.goto('/back-office/tickets/kitchen');
	const row = await findTicketRow(warehouse, batch.ticketNo);
	await expect(row).toContainText(`ใบเบิกวัตถุดิบ: ${batch.label}`);
	await expect(row).toContainText('รอจัดของ');
	await row.getByRole('button', { name: /จัดการ/ }).click();

	await expect(warehouse.getByText(batch.ticketNo).first()).toBeVisible({ timeout: 15_000 });
	const items = warehouse.getByRole('listitem');
	const riceLine = items.filter({ hasText: RICE });
	await expect(riceLine).toBeVisible();
	await expect(items.filter({ hasText: CHICKEN })).toHaveCount(0);
	// The on-hand column shows what's left of the seeded rice lot (earlier batches already
	// dispatched) and the allocation defaults to what the kitchen asked for (recipe: 1 kg per
	// 10 dishes), so nothing is short and approve is enabled.
	await expect(riceLine).toContainText(String(onHand));
	await expect(riceLine).not.toContainText('สต็อกไม่พอ');
	await expect(warehouse.getByLabel(`จำนวนที่คลังจัดให้ ${RICE}`)).toHaveValue(
		String(batch.target / REGULAR_HEADCOUNT)
	);

	const approve = warehouse.getByRole('button', { name: 'อนุมัติ', exact: true });
	await expect(approve).toBeEnabled({ timeout: 15_000 });
	await approve.click();
	await expect(toast(warehouse, 'อนุมัติแล้ว รอคลังปล่อยของ')).toBeVisible({ timeout: 15_000 });

	// CR-178: dispatch is per lot. The items-table row shows the rice line pre-filled with the auto
	// plan (the whole line from the seeded lot) as "ครบ", so the button is enabled without any clicks.
	const lotRow = warehouse
		.getByRole('listitem')
		.filter({ hasText: RICE })
		.filter({
			has: warehouse.getByRole('button', { name: 'จัดการ lot' })
		});
	await expect(lotRow).toContainText('พร้อมปล่อย', { timeout: 15_000 });
	// The modal shows the same prefill; open, check, close without saving.
	await warehouse.getByRole('button', { name: 'จัดการ lot' }).click();
	await expect(warehouse.getByLabel('จำนวนที่ใช้จาก Lot นี้')).toHaveValue(
		String(batch.target / REGULAR_HEADCOUNT),
		{ timeout: 15_000 }
	);
	// Scope to the dialog — the action bar also has "ยกเลิกตั๋ว".
	await warehouse.getByRole('dialog').getByRole('button', { name: 'ยกเลิก', exact: true }).click();
	await expect(warehouse.getByRole('dialog')).toBeHidden();
	const dispatch = warehouse.getByRole('button', { name: 'ปล่อยของและตัดสต็อก' });
	await expect(dispatch).toBeEnabled({ timeout: 15_000 });
	await dispatch.click();
	await expect(toast(warehouse, 'ปล่อยของแล้ว ตัดสต็อกเรียบร้อย')).toBeVisible({
		timeout: 15_000
	});
	await expect(warehouse.getByText('รอครัวยืนยันรับวัตถุดิบ')).toBeVisible();
}

/** Kitchen: confirm the dispatched ingredients arrived (IN_TRANSIT → COMPLETED). */
async function receiveIngredients(kitchen: Page, batch: Batch): Promise<void> {
	await openSidebar(kitchen, 'ครัวกลางและอาหาร');
	await refresh(kitchen);
	const plan = planRow(await findSessionCard(kitchen), batch);
	await expect(plan).toContainText('กำลังจัดส่ง', { timeout: 15_000 });
	await plan.getByRole('link', { name: 'จัดการ / สูตร' }).click();

	// An in-transit ticket opens on stage B (stage C stays locked until it's received); clicking
	// the tab is a no-op then, but keeps the step independent of which stage the link picks.
	await kitchen.getByRole('tab', { name: /รอคลังอนุมัติ/ }).click();
	await expect(kitchen.getByText('คลังปล่อยของแล้ว พร้อมยืนยันรับวัตถุดิบ')).toBeVisible({
		timeout: 15_000
	});
	await kitchen.getByRole('button', { name: 'ยืนยันรับวัตถุดิบ', exact: true }).click();
	await expect(toast(kitchen, /ยืนยันรับวัตถุดิบแล้ว/)).toBeVisible({ timeout: 15_000 });
	await expect(kitchen.getByText('วัตถุดิบพร้อมประกอบอาหารเรียบร้อยแล้ว')).toBeVisible();
}

/** Kitchen: open the batch from the session card, start cooking and record the yield. */
async function cookBatch(kitchen: Page, batch: Batch): Promise<void> {
	await openSidebar(kitchen, 'ครัวกลางและอาหาร');
	await refresh(kitchen);
	const plan = planRow(await findSessionCard(kitchen), batch);
	await expect(plan).toContainText('วัตถุดิบพร้อมปรุง', { timeout: 15_000 });
	await plan.getByRole('link', { name: 'จัดการ / สูตร' }).click();

	await expect(kitchen.getByText('วัตถุดิบพร้อมประกอบอาหารเรียบร้อยแล้ว')).toBeVisible({
		timeout: 15_000
	});
	await expect(kitchen.getByText(`ตั๋ว ${batch.ticketNo}: รับวัตถุดิบแล้ว`)).toBeVisible();
	await kitchen.getByRole('button', { name: 'เริ่มปรุงอาหาร' }).click();
	await expect(toast(kitchen, 'เริ่มปรุงอาหารแล้ว')).toBeVisible({ timeout: 15_000 });
	await expect(kitchen.getByText('กำลังปรุงอาหารอยู่')).toBeVisible();

	const stage = kitchen.locator('[data-slot="card"]').filter({ hasText: 'กำลังปรุงอาหารอยู่' });
	await numberUnder(stage, 'จำนวนจานปรุงได้จริง').fill(String(batch.actualYield));
	await numberUnder(stage, 'แจกจ่ายในศูนย์').fill(String(batch.served));
	await numberUnder(stage, 'อาหารเหลือทิ้ง').fill(String(batch.waste));
	await kitchen.getByRole('button', { name: /บันทึกผลการผลิต/ }).click();
	await expect(toast(kitchen, 'บันทึกผลการผลิตและแจกจ่ายสำเร็จแล้ว!')).toBeVisible({
		timeout: 15_000
	});
	await expect(kitchen).toHaveURL(/\/back-office\/kitchen$/);
	await expect(planRow(await findSessionCard(kitchen), batch)).toContainText(
		'รอคลังตรวจรับเข้าสต็อก'
	);
}

/** Manager: confirm one batch's cooked food into stock from เบิกวัตถุดิบครัว. */
async function receiveBatch(manager: Page, batch: Batch): Promise<void> {
	const mission = `รับอาหารปรุงเสร็จ: ${batch.label}`;
	await openSidebar(manager, 'เบิกวัตถุดิบครัว', 'จัดการคำร้องเบิกจ่าย');
	await refresh(manager);
	const row = await findTicketRow(manager, mission);
	await expect(row).toContainText('รอตรวจรับเข้าคลัง');
	await row.getByRole('button', { name: /จัดการ/ }).click();

	await expect(manager.getByText(`รับของเข้าคลัง: ${batch.label}`)).toBeVisible({
		timeout: 15_000
	});
	await expect(manager.getByText(`ตั๋ว ${batch.ticketNo}: รับวัตถุดิบแล้ว`)).toBeVisible();
	await manager.getByRole('combobox').filter({ hasText: 'เลือกอาหารปรุงสำเร็จ' }).click();
	await manager.getByPlaceholder('ค้นหาชื่ออาหาร...').fill(READY_MEAL);
	await manager.getByRole('option', { name: READY_MEAL }).click();
	await expect(manager.getByLabel(/จำนวน/)).toHaveValue(String(batch.actualYield));

	await manager
		.getByRole('button', { name: `ยืนยันตรวจรับเข้าสต็อก (รวม ${batch.actualYield})` })
		.click();
	await expect(toast(manager, 'ยืนยันตรวจรับเข้าสต็อกแล้ว')).toBeVisible({ timeout: 15_000 });
	await expect(manager.getByText('ตรวจรับเข้าคลังเรียบร้อยแล้ว')).toBeVisible();

	await openSidebar(manager, 'เบิกวัตถุดิบครัว', 'จัดการคำร้องเบิกจ่าย');
	await expect(await findTicketRow(manager, mission)).toContainText('รับเข้าคลังแล้ว');
}

test.describe(
	'Kitchen — recipe → meal → batches → requisition → cook → stock-in',
	{ tag: ['@critical', '@kitchen'] },
	() => {
		test.skip(!CAN_WRITE, READ_ONLY_REASON);
		test.setTimeout(180_000);

		test.beforeAll(async () => {
			for (const user of [KITCHEN, MANAGER, WAREHOUSE]) {
				await createCouchUser(user);
				await seedSecurityQuestion(user.name);
				sessions[user.name] = await couchLogin(user.name, user.password);
			}
			const riceId = await seedItemMaster(RICE, 'kg', 'item_category:food');
			await seedItemMaster(CHICKEN, 'kg', 'item_category:food');
			await seedItemMaster(READY_MEAL, 'box', 'item_category:ready_meal');
			await seedStockLot(riceId, String(RICE_STOCK), 'kg');
		});

		// Close both browsers before teardown so no page is still reading the docs being deleted.
		test.afterEach(async () => {
			await Promise.all(
				contexts.splice(0).map(async (context) => {
					// Drop route handlers first so in-flight `_changes` long-polls aren't fetched on a dying context.
					for (const page of context.pages()) await page.unrouteAll({ behavior: 'ignoreErrors' });
					await context.close();
				})
			);
		});

		test.afterAll(async () => {
			await cleanupOwnedDocuments();
			const leftovers: string[] = [];
			for (const db of [SHELTER_DB, CATALOG_DB]) {
				leftovers.push(...(await allDocuments(db)).filter(isOwned).map((d) => `${db}/${d._id}`));
			}
			expect(leftovers, 'zero-leak: no documents from this run remain').toEqual([]);
		});

		test('one meal with two production batches, from recipe to stock', async ({ browser }) => {
			const kitchen = await openAs(browser, KITCHEN);
			const manager = await openAs(browser, MANAGER);
			const warehouse = await openAs(browser, WAREHOUSE);

			await test.step('manager adds a recipe from ฐานสูตร BOM (kitchen_staff may only read recipes)', async () => {
				await manager.goto('/back-office/kitchen');
				await openSidebar(manager, 'ครัวกลางและอาหาร');
				await expect(manager.getByRole('heading', { name: 'หน้าสรุปมื้อ' })).toBeVisible({
					timeout: 15_000
				});
				await manager.getByRole('link', { name: 'ฐานสูตร BOM' }).click();
				await expect(manager.getByRole('heading', { name: 'สูตรอาหารมาตรฐาน' })).toBeVisible({
					timeout: 15_000
				});
				await manager.getByRole('button', { name: 'เพิ่มสูตรอาหาร' }).click();
				const form = manager.getByRole('dialog');
				await expect(
					form.getByRole('heading', { name: 'เพิ่มสูตรอาหารมาตรฐาน (BOM)' })
				).toBeVisible();

				await form.getByLabel(/ชื่อสูตรอาหาร/).fill(RECIPE);
				await form.getByRole('button', { name: 'เพิ่ม', exact: true }).click();
				const searches = form.getByPlaceholder('ค้นหาชื่อวัตถุดิบ...');
				const quantities = form.getByRole('spinbutton');
				for (const [index, [name, qty]] of [
					[RICE, '1'],
					[CHICKEN, '0.5']
				].entries()) {
					await searches.nth(index).fill(name);
					await form.getByRole('button', { name: new RegExp(name) }).click();
					await expect(searches.nth(index)).toHaveValue(name);
					await quantities.nth(index).fill(qty);
				}
				await form.getByLabel(/ยอดกำลังผลิตมาตรฐาน/).fill(String(REGULAR_HEADCOUNT));
				await form.getByRole('button', { name: '+ เพิ่ม' }).click();
				await expect(toast(manager, `เพิ่มข้อมูล ${RECIPE} สำเร็จ`)).toBeVisible({
					timeout: 15_000
				});
			});

			await test.step('kitchen creates a meal session for two groups', async () => {
				await kitchen.goto('/back-office/kitchen');
				await openSidebar(kitchen, 'ครัวกลางและอาหาร');
				await kitchen.getByRole('button', { name: 'สร้างมื้อใหม่' }).click();
				const dialog = kitchen.getByRole('dialog', { name: 'สร้างรอบมื้ออาหารใหม่' });
				await dialog.getByLabel('ชื่อรอบมื้ออาหาร').fill(SESSION_NAME);
				for (const label of ['เจ้าหน้าที่/อาสา', 'อาหารอ่อน/ผู้สูงอายุ', 'ทารก/เด็กอ่อน']) {
					await numberUnder(dialog, label).fill('0');
				}
				await numberUnder(dialog, 'อาหารทั่วไป').fill(String(REGULAR_HEADCOUNT));
				await numberUnder(dialog, 'อาหารฮาลาล').fill(String(HALAL_HEADCOUNT));
				const total = REGULAR_HEADCOUNT + HALAL_HEADCOUNT;
				await expect(dialog.getByText(`รวม ${total} จาน`)).toBeVisible();
				await dialog.getByRole('button', { name: 'สร้างรอบมื้ออาหาร' }).click();
				await expect(toast(kitchen, 'สร้างรอบมื้ออาหารสำเร็จ')).toBeVisible({ timeout: 15_000 });
				const card = await findSessionCard(kitchen);
				await expect(card.getByText(`เป้าหมายรวม: ${total} คน`)).toBeVisible();
				await expectGroupProgress(card, REGULAR_LABEL, REGULAR_HEADCOUNT, 0, 'ยังไม่ครบ');
				await expectGroupProgress(card, HALAL_LABEL, HALAL_HEADCOUNT, 0, 'ยังไม่ครบ');
			});

			await test.step('kitchen adds batch A (ทั่วไป) and opens its ticket', async () => {
				await planBatch(kitchen, BATCH_A);
			});

			await test.step('kitchen adds batch B (ฮาลาล) to the same session and opens its ticket', async () => {
				await planBatch(kitchen, BATCH_B);
				expect(BATCH_B.ticketNo).not.toBe(BATCH_A.ticketNo);
				// Each batch is its own meal_plan with its own ticket (read back from CouchDB).
				const tickets = (await allDocuments(SHELTER_DB)).filter(
					(d) => d.type === 'requisition_ticket' && d.created_by === KITCHEN.name
				);
				expect(tickets.map((t) => t.ticket_no).sort()).toEqual(
					[BATCH_A.ticketNo, BATCH_B.ticketNo].sort()
				);
				expect(new Set(tickets.map((t) => t.meal_plan_id)).size).toBe(2);
				await openSidebar(kitchen, 'ครัวกลางและอาหาร');
				const card = await findSessionCard(kitchen);
				await expect(card.getByRole('tab', { name: /ชุดการผลิต & แผนอาหาร \(2\)/ })).toBeVisible();
				for (const batch of [BATCH_A, BATCH_B]) {
					const plan = planRow(card, batch);
					await expect(plan).toContainText(batch.label);
					await expect(plan).toContainText(`(เป้า ${batch.target} จาน)`);
					await expect(plan).toContainText('รอคลังอนุมัติ');
				}
			});

			await test.step('warehouse approves and dispatches both tickets', async () => {
				// Seeded 50 kg of rice; batch A's dispatch takes its share before B is approved.
				await approveBatch(warehouse, BATCH_A, RICE_STOCK);
				await approveBatch(warehouse, BATCH_B, RICE_STOCK - BATCH_A.target / REGULAR_HEADCOUNT);
			});

			await test.step('kitchen confirms receipt of both dispatches', async () => {
				await receiveIngredients(kitchen, BATCH_A);
				await receiveIngredients(kitchen, BATCH_B);
			});

			await test.step('batch A: cook, record, confirm into stock', async () => {
				await cookBatch(kitchen, BATCH_A);
				await receiveBatch(manager, BATCH_A);
			});

			await test.step('session stays in progress while batch B is not delivered', async () => {
				await kitchen.reload();
				const card = await findSessionCard(kitchen);
				await expect(planRow(card, BATCH_A)).toContainText('รับเข้าคลังแล้ว', { timeout: 15_000 });
				await expect(planRow(card, BATCH_B)).toContainText('วัตถุดิบพร้อมปรุง');
				await expectGroupProgress(
					card,
					REGULAR_LABEL,
					REGULAR_HEADCOUNT,
					BATCH_A.actualYield,
					'ครบแล้ว'
				);
				await expectGroupProgress(card, HALAL_LABEL, HALAL_HEADCOUNT, 0, 'ยังไม่ครบ');
				await expect(card.getByText('4/5 กลุ่มครบ')).toBeVisible();
				await expect(card.getByText('กำลังดำเนินการ')).toBeVisible();
			});

			await test.step('batch B: cook, record, confirm into stock', async () => {
				await cookBatch(kitchen, BATCH_B);
				await receiveBatch(manager, BATCH_B);
			});

			await test.step('kitchen sees both batches delivered and the meal completed', async () => {
				await kitchen.reload();
				const card = await findSessionCard(kitchen);
				for (const batch of [BATCH_A, BATCH_B]) {
					await expect(planRow(card, batch)).toContainText('รับเข้าคลังแล้ว', {
						timeout: 15_000
					});
				}
				await expectGroupProgress(
					card,
					REGULAR_LABEL,
					REGULAR_HEADCOUNT,
					BATCH_A.actualYield,
					'ครบแล้ว'
				);
				await expectGroupProgress(
					card,
					HALAL_LABEL,
					HALAL_HEADCOUNT,
					BATCH_B.actualYield,
					'ครบแล้ว'
				);
				await expect(card.getByText('5/5 กลุ่มครบ')).toBeVisible();
				await expect(card.getByText('เสร็จสิ้นแล้ว')).toBeVisible();
				await expect(card.getByRole('tab', { name: /สรุปบริการของมื้อนี้ \(2\)/ })).toBeVisible();
			});
		});
	}
);
