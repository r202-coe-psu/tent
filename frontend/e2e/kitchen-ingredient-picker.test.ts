/**
 * Production board ingredient picker lists food only (#804) against the real local CouchDB.
 *
 * "เลือกวัตถุดิบ" must offer active food item masters and nothing else, while an ingredient that is
 * already in a recipe keeps its name in the batch table even when it is not food.
 *
 * Fixtures: SH001-local item masters and one recipe in shelter_sh001 (never the central catalog),
 * plus one meal_session, written straight to CouchDB. Teardown deletes only documents this run
 * created and ends with a zero-leak check.
 */

import { expect, test, type BrowserContext } from '@playwright/test';
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
const FOOD = 'item_category:food';
const RUN = `${LOCAL_RUN_ID}${ulid().slice(-4).toLowerCase()}`;
const TODAY = new Date().toISOString().slice(0, 10);

const KITCHEN: TestUser = {
	name: `e2e_kip_ks_${RUN}`,
	password: 'Password1!',
	roles: ['shelter:SH001', 'kitchen_staff'],
	display_name: 'E2E Kitchen Ingredient Picker'
};

const ownedIds = new Set<string>();
const contexts: BrowserContext[] = [];
let session = '';
let recipeId = '';
let sessionId = '';

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

function itemMaster(name: string, category: string, extra: Record<string, unknown> = {}) {
	return {
		...envelope('item_master', 4),
		name,
		category,
		base_unit: 'kg',
		type_class: 'CONSUMABLE',
		conversions: [],
		distribution_type: 'recurring',
		dietary: [],
		...extra
	};
}

const ACTIVE_FOOD = `E2E ผักทดสอบ ${RUN}`;
const LEGACY_FOOD = `E2E ถั่วชื่อหมวดเดิม ${RUN}`;
const DEACTIVATED_FOOD = `E2E น้ำมันเลิกใช้ ${RUN}`;
const MERGED_FOOD = `E2E ข้าวซ้ำ ${RUN}`;
const NON_FOOD = `E2E น้ำยาล้างจาน ${RUN}`;
const RECIPE = `E2E สูตรทดสอบวัตถุดิบ ${RUN}`;
const SESSION_NAME = `E2E มื้อทดสอบวัตถุดิบ ${RUN}`;

async function seedFixtures(): Promise<void> {
	const activeFood = itemMaster(ACTIVE_FOOD, FOOD);
	const nonFood = itemMaster(NON_FOOD, 'item_category:wash');
	const docs = [
		activeFood,
		nonFood,
		itemMaster(LEGACY_FOOD, 'อาหารและวัตถุดิบ'),
		itemMaster(DEACTIVATED_FOOD, FOOD, { deactivated: true }),
		itemMaster(MERGED_FOOD, FOOD, { merged_into: activeFood._id })
	];
	for (const doc of docs) await putDocument(SHELTER_DB, doc);

	const recipe = {
		...envelope('recipe', 4),
		label: RECIPE,
		standard_portions: '1',
		standard_duration_hours: '1',
		ingredients: [
			{ item_master_id: activeFood._id, quantity: '0.1', uom: 'kg' },
			{ item_master_id: nonFood._id, quantity: '0.01', uom: 'kg' }
		]
	};
	await putDocument(SHELTER_DB, recipe);
	recipeId = recipe._id;

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
		throw new AggregateError(errors, `Could not fully clean kitchen ingredient-picker run ${RUN}`);
	}
}

test.describe(
	'Kitchen — production board ingredient picker lists food only (#804)',
	{ tag: ['@critical', '@kitchen'] },
	() => {
		test.skip(!CAN_WRITE, READ_ONLY_REASON);
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

		test('picker offers active food only; a non-food recipe ingredient keeps its row', async ({
			browser
		}) => {
			const seededNonFood = (await allDocuments(CATALOG_DB))
				.filter(
					(d) =>
						d.type === 'item_master' &&
						!d.shelter_code &&
						typeof d.category === 'string' &&
						d.category.startsWith('item_category:') &&
						d.category !== FOOD
				)
				.map((d) => String(d.name));
			expect(seededNonFood.length, 'central catalog has non-food masters to leak').toBeGreaterThan(
				0
			);

			const context = await browser.newContext();
			contexts.push(context);
			const page = await context.newPage();
			await routeBrowserCouchThroughApp(page);
			await injectSession(page, KITCHEN, session);
			await page.goto(`/back-office/kitchen/production-board/${encodeURIComponent(sessionId)}`);

			const recipeSelect = page.locator('select').filter({ hasText: '-- เลือกสูตรอาหาร (BOM) --' });
			await expect(recipeSelect.locator(`option[value="${recipeId}"]`)).toHaveCount(1, {
				timeout: 20_000
			});
			await recipeSelect.selectOption(recipeId);

			const batchTable = page.getByRole('table').filter({ hasText: ACTIVE_FOOD });
			await expect(batchTable.getByRole('cell', { name: ACTIVE_FOOD, exact: true })).toBeVisible();
			await expect(batchTable.getByRole('cell', { name: NON_FOOD, exact: true })).toBeVisible();

			await page.getByRole('button', { name: 'เพิ่มวัตถุดิบ' }).click();
			await page.getByRole('combobox').filter({ hasText: '-- เลือกวัตถุดิบ --' }).click();
			const options = page.locator('[data-slot="command-item"]');
			await expect(options.filter({ hasText: ACTIVE_FOOD })).toHaveCount(1);

			const names = (await options.allInnerTexts()).map((label) =>
				label.trim().replace(/\s*\([^)]*\)$/, '')
			);
			expect(names, 'legacy Thai category name still counts as food').toContain(LEGACY_FOOD);
			expect(names, 'deactivated food is hidden').not.toContain(DEACTIVATED_FOOD);
			expect(names, 'merged food is hidden').not.toContain(MERGED_FOOD);
			expect(names, 'shelter-local non-food is hidden').not.toContain(NON_FOOD);
			expect(
				names.filter((name) => seededNonFood.includes(name)),
				'no central non-food master is offered'
			).toEqual([]);
		});
	}
);
