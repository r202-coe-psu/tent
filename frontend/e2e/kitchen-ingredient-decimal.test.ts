/**
 * Kitchen production board ingredient quantities stay exact decimals (#794) against the real
 * local CouchDB.
 *
 * The BOM table on "แผงควบคุมและจัดสรรเครื่องครัวภัยพิบัติ" scales each recipe line to the plate
 * target. It used to round to 2 dp with floats (0.125 became 0.13, 1/3 became 0.33) and merge a
 * repeated item with the same float math. Quantities are now decimal strings at 4 dp, and an
 * emptied quantity box is rejected with a toast instead of crashing the submit.
 *
 * Fixtures: one recipe (3 standard portions) over two item masters in the catalog and one
 * meal_session with 1 regular plate. Nothing here opens a ticket. Teardown deletes only documents
 * this run created and ends with a zero-leak check.
 */

import {
	expect,
	test,
	type Browser,
	type BrowserContext,
	type Locator,
	type Page,
	type Route
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
const TODAY = new Date().toISOString().slice(0, 10);

const KITCHEN: TestUser = {
	name: `e2e_kid_ks_${RUN}`,
	password: 'Password1!',
	roles: ['shelter:SH001', 'kitchen_staff'],
	display_name: 'E2E Kitchen Ingredient Decimal'
};

const EIGHTH = `E2E เกลือ ${RUN}`;
const THIRD = `E2E น้ำมัน ${RUN}`;
const TENTH = `E2E พริก ${RUN}`;
const RECIPE = `E2E สูตรทศนิยม ${RUN}`;
const SESSION_NAME = `E2E มื้อทศนิยม ${RUN}`;

const ownedIds = new Set<string>();
const contexts: BrowserContext[] = [];
let session = '';
let sessionId = '';
let recipeId = '';

function isOwned(doc: CouchDocument): boolean {
	return ownedIds.has(doc._id) || doc.created_by === KITCHEN.name;
}

function envelope(type: string, schemaV: number, extra: Record<string, unknown> = {}) {
	const id = `${type}:${ulid()}`;
	const now = new Date().toISOString();
	ownedIds.add(id);
	return {
		_id: id,
		type,
		schema_v: schemaV,
		created_at: now,
		updated_at: now,
		created_by: KITCHEN.name,
		...extra
	};
}

async function seedItemMaster(name: string): Promise<string> {
	const doc = envelope('item_master', 4, {
		name,
		category: 'item_category:food',
		sku: `e2e-kid-${RUN}`,
		base_unit: 'kg',
		conversions: [],
		default_inventory_uom: 'kg',
		default_issue_uom: 'kg',
		distribution_type: 'recurring',
		type_class: 'CONSUMABLE',
		deactivated: false,
		dietary: [],
		returnable: false
	});
	await putDocument(CATALOG_DB, doc);
	return doc._id;
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
	try {
		await deleteCouchUser(KITCHEN.name);
	} catch (error) {
		errors.push(error);
	}
	if (errors.length > 0) {
		throw new AggregateError(errors, `Could not fully clean kitchen decimal run ${RUN}`);
	}
}

function toast(page: Page, text: string | RegExp) {
	return page.locator('[data-sonner-toast]').filter({ hasText: text });
}

/** The production board for the seeded session with the E2E recipe selected. */
async function openBoardWithRecipe(browser: Browser): Promise<{
	page: Page;
	target: Locator;
	bom: Locator;
}> {
	const context = await browser.newContext();
	contexts.push(context);
	const page = await context.newPage();
	await routeBrowserCouchThroughApp(page);
	await injectSession(page, KITCHEN, session);
	await page.goto(`/back-office/kitchen/production-board/${sessionId}`);
	await expect(
		page.getByRole('heading', { name: 'แผงควบคุมและจัดสรรเครื่องครัวภัยพิบัติ' })
	).toBeVisible({ timeout: 15_000 });

	const recipeSelect = page.locator('select');
	const option = recipeSelect.locator('option', { hasText: RECIPE });
	await expect(option).toHaveCount(1, { timeout: 15_000 });
	await recipeSelect.selectOption((await option.getAttribute('value')) ?? '');

	const target = page
		.locator('[data-slot="card"]')
		.filter({ hasText: '1. เมนูและกลุ่มเป้าหมาย' })
		.getByRole('spinbutton');
	await expect(target).toHaveValue('1');
	const bom = page.locator('[data-slot="card"]').filter({
		hasText: '2. คำนวณวัตถุดิบ & สต็อกในคลัง'
	});
	return { page, target, bom };
}

function qtyInput(bom: Locator, item: string): Locator {
	return bom.getByRole('row').filter({ hasText: item }).getByRole('spinbutton');
}

test.describe(
	'Kitchen — production board ingredient quantities stay exact decimals (#794)',
	{ tag: ['@kitchen'] },
	() => {
		test.skip(!CAN_WRITE, READ_ONLY_REASON);
		test.setTimeout(90_000);

		test.beforeAll(async () => {
			await createCouchUser(KITCHEN);
			await seedSecurityQuestion(KITCHEN.name);
			session = await couchLogin(KITCHEN.name, KITCHEN.password);

			const eighthId = await seedItemMaster(EIGHTH);
			const thirdId = await seedItemMaster(THIRD);
			const tenthId = await seedItemMaster(TENTH);

			// 3 standard portions: 0.375 -> 0.125 per plate, 1 -> one third per plate, 0.3 -> 0.1 per plate.
			const recipe = envelope('recipe', 4, {
				label: RECIPE,
				ingredients: [
					{ item_master_id: eighthId, quantity: '0.375', uom: 'kg' },
					{ item_master_id: thirdId, quantity: '1', uom: 'kg' },
					{ item_master_id: tenthId, quantity: '0.3', uom: 'kg' }
				],
				standard_portions: '3',
				standard_duration_hours: '1',
				deactivated: false
			});
			await putDocument(CATALOG_DB, recipe);
			recipeId = recipe._id;

			const sessionDoc = envelope('meal_session', 1, {
				shelter_code: 'SH001',
				name: SESSION_NAME,
				date: TODAY,
				meal: 'lunch',
				status: 'active',
				target_headcount: { halal: 0, infant: 0, soft_food: 0, regular: 1, volunteer: 0, total: 1 }
			});
			await putDocument(SHELTER_DB, sessionDoc);
			sessionId = sessionDoc._id;
		});

		test.afterEach(async () => {
			await Promise.all(
				contexts.splice(0).map(async (context) => {
					for (const page of context.pages()) await page.unrouteAll({ behavior: 'ignoreErrors' });
					await context.close();
				})
			);
		});

		test.afterAll(async () => {
			await cleanupOwnedDocuments();
			const leftovers = [...(await allDocuments(SHELTER_DB)), ...(await allDocuments(CATALOG_DB))]
				.filter(isOwned)
				.map((d) => d._id);
			expect(leftovers, 'zero-leak: no documents from this run remain').toEqual([]);
		});

		test('recipe quantities scale to exact decimals, not 2 dp floats', async ({ browser }) => {
			expect(recipeId).toMatch(/^recipe:/);
			const { target, bom } = await openBoardWithRecipe(browser);

			await expect(qtyInput(bom, EIGHTH)).toHaveValue('0.125', { timeout: 15_000 });
			await expect(qtyInput(bom, THIRD)).toHaveValue('0.3333');
			await expect(qtyInput(bom, TENTH)).toHaveValue('0.1');

			await target.fill('3');
			await expect(qtyInput(bom, TENTH)).toHaveValue('0.3');

			await target.fill('7');
			await expect(qtyInput(bom, EIGHTH)).toHaveValue('0.875');
			await expect(qtyInput(bom, THIRD)).toHaveValue('2.3333');
			await expect(qtyInput(bom, TENTH)).toHaveValue('0.7');
		});

		test('adding an item already in the table merges to an exact decimal sum', async ({
			browser
		}) => {
			const { page, bom } = await openBoardWithRecipe(browser);
			await expect(qtyInput(bom, EIGHTH)).toHaveValue('0.125', { timeout: 15_000 });

			await bom.getByRole('button', { name: 'เพิ่มวัตถุดิบ', exact: true }).click();
			await bom.getByRole('combobox').click();
			await page.getByPlaceholder('ค้นหาวัตถุดิบ...').fill(EIGHTH);
			await page.getByRole('option', { name: new RegExp(EIGHTH) }).click();
			await bom.getByPlaceholder('0').fill('0.0625');
			await bom.getByRole('button', { name: 'เพิ่มวัตถุดิบนี้' }).click();

			await expect(toast(page, `เพิ่ม ${EIGHTH} เรียบร้อยแล้ว`)).toBeVisible();
			await expect(bom.getByRole('row').filter({ hasText: EIGHTH })).toHaveCount(1);
			await expect(qtyInput(bom, EIGHTH)).toHaveValue('0.1875');
			await expect(qtyInput(bom, THIRD)).toHaveValue('0.3333');
		});

		test('an emptied quantity box is rejected with a toast and opens no ticket', async ({
			browser
		}) => {
			const { page, bom } = await openBoardWithRecipe(browser);
			const pageErrors: string[] = [];
			page.on('pageerror', (e) => pageErrors.push(e.message));
			await expect(qtyInput(bom, EIGHTH)).toBeVisible({ timeout: 15_000 });

			await qtyInput(bom, EIGHTH).clear();
			await page.getByRole('button', { name: 'สร้างใบเบิกวัตถุดิบ' }).click();

			await expect(toast(page, 'กรุณาระบุจำนวนวัตถุดิบให้มากกว่า 0 ทุกรายการ')).toBeVisible();
			await expect(page.getByRole('button', { name: 'สร้างใบเบิกวัตถุดิบ' })).toBeEnabled();
			const tickets = (await allDocuments(SHELTER_DB)).filter(
				(d) => d.type === 'requisition_ticket' && d.created_by === KITCHEN.name
			);
			expect(tickets, 'no requisition ticket was written').toEqual([]);
			expect(pageErrors, 'an emptied box throws nothing while rendering its row').toEqual([]);
		});

		async function createTicketWithEditedQty(browser: Browser): Promise<string> {
			const { page, bom } = await openBoardWithRecipe(browser);
			await expect(qtyInput(bom, EIGHTH)).toHaveValue('0.125', { timeout: 15_000 });
			await qtyInput(bom, EIGHTH).fill('0.1875');
			await page.getByRole('button', { name: 'สร้างใบเบิกวัตถุดิบ' }).click();
			await expect(toast(page, /เปิดตั๋วเบิกวัตถุดิบ .+ แล้ว/)).toBeVisible();

			const ticket = (await allDocuments(SHELTER_DB)).find(
				(d) => d.type === 'requisition_ticket' && d.created_by === KITCHEN.name
			);
			expect(ticket, 'the requisition ticket was written').toBeTruthy();
			return String(ticket!.meal_plan_id);
		}

		async function reopenPlan(
			browser: Browser,
			planId: string,
			onTicketsRequest: (route: Route) => Promise<void>
		) {
			const context = await browser.newContext();
			contexts.push(context);
			const page = await context.newPage();
			await routeBrowserCouchThroughApp(page);
			await page.route('**/_all_docs*', async (route) => {
				if (decodeURIComponent(route.request().url()).includes('requisition_ticket:')) {
					return onTicketsRequest(route);
				}
				await route.fallback();
			});
			await injectSession(page, KITCHEN, session);
			await page.goto(
				`/back-office/kitchen/production-board/${sessionId}?plan_id=${encodeURIComponent(planId)}`
			);
			const bom = page.locator('[data-slot="card"]').filter({
				hasText: '2. คำนวณวัตถุดิบ & สต็อกในคลัง'
			});
			return { page, bom };
		}

		test('reopening a plan shows the saved ticket quantities, not the recipe', async ({
			browser
		}) => {
			const planId = await createTicketWithEditedQty(browser);

			const { bom } = await reopenPlan(browser, planId, async (route) => {
				await new Promise((resolve) => setTimeout(resolve, 2_000));
				await route.fallback();
			});

			await expect(qtyInput(bom, EIGHTH)).toHaveValue('0.1875', { timeout: 15_000 });
			await expect(qtyInput(bom, THIRD)).toHaveValue('0.3333');
		});

		test('a failed ticket load offers retry and never a second ticket', async ({ browser }) => {
			const planId = await createTicketWithEditedQty(browser);

			const { page } = await reopenPlan(browser, planId, (route) => route.abort());

			await expect(page.getByText('โหลดข้อมูลใบเบิกไม่สำเร็จ')).toBeVisible({ timeout: 30_000 });
			await expect(page.getByRole('button', { name: 'ลองใหม่' })).toBeVisible();
			await expect(page.getByRole('button', { name: 'สร้างใบเบิกวัตถุดิบ' })).toHaveCount(0);
		});
	}
);
