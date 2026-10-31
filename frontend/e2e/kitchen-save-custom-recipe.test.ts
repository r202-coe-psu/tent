/**
 * Production board "สร้างสูตรเอง" can save the hand-built ingredient list as a new recipe (#802)
 * against the real local CouchDB.
 *
 * A kitchen_staff-only user (no warehouse/manager role) ticks "บันทึกเป็นสูตรใหม่": the recipe takes
 * the menu label as its name and the batch portions as its standard portions, the meal plan points
 * at it, and it shows up in the BOM dropdown. Saving the same name again warns and still opens the
 * ticket.
 *
 * Fixtures: one SH001-local food item master and one meal_session in shelter_sh001, written
 * straight to CouchDB. Teardown deletes only documents this run created and ends with a zero-leak
 * check.
 */

import { expect, test, type BrowserContext, type Page } from '@playwright/test';
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
const RUN = `${LOCAL_RUN_ID}${ulid().slice(-4).toLowerCase()}`;
const TODAY = new Date().toISOString().slice(0, 10);

const KITCHEN: TestUser = {
	name: `e2e_kscr_ks_${RUN}`,
	password: 'Password1!',
	roles: ['shelter:SH001', 'kitchen_staff'],
	display_name: 'E2E Kitchen Save Custom Recipe'
};

const ownedIds = new Set<string>();
const contexts: BrowserContext[] = [];
let session = '';
let sessionId = '';
let ingredientId = '';

const INGREDIENT = `E2E ไก่สูตรเอง ${RUN}`;
const RECIPE = `E2E สูตรเองบันทึกใหม่ ${RUN}`;
const SESSION_NAME = `E2E มื้อสูตรเอง ${RUN}`;

function isOwned(doc: CouchDocument): boolean {
	return ownedIds.has(doc._id) || doc.created_by === KITCHEN.name;
}

function envelope(type: string, schemaV: number): CouchDocument {
	const id = `${type}:${ulid()}`;
	const now = new Date().toISOString();
	ownedIds.add(id);
	return {
		_id: id,
		type,
		schema_v: schemaV,
		shelter_code: 'SH001',
		created_at: now,
		updated_at: now,
		created_by: KITCHEN.name
	};
}

async function seedFixtures(): Promise<void> {
	const ingredient = {
		...envelope('item_master', 4),
		name: INGREDIENT,
		category: 'item_category:food',
		base_unit: 'kg',
		type_class: 'CONSUMABLE',
		conversions: [],
		distribution_type: 'recurring',
		dietary: []
	};
	await putDocument(SHELTER_DB, ingredient);
	ingredientId = ingredient._id;

	const sessionDoc = {
		...envelope('meal_session', 1),
		name: SESSION_NAME,
		date: TODAY,
		meal: 'lunch',
		status: 'active',
		target_headcount: { total: 10, halal: 0, infant: 0, soft_food: 0, regular: 10, volunteer: 0 }
	};
	await putDocument(SHELTER_DB, sessionDoc);
	sessionId = sessionDoc._id;
}

async function cleanupOwnedDocuments(): Promise<void> {
	const errors: unknown[] = [];
	for (let pass = 0; pass < 3; pass += 1) {
		const owned = (await allDocuments(SHELTER_DB)).filter(isOwned);
		if (owned.length === 0) break;
		const results = await Promise.allSettled(owned.map((doc) => deleteDocument(SHELTER_DB, doc)));
		for (const result of results) {
			if (result.status === 'rejected') errors.push(result.reason);
		}
	}
	try {
		await deleteCouchUser(KITCHEN.name);
	} catch (error) {
		errors.push(error);
	}
	if (errors.length > 0) {
		throw new AggregateError(errors, `Could not fully clean kitchen save-custom-recipe run ${RUN}`);
	}
}

async function openBoard(browserContext: BrowserContext): Promise<Page> {
	const page = await browserContext.newPage();
	await routeBrowserCouchThroughApp(page);
	await injectSession(page, KITCHEN, session);
	await page.goto(`/back-office/kitchen/production-board/${encodeURIComponent(sessionId)}`);
	await expect(page.getByRole('tab', { name: 'สร้างสูตรเอง' })).toBeVisible({ timeout: 20_000 });
	return page;
}

async function buildCustomBatch(page: Page, qty: string): Promise<void> {
	await page.getByRole('tab', { name: 'สร้างสูตรเอง' }).click();
	await page.getByRole('button', { name: 'เพิ่มวัตถุดิบ' }).click();
	await page.getByRole('combobox').filter({ hasText: '-- เลือกวัตถุดิบ --' }).click();
	await page.locator('[data-slot="command-item"]').filter({ hasText: INGREDIENT }).click();
	const addPanel = page.getByText('เพิ่มวัตถุดิบเข้าชุดการผลิต').locator('..');
	await addPanel.getByPlaceholder('0').fill(qty);
	await page.getByRole('button', { name: 'เพิ่มวัตถุดิบนี้' }).click();
	await expect(page.getByRole('cell', { name: INGREDIENT, exact: true })).toBeVisible();
}

function planRecipeId(plan: CouchDocument): unknown {
	return (plan.recipes as { recipe_id: string }[] | undefined)?.[0]?.recipe_id;
}

async function recipesLabelled(label: string): Promise<CouchDocument[]> {
	return (await allDocuments(SHELTER_DB)).filter((d) => d.type === 'recipe' && d.label === label);
}

async function mealPlansOfRun(): Promise<CouchDocument[]> {
	return (await allDocuments(SHELTER_DB)).filter(
		(d) => d.type === 'meal_plan' && d.meal_session_id === sessionId
	);
}

test.describe(
	'Kitchen — save a custom ingredient list as a new recipe (#802)',
	{ tag: ['@kitchen'] },
	() => {
		test.skip(!CAN_WRITE, READ_ONLY_REASON);
		test.describe.configure({ mode: 'serial' });
		test.setTimeout(90_000);

		test.beforeAll(async () => {
			await createCouchUser(KITCHEN);
			await seedSecurityQuestion(KITCHEN.name);
			session = await couchLogin(KITCHEN.name, KITCHEN.password);
			await seedFixtures();
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
			const leftovers = (await allDocuments(SHELTER_DB)).filter(isOwned).map((d) => d._id);
			expect(leftovers, 'zero-leak: no documents from this run remain').toEqual([]);
		});

		test('kitchen staff saves the custom list as a recipe named after the menu, at the batch portions', async ({
			browser
		}) => {
			const context = await browser.newContext();
			contexts.push(context);
			const page = await openBoard(context);

			await buildCustomBatch(page, '2');
			await page.getByRole('checkbox', { name: 'บันทึกเป็นสูตรใหม่' }).check();
			await page.getByLabel('ชื่อเมนูที่แสดง').fill(RECIPE);
			await page.getByRole('button', { name: 'สร้างใบเบิกวัตถุดิบ' }).click();

			await expect(page.getByText(`บันทึกสูตร "${RECIPE}" เรียบร้อยแล้ว`)).toBeVisible();
			await expect(page.getByText(/เปิดตั๋วเบิกวัตถุดิบ .+ แล้ว/)).toBeVisible();

			const recipes = await recipesLabelled(RECIPE);
			expect(recipes, 'exactly one recipe saved').toHaveLength(1);
			const [recipe] = recipes;
			expect(recipe.created_by).toBe(KITCHEN.name);
			expect(recipe.standard_portions, 'the batch portions').toBe('10');
			expect(recipe.ingredients, 'stored as cooked').toEqual([
				{ item_master_id: ingredientId, quantity: '2', uom: 'kg' }
			]);

			const plans = await mealPlansOfRun();
			expect(plans).toHaveLength(1);
			expect(plans[0].recipes).toEqual([{ recipe_id: recipe._id, planned_qty: 10 }]);

			const fresh = await openBoard(context);
			const recipeSelect = fresh
				.locator('select')
				.filter({ hasText: '-- เลือกสูตรอาหาร (BOM) --' });
			await expect(recipeSelect.locator(`option[value="${recipe._id}"]`)).toHaveCount(1);
		});

		test('a duplicate recipe name warns and still opens the ticket', async ({ browser }) => {
			const context = await browser.newContext();
			contexts.push(context);
			const page = await openBoard(context);

			await buildCustomBatch(page, '1');
			await page.getByRole('checkbox', { name: 'บันทึกเป็นสูตรใหม่' }).check();
			await page.getByLabel('ชื่อเมนูที่แสดง').fill(`  ${RECIPE.toUpperCase()}  `);
			await page.getByRole('button', { name: 'สร้างใบเบิกวัตถุดิบ' }).click();

			await expect(page.getByText(/จึงไม่บันทึกซ้ำ/)).toBeVisible();
			await expect(page.getByText(/เปิดตั๋วเบิกวัตถุดิบ .+ แล้ว/)).toBeVisible();

			const recipes = await recipesLabelled(RECIPE);
			expect(recipes, 'no second recipe written').toHaveLength(1);
			const plans = await mealPlansOfRun();
			expect(plans).toHaveLength(2);
			const custom = plans.filter((p) => planRecipeId(p) === 'recipe:custom');
			expect(custom, 'the duplicate run plans as a one-off custom recipe').toHaveLength(1);
		});

		test('a retry after the plan write fails links the recipe already saved', async ({
			browser
		}) => {
			const context = await browser.newContext();
			contexts.push(context);
			const page = await openBoard(context);
			const retryRecipe = `${RECIPE} retry`;
			let failNextPlanWrite = true;
			await page.route(
				(url) => url.pathname.includes('meal_plan'),
				async (route) => {
					if (failNextPlanWrite && route.request().method() === 'PUT') {
						failNextPlanWrite = false;
						await route.fulfill({
							status: 403,
							contentType: 'application/json',
							headers: {
								'access-control-allow-origin': new URL(page.url()).origin,
								'access-control-allow-credentials': 'true'
							},
							body: JSON.stringify({ error: 'forbidden', reason: 'e2e: plan write rejected' })
						});
						return;
					}
					await route.fallback();
				}
			);

			await buildCustomBatch(page, '1');
			await page.getByRole('checkbox', { name: 'บันทึกเป็นสูตรใหม่' }).check();
			await page.getByLabel('ชื่อเมนูที่แสดง').fill(retryRecipe);
			const submit = page.getByRole('button', { name: 'สร้างใบเบิกวัตถุดิบ' });
			await submit.click();
			await expect(page.getByText(`บันทึกสูตร "${retryRecipe}" เรียบร้อยแล้ว`)).toBeVisible();
			await expect(page.getByText('e2e: plan write rejected')).toBeVisible();

			await expect(submit).toBeEnabled();
			await submit.click();
			await expect(page.getByText(/เปิดตั๋วเบิกวัตถุดิบ .+ แล้ว/)).toBeVisible();
			await expect(page.getByText(/จึงไม่บันทึกซ้ำ/)).toHaveCount(0);

			const recipes = await recipesLabelled(retryRecipe);
			expect(recipes, 'the retry does not save a second recipe').toHaveLength(1);
			const linked = (await mealPlansOfRun()).filter((p) => planRecipeId(p) === recipes[0]._id);
			expect(linked, 'the retried plan links the saved recipe').toHaveLength(1);
		});

		test('switching to BOM mode and back clears the save-as-recipe choice', async ({ browser }) => {
			const context = await browser.newContext();
			contexts.push(context);
			const page = await openBoard(context);

			await page.getByRole('tab', { name: 'สร้างสูตรเอง' }).click();
			const checkbox = page.getByRole('checkbox', { name: 'บันทึกเป็นสูตรใหม่' });
			await checkbox.check();

			await page.getByRole('tab', { name: 'เลือกจากฐานสูตร (BOM)' }).click();
			await page.getByRole('tab', { name: 'สร้างสูตรเอง' }).click();

			await expect(checkbox).not.toBeChecked();
		});

		test('saving as a recipe without a menu name asks for one and writes nothing', async ({
			browser
		}) => {
			const context = await browser.newContext();
			contexts.push(context);
			const page = await openBoard(context);
			const plansBefore = (await mealPlansOfRun()).length;

			await buildCustomBatch(page, '1');
			await page.getByRole('checkbox', { name: 'บันทึกเป็นสูตรใหม่' }).check();
			await page.getByRole('button', { name: 'สร้างใบเบิกวัตถุดิบ' }).click();

			await expect(page.getByText('กรุณาระบุชื่อเมนูที่แสดง เพื่อใช้เป็นชื่อสูตร')).toBeVisible();
			expect(await mealPlansOfRun(), 'no plan opened').toHaveLength(plansBefore);
		});

		test('kitchen staff can add a recipe from the catalog page but not edit one', async ({
			browser
		}) => {
			const context = await browser.newContext();
			contexts.push(context);
			const page = await context.newPage();
			await routeBrowserCouchThroughApp(page);
			await injectSession(page, KITCHEN, session);
			await page.goto('/back-office/catalog?tab=recipe');
			await expect(page.getByRole('heading', { name: 'สูตรอาหารมาตรฐาน' })).toBeVisible({
				timeout: 20_000
			});

			await page.getByRole('button', { name: 'เพิ่มสูตรอาหาร' }).click();
			const sheet = page.getByRole('dialog');
			await expect(
				sheet.getByRole('heading', { name: 'เพิ่มสูตรอาหารมาตรฐาน (BOM)' })
			).toBeVisible();
			await expect(sheet.getByText('คุณไม่มีสิทธิ์เข้าถึงส่วนนี้')).toHaveCount(0);
			await page.keyboard.press('Escape');
			await expect(sheet).toHaveCount(0);

			await page.getByPlaceholder('ค้นหาชื่อสูตร / วัตถุดิบ').fill(RECIPE);
			await page
				.getByRole('row')
				.filter({ has: page.getByText(RECIPE, { exact: true }) })
				.click();
			await expect(sheet.getByText(RECIPE).first()).toBeVisible();
			await expect(sheet.getByRole('button', { name: 'แก้ไข' })).toHaveCount(0);
		});
	}
);
