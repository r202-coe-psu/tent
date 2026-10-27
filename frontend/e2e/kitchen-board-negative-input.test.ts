/**
 * Kitchen number boxes cannot take a negative value, and say so inline (#803), against the real
 * local CouchDB.
 *
 * Every numeric box this fix covers must refuse a typed minus (no minus lands in the box), refuse a
 * pasted "-5" (the box keeps its value) and clamp a programmatically set negative to 0, each time
 * with an inline "ไม่รับค่าติดลบ" note that clears on the next accepted edit. The value-must-be-above-0
 * rules stay: a target below 1, an ingredient quantity of 0 and an emptied count still show their
 * error and disable their button. Covered: stage A target, ingredient table, add-ingredient
 * quantity, the five stage C service fields and the five group targets in the new-meal dialog.
 *
 * Fixtures: one meal_session, one recipe (catalog) and one cooking meal_plan with no ticket,
 * the legacy path that unlocks stage C without running the requisition flow (covered by
 * kitchen-meal.test.ts). Nothing is submitted. Teardown deletes only documents this run created
 * and ends with a zero-leak check.
 */

import { expect, test, type Locator, type Page } from '@playwright/test';
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
	name: `e2e_kbn_ks_${RUN}`,
	password: 'Password1!',
	roles: ['shelter:SH001', 'kitchen_staff'],
	display_name: 'E2E Kitchen Negative Input'
};

const RECIPE_LABEL = `E2E ข้าวต้ม ${RUN}`;
const TARGET_ERROR = 'จำนวนจานต้องมากกว่า 0';
const SERVICE_ERROR = 'ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป';
const NEGATIVE_NOTE = 'ไม่รับค่าติดลบ';
const QTY_ERROR = 'จำนวนต้องมากกว่า 0';
const ADD_INGREDIENT = 'เพิ่มวัตถุดิบนี้';
const CREATE_SESSION = 'สร้างรอบมื้ออาหาร';
const CREATE_REQUISITION = 'สร้างใบเบิกวัตถุดิบ';
const RECORD_SERVICE = 'บันทึกผลการผลิต';

const SERVICE_FIELDS = [
	'จำนวนจานปรุงได้จริง',
	'แจกจ่ายในศูนย์',
	'อาหารเหลือทิ้ง',
	'แจกอาสาสมัคร/เจ้าหน้าที่',
	'แจกผู้พักพิงภายนอก'
];

const SESSION_FIELDS = [
	'อาหารทั่วไป',
	'เจ้าหน้าที่/อาสา',
	'อาหารฮาลาล',
	'อาหารอ่อน/ผู้สูงอายุ',
	'ทารก/เด็กอ่อน'
];

type NegativeMode = 'key' | 'paste' | 'fill';
const NEGATIVE_MODES: NegativeMode[] = ['key', 'paste', 'fill'];

const ownedIds = new Set<string>();
let authSession = '';
let sessionId = '';
let planId = '';

function isOwned(doc: CouchDocument): boolean {
	return ownedIds.has(doc._id) || doc.created_by === KITCHEN.name;
}

function envelope(type: string, schemaV: number, extra: Record<string, unknown>): CouchDocument {
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

async function seedBoard(): Promise<void> {
	const item = envelope('item_master', 4, {
		name: `E2E ข้าวสาร ${RUN}`,
		category: 'item_category:food',
		sku: `e2e-kbn-${RUN}`,
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
	await putDocument(CATALOG_DB, item);
	await putDocument(
		CATALOG_DB,
		envelope('recipe', 4, {
			label: RECIPE_LABEL,
			ingredients: [{ item_master_id: item._id, quantity: '1', uom: 'kg' }],
			standard_portions: '10',
			standard_duration_hours: '1',
			deactivated: false
		})
	);

	const shelterFields = { shelter_code: 'SH001' };
	const session = envelope('meal_session', 1, {
		...shelterFields,
		name: `E2E มื้อกรอกตัวเลข ${RUN}`,
		date: TODAY,
		meal: 'lunch',
		status: 'active',
		target_headcount: { halal: 0, infant: 0, soft_food: 0, regular: 20, volunteer: 0, total: 20 }
	});
	await putDocument(SHELTER_DB, session);
	sessionId = session._id;

	const plan = envelope('meal_plan', 2, {
		...shelterFields,
		date: TODAY,
		meal: 'lunch',
		label: `E2E เมนูกำลังปรุง ${RUN}`,
		headcount: { total: 20, halal: 0, soft_food: 0, infant: 0 },
		recipes: [],
		status: 'confirmed',
		meal_session_id: session._id,
		target_tags: ['regular'],
		allocated_target: 20,
		cooking_started_at: new Date().toISOString()
	});
	await putDocument(SHELTER_DB, plan);
	planId = plan._id;
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
		throw new AggregateError(errors, `Could not fully clean kitchen negative-input run ${RUN}`);
	}
}

/** Replaces the field's content with a real clipboard paste (Ctrl+V). */
async function pasteOver(page: Page, input: Locator, text: string): Promise<void> {
	await input.focus();
	await page.keyboard.press('Control+A');
	await page.evaluate((value) => navigator.clipboard.writeText(value), text);
	await page.keyboard.press('Control+V');
}

/**
 * Tries to put a negative number in the box by typing a minus, pasting "-5" or setting the value
 * programmatically. Leaves the inline note on screen and the box non-negative: typing and pasting
 * leave it as it was, setting it clamps to 0.
 */
async function enterNegative(page: Page, input: Locator, mode: NegativeMode): Promise<void> {
	const note = page.getByRole('alert').filter({ hasText: NEGATIVE_NOTE });
	const before = await input.inputValue();
	if (mode === 'key') {
		await input.focus();
		await page.keyboard.press('Control+A');
		await page.keyboard.press('-');
		await expect(input).toHaveValue(before);
	} else if (mode === 'paste') {
		await pasteOver(page, input, '-5');
		await expect(input).toHaveValue(before);
	} else {
		await input.fill('-5');
		await expect(input).toHaveValue('0');
	}
	await expect(note).toHaveCount(1);
	await expect(input).not.toHaveValue(/-/);
}

async function openBoard(page: Page, query = ''): Promise<void> {
	await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
	await routeBrowserCouchThroughApp(page);
	await injectSession(page, KITCHEN, authSession);
	await page.goto(`/back-office/kitchen/production-board/${encodeURIComponent(sessionId)}${query}`);
}

function numberUnderLabel(page: Page, label: string): Locator {
	return page
		.locator('label')
		.filter({ hasText: label })
		.locator('xpath=following-sibling::input[@type="number"]');
}

test.describe(
	'Kitchen — production board rejects negative counts (#803)',
	{ tag: ['@kitchen'] },
	() => {
		test.skip(!CAN_WRITE, READ_ONLY_REASON);
		test.setTimeout(90_000);

		test.beforeAll(async () => {
			await createCouchUser(KITCHEN);
			await seedSecurityQuestion(KITCHEN.name);
			authSession = await couchLogin(KITCHEN.name, KITCHEN.password);
			await seedBoard();
		});

		test.afterAll(async () => {
			await cleanupOwnedDocuments();
			const leftovers = (await allDocuments(SHELTER_DB))
				.concat(await allDocuments(CATALOG_DB))
				.filter(isOwned)
				.map((d) => d._id);
			expect(leftovers, 'zero-leak: no documents from this run remain').toEqual([]);
		});

		test('stage A target refuses a typed minus and clamps a negative to an error-flagged 0', async ({
			page
		}) => {
			await openBoard(page);
			const target = page.locator('input[type="number"][min="1"]').first();
			const create = page.getByRole('button', { name: CREATE_REQUISITION });
			const error = page.getByRole('alert').filter({ hasText: TARGET_ERROR });
			const note = page.getByRole('alert').filter({ hasText: NEGATIVE_NOTE });
			const ingredientAmounts = page.locator('table input[type="number"]');

			await expect(target).toBeVisible({ timeout: 20_000 });
			const recipe = page.locator('select').first();
			await expect(recipe.locator('option', { hasText: RECIPE_LABEL })).toHaveCount(1, {
				timeout: 20_000
			});

			await target.fill('');
			await target.focus();
			await page.keyboard.press('-');
			await expect(target).toHaveValue('');
			await expect(note).toHaveCount(1);
			await page.keyboard.press('5');
			await expect(target).toHaveValue('5');
			await expect(note).toHaveCount(0);

			await pasteOver(page, target, '-5');
			await expect(target).toHaveValue('5');
			await expect(note).toHaveCount(1);

			await target.fill('-5');
			await expect(target).toHaveValue('0');
			await recipe.selectOption({ label: `${RECIPE_LABEL} (สูตรฐาน 10 จาน)` });
			await expect(ingredientAmounts.first()).toBeVisible();
			const amounts = await ingredientAmounts.evaluateAll((els) =>
				els.map((el) => Number((el as HTMLInputElement).value))
			);
			expect(amounts.length).toBeGreaterThan(0);
			expect(
				amounts.filter((n) => n < 0),
				'no ingredient amount is negative'
			).toEqual([]);
			await expect(note).toHaveCount(1);
			await expect(error).toHaveCount(1);
			await expect(create).toBeDisabled();

			await target.fill('10');
			await expect(note).toHaveCount(0);
			await expect(error).toHaveCount(0);
			await expect(create).toBeEnabled();
		});

		test('stage A target below 1 stays an error and blocks the requisition', async ({ page }) => {
			await openBoard(page);
			const target = page.locator('input[type="number"][min="1"]').first();
			const create = page.getByRole('button', { name: CREATE_REQUISITION });
			const error = page.getByRole('alert').filter({ hasText: TARGET_ERROR });

			await expect(target).toBeVisible({ timeout: 20_000 });
			for (const bad of ['0', '']) {
				await target.fill(bad);
				await expect(error).toHaveCount(1);
				await expect(create).toBeDisabled();
			}
			await target.fill('10');
			await expect(error).toHaveCount(0);
			await expect(create).toBeEnabled();
		});

		test('stage C count fields refuse every way of entering a negative', async ({ page }) => {
			await openBoard(page, `?plan_id=${encodeURIComponent(planId)}&stage=C`);
			const save = page.getByRole('button', { name: RECORD_SERVICE });
			const errors = page.getByRole('alert').filter({ hasText: SERVICE_ERROR });

			await expect(numberUnderLabel(page, SERVICE_FIELDS[0])).toBeVisible({ timeout: 20_000 });
			await expect(save).toBeEnabled();

			for (const label of SERVICE_FIELDS) {
				for (const mode of NEGATIVE_MODES) {
					await test.step(`${label} (${mode})`, async () => {
						const input = numberUnderLabel(page, label);
						const original = await input.inputValue();

						await enterNegative(page, input, mode);
						await expect(errors).toHaveCount(0);
						await expect(save).toBeEnabled();

						await input.fill(original);
						await expect(page.getByRole('alert').filter({ hasText: NEGATIVE_NOTE })).toHaveCount(0);
					});
				}
			}
		});

		test('stage C emptied count still shows its error and blocks saving', async ({ page }) => {
			await openBoard(page, `?plan_id=${encodeURIComponent(planId)}&stage=C`);
			const save = page.getByRole('button', { name: RECORD_SERVICE });
			const errors = page.getByRole('alert').filter({ hasText: SERVICE_ERROR });

			await expect(numberUnderLabel(page, SERVICE_FIELDS[0])).toBeVisible({ timeout: 20_000 });
			for (const label of SERVICE_FIELDS.slice(0, 3)) {
				const input = numberUnderLabel(page, label);
				const original = await input.inputValue();
				await input.fill('');
				await expect(errors).toHaveCount(1);
				await expect(save).toBeDisabled();
				await input.fill(original);
				await expect(errors).toHaveCount(0);
				await expect(save).toBeEnabled();
			}
		});

		test('ingredient table refuses negatives and flags a quantity of 0', async ({ page }) => {
			await openBoard(page);
			const recipe = page.locator('select').first();
			const create = page.getByRole('button', { name: CREATE_REQUISITION });
			const errors = page.getByRole('alert').filter({ hasText: QTY_ERROR });
			const amount = page.locator('table input[type="number"]').first();

			await expect(recipe.locator('option', { hasText: RECIPE_LABEL })).toHaveCount(1, {
				timeout: 20_000
			});
			await recipe.selectOption({ label: `${RECIPE_LABEL} (สูตรฐาน 10 จาน)` });
			await expect(amount).toBeVisible();
			await expect(errors).toHaveCount(0);
			await expect(create).toBeEnabled();

			for (const mode of NEGATIVE_MODES) {
				await test.step(`negative (${mode})`, async () => {
					await enterNegative(page, amount, mode);
					await amount.fill('2.5');
					await expect(errors).toHaveCount(0);
					await expect(create).toBeEnabled();
				});
			}

			await test.step('clamped 0 is flagged and blocks the requisition', async () => {
				await amount.fill('-5');
				await expect(amount).toHaveValue('0');
				await expect(errors).toHaveCount(1);
				await expect(create).toBeDisabled();
				await expect(page.getByRole('button', { name: 'บันทึกการแก้ไข' })).toHaveCount(0);
			});

			await test.step('typed or pasted 0 is flagged too', async () => {
				await amount.fill('2.5');
				await pasteOver(page, amount, '0');
				await expect(amount).toHaveValue('0');
				await expect(errors).toHaveCount(1);
				await expect(create).toBeDisabled();
			});

			await test.step('a pasted unsigned decimal is accepted', async () => {
				await pasteOver(page, amount, '3.5');
				await expect(amount).toHaveValue('3.5');
				await expect(errors).toHaveCount(0);
				await expect(page.getByRole('alert').filter({ hasText: NEGATIVE_NOTE })).toHaveCount(0);
				await expect(create).toBeEnabled();
			});
		});

		test('add-ingredient quantity refuses negatives and flags 0', async ({ page }) => {
			await openBoard(page);
			const add = page.getByRole('button', { name: ADD_INGREDIENT });
			const errors = page.getByRole('alert').filter({ hasText: QTY_ERROR });
			const qty = page.locator('input[type="number"][placeholder="0"]');

			await expect(page.getByRole('button', { name: 'เพิ่มวัตถุดิบ', exact: true })).toBeVisible({
				timeout: 20_000
			});
			await page.getByRole('button', { name: 'เพิ่มวัตถุดิบ', exact: true }).click();
			await page.getByRole('combobox').filter({ hasText: 'เลือกวัตถุดิบ' }).click();
			await page.getByRole('option', { name: new RegExp(`E2E ข้าวสาร ${RUN}`) }).click();
			await expect(qty).toHaveValue('1');
			await expect(errors).toHaveCount(0);
			await expect(add).toBeEnabled();

			for (const mode of NEGATIVE_MODES) {
				await test.step(`negative (${mode})`, async () => {
					await enterNegative(page, qty, mode);
					await qty.fill('1.5');
					await expect(errors).toHaveCount(0);
					await expect(add).toBeEnabled();
				});
			}

			await test.step('clamped 0 is flagged and blocks adding', async () => {
				await qty.fill('-4');
				await expect(qty).toHaveValue('0');
				await expect(errors).toHaveCount(1);
				await expect(add).toBeDisabled();
				await pasteOver(page, qty, '1.5');
				await expect(errors).toHaveCount(0);
				await expect(add).toBeEnabled();
			});
		});

		test('new-meal dialog group targets refuse every way of entering a negative', async ({
			page
		}) => {
			await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
			await routeBrowserCouchThroughApp(page);
			await injectSession(page, KITCHEN, authSession);
			await page.goto('/back-office/kitchen');
			await page.getByRole('button', { name: 'สร้างมื้อใหม่' }).first().click();

			const create = page.getByRole('button', { name: CREATE_SESSION });
			const errors = page.getByRole('alert').filter({ hasText: SERVICE_ERROR });
			await expect(numberUnderLabel(page, SESSION_FIELDS[0])).toBeVisible({
				timeout: 20_000
			});

			for (const label of SESSION_FIELDS) {
				const input = numberUnderLabel(page, label);
				for (const mode of NEGATIVE_MODES) {
					await test.step(`${label} (${mode})`, async () => {
						await input.fill('4');
						await expect(errors).toHaveCount(0);
						await expect(create).toBeEnabled();

						await enterNegative(page, input, mode);
						await expect(errors).toHaveCount(0);
						await expect(create).toBeEnabled();

						await input.fill('4');
						await expect(page.getByRole('alert').filter({ hasText: NEGATIVE_NOTE })).toHaveCount(0);
					});
				}
			}
		});
	}
);
