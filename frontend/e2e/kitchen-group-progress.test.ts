/**
 * Kitchen meal-session group targets (#770) against the real local CouchDB.
 *
 * The "เป้าหมายตามกลุ่มความต้องการ" table on ครัวกลางและอาหาร splits each menu's recorded yield
 * across its tagged groups by priority fill — one plate counts for one group only, narrow-tagged
 * menus fill first, leftovers show as "เกิน" — and groups with no target collapse into one grey
 * "ไม่มีเป้าหมาย" row that the summary badge does not count.
 *
 * Fixtures: one meal_session per scenario with its meal_plan + meal_service rows, written straight
 * to CouchDB (the batch → requisition → cook flow that normally writes them is covered by
 * kitchen-meal.test.ts). Teardown deletes only documents this run created and ends with a
 * zero-leak check.
 */

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
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
	name: `e2e_kgp_ks_${RUN}`,
	password: 'Password1!',
	roles: ['shelter:SH001', 'kitchen_staff'],
	display_name: 'E2E Kitchen Group Progress'
};

type Group = 'halal' | 'infant' | 'soft_food' | 'regular' | 'volunteer';
type Targets = Partial<Record<Group, number>>;

interface Menu {
	label: string;
	tags: string[];
	actualYield: number;
}

const ownedIds = new Set<string>();
const contexts: BrowserContext[] = [];
let session = '';

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

/** One session with each menu cooked and recorded (meal_plan + meal_service per menu). */
async function seedSession(name: string, targets: Targets, menus: Menu[]): Promise<void> {
	const headcount: Record<Group, number> = {
		halal: targets.halal ?? 0,
		infant: targets.infant ?? 0,
		soft_food: targets.soft_food ?? 0,
		regular: targets.regular ?? 0,
		volunteer: targets.volunteer ?? 0
	};
	const sessionDoc = {
		...envelope('meal_session', 1),
		name,
		date: TODAY,
		meal: 'lunch',
		status: 'active',
		target_headcount: {
			...headcount,
			total: headcount.halal + headcount.infant + headcount.soft_food + headcount.regular
		}
	};
	await putDocument(SHELTER_DB, sessionDoc);

	for (const menu of menus) {
		const plan = {
			...envelope('meal_plan', 2),
			date: TODAY,
			meal: 'lunch',
			label: menu.label,
			headcount: { total: menu.actualYield, halal: 0, soft_food: 0, infant: 0 },
			recipes: [],
			status: 'confirmed',
			meal_session_id: sessionDoc._id,
			target_tags: menu.tags,
			allocated_target: menu.actualYield
		};
		await putDocument(SHELTER_DB, plan);
		await putDocument(SHELTER_DB, {
			...envelope('meal_service', 2),
			date: TODAY,
			meal: 'lunch',
			meal_plan_id: plan._id,
			meal_session_id: sessionDoc._id,
			actual_yield: menu.actualYield,
			served: menu.actualYield,
			waste: 0,
			external: { volunteers: 0, outside_evacuees: 0 }
		});
	}
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
		throw new AggregateError(errors, `Could not fully clean kitchen group-progress run ${RUN}`);
	}
}

async function openKitchen(browser: Browser): Promise<Page> {
	const context = await browser.newContext();
	contexts.push(context);
	const page = await context.newPage();
	await routeBrowserCouchThroughApp(page);
	await injectSession(page, KITCHEN, session);
	await page.goto('/back-office/kitchen');
	await expect(page.getByRole('heading', { name: 'หน้าสรุปมื้อ' })).toBeVisible({
		timeout: 15_000
	});
	return page;
}

async function findSessionCard(page: Page, name: string) {
	await page.getByPlaceholder('ค้นหาชื่อมื้อ หรือวันที่...').fill(name);
	const card = page.locator('[data-slot="accordion-item"]').filter({ hasText: name });
	await expect(card).toBeVisible({ timeout: 15_000 });
	const trigger = card.locator('[data-slot="accordion-trigger"]');
	if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
	await expect(trigger).toHaveAttribute('aria-expanded', 'true');
	return card;
}

/** Cells of one target-table row: [group, target (plates), received (plates), status]. */
async function expectRow(
	card: ReturnType<Page['locator']>,
	group: string,
	values: [target: string, received: string, status: string]
): Promise<void> {
	const row = card.getByRole('row').filter({
		has: card.page().getByRole('cell', { name: group, exact: true })
	});
	await expect(row).toHaveCount(1);
	const cells = row.getByRole('cell');
	await expect(cells.nth(1)).toHaveText(values[0]);
	await expect(cells.nth(2)).toHaveText(values[1]);
	await expect(cells.nth(3)).toHaveText(values[2]);
}

test.describe(
	'Kitchen — meal session group targets by priority fill (#770)',
	{ tag: ['@kitchen'] },
	() => {
		test.skip(!CAN_WRITE, READ_ONLY_REASON);
		test.setTimeout(90_000);

		const ISSUE_CASE = `E2E มื้อ 282 จาน ${RUN}`;
		const SHORT_CASE = `E2E มื้อ 250 จาน ${RUN}`;
		const MULTI_CASE = `E2E มื้อสองเมนู ${RUN}`;

		test.beforeAll(async () => {
			await createCouchUser(KITCHEN);
			await seedSecurityQuestion(KITCHEN.name);
			session = await couchLogin(KITCHEN.name, KITCHEN.password);

			// The issue's example: one halal + regular menu, 282 plates for 47 halal + 235 regular.
			await seedSession(ISSUE_CASE, { halal: 47, regular: 235 }, [
				{ label: `E2E ข้าวไข่เจียว ${RUN}`, tags: ['halal', 'regular'], actualYield: 282 }
			]);
			// Same targets, only 250 plates: halal fills first, regular is short.
			await seedSession(SHORT_CASE, { halal: 47, regular: 235 }, [
				{ label: `E2E ข้าวไข่เจียว ${RUN}`, tags: ['halal', 'regular'], actualYield: 250 }
			]);
			// A broad menu listed before a soft-food-only one: the narrow menu still fills soft food
			// first, so the broad menu's plates go to regular and 5 are left over.
			await seedSession(MULTI_CASE, { soft_food: 10, regular: 20 }, [
				{ label: `E2E ข้าวต้ม ${RUN}`, tags: ['soft_food', 'regular'], actualYield: 25 },
				{ label: `E2E โจ๊กอาหารอ่อน ${RUN}`, tags: ['soft_food'], actualYield: 10 }
			]);
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

		test('a two-group menu is split between groups, not counted twice', async ({ browser }) => {
			const page = await openKitchen(browser);
			const card = await findSessionCard(page, ISSUE_CASE);

			await expect(card.getByText('เป้าหมายตามกลุ่มความต้องการ (รวม 282 จาน)')).toBeVisible();
			await expectRow(card, 'ฮาลาล (มุสลิม)', ['47', '47', 'ครบ']);
			await expectRow(card, 'ทั่วไป', ['235', '235', 'ครบ']);
			await expectRow(card, 'เด็ก / ผู้ป่วย / จนท.', ['0', '—', 'ไม่มีเป้าหมาย']);
			await expectRow(card, 'รวม', ['282', '282', '2/2 กลุ่มครบ']);
			// No group row shows the full 282 that the old double count gave both groups.
			await expect(card.getByRole('cell', { name: '282', exact: true })).toHaveCount(2);
			// Header badge counts only the groups that have a target.
			await expect(card.getByText('2/2 กลุ่มครบ')).toHaveCount(2);
			await expect(card.getByText('5/5 กลุ่มครบ')).toHaveCount(0);
		});

		test('when plates run short, the restricted group fills first', async ({ browser }) => {
			const page = await openKitchen(browser);
			const card = await findSessionCard(page, SHORT_CASE);

			await expectRow(card, 'ฮาลาล (มุสลิม)', ['47', '47', 'ครบ']);
			await expectRow(card, 'ทั่วไป', ['235', '203', 'ขาด 32']);
			await expectRow(card, 'รวม', ['282', '250', '1/2 กลุ่มครบ']);
			await expect(card.getByText('1/2 กลุ่มครบ')).toHaveCount(2);
		});

		test('the narrow-tagged menu fills first and leftovers show as surplus', async ({
			browser
		}) => {
			const page = await openKitchen(browser);
			const card = await findSessionCard(page, MULTI_CASE);

			await expectRow(card, 'ผู้ป่วย/อาหารอ่อน', ['10', '10', 'ครบ']);
			await expectRow(card, 'ทั่วไป', ['20', '20', 'ครบ']);
			await expectRow(card, 'ฮาลาล / เด็ก / จนท.', ['0', '—', 'ไม่มีเป้าหมาย']);
			await expectRow(card, 'รวม', ['30', '35 · เกิน 5', '2/2 กลุ่มครบ']);
		});
	}
);
