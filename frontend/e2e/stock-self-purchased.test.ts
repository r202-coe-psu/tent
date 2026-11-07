import { test, expect } from '@playwright/test';
import {
	createCouchUser,
	deleteCouchUser,
	couchLogin,
	putDocument,
	allDocuments,
	deleteDocument,
	seedSecurityQuestion,
	type TestUser
} from './helpers/couch';
import { CAN_WRITE, READ_ONLY_REASON } from './helpers/e2e-env';
import { injectSession, routeBrowserCouchThroughApp } from './helpers/login';
import { ulid } from '../src/lib/db/ulid';

/**
 * "ซื้อเอง" (self-purchased) lots on the supply page — #1187, CR-234 (+ A1).
 *
 * One item holds two lots: A (donated, 200 kg, expires first) and B (bought by the shelter,
 * 10 kg, expires later; a manual receipt = `adjust`/`found` + `lot.self_purchased`).
 *
 * The page logic itself is unit-tested; this suite pins what only a real stack shows:
 *  - the stock table's "ซื้อเอง" filter (`sp=1`) narrows the row to what was bought,
 *  - the detail sheet still orders by every lot, so B is never the "เบิกถัดไป" lot,
 *  - the ledger groups B as "ซื้อเอง" (not ปรับยอด) and filters by `type=self_purchased`,
 *  - the per-item history prints the same label.
 *
 * Data (README §4): one `ssp_*` CouchDB user, one `item_master` and two `stock_ledger` rows on
 * the seeded SH001, all removed in afterAll (users, rows, and a zero-leak assertion).
 */

const TAGS = { tag: ['@critical', '@supply'] };

const RUN_ID = `ssp_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
const SHELTER_DB = 'shelter_sh001';
const CATALOG_DB = 'catalog';

const USER: TestUser = {
	name: `wh_${RUN_ID}`,
	password: 'Password1!',
	roles: ['shelter:SH001', 'warehouse_staff'],
	display_name: 'Self-purchased E2E'
};

const itemId = `item_master:${ulid()}`;
const itemName = `E2E ผักรวม ${RUN_ID}`;
const lotA = `stock_ledger:${ulid()}`;
const lotB = `stock_ledger:${ulid()}`;
const LOT_A = `A-${RUN_ID}`;
const LOT_B = `B-${RUN_ID}`;

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString();

let session = '';

test.describe('Self-purchased lots (/back-office/supply)', TAGS, () => {
	test.describe.configure({ mode: 'serial' });

	test.beforeAll(async () => {
		test.skip(!CAN_WRITE, READ_ONLY_REASON);
		await createCouchUser(USER);
		await seedSecurityQuestion(USER.name);
		session = await couchLogin(USER.name, USER.password);

		const now = new Date().toISOString();
		await putDocument(CATALOG_DB, {
			_id: itemId,
			type: 'item_master',
			schema_v: 4,
			created_at: now,
			updated_at: now,
			created_by: USER.name,
			name: itemName,
			category: 'item_category:food',
			sku: `E2E-VEG-${RUN_ID}`,
			base_unit: 'kg',
			conversions: [],
			default_inventory_uom: 'kg',
			default_issue_uom: 'kg',
			distribution_type: 'recurring',
			type_class: 'CONSUMABLE',
			deactivated: false,
			dietary: [],
			returnable: false,
			shelf_life_days: 30
		});

		const base = {
			type: 'stock_ledger',
			schema_v: 7,
			shelter_code: 'SH001',
			created_at: now,
			updated_at: now,
			created_by: USER.name,
			item_id: itemId,
			unit: 'kg',
			ref_id: null
		};
		await putDocument(SHELTER_DB, {
			...base,
			_id: lotA,
			qty: '200',
			reason: 'donation',
			adjust_reason: null,
			lot_ref: lotA,
			occurred_at: day(-2),
			lot: { lot_no: LOT_A, expiry: day(9), produced_at: day(-2) }
		});
		await putDocument(SHELTER_DB, {
			...base,
			_id: lotB,
			qty: '10',
			reason: 'adjust',
			adjust_reason: 'found',
			lot_ref: lotB,
			occurred_at: day(-1),
			lot: { lot_no: LOT_B, expiry: day(20), produced_at: day(-1), self_purchased: true }
		});
	});

	test.afterAll(async () => {
		if (!CAN_WRITE) return;
		const errors: Error[] = [];
		const owned = new Set([itemId, lotA, lotB]);
		for (const db of [SHELTER_DB, CATALOG_DB]) {
			try {
				for (const doc of (await allDocuments(db)).filter(
					(d) => owned.has(d._id) || d.created_by === USER.name
				)) {
					await deleteDocument(db, doc);
				}
			} catch (err) {
				errors.push(err instanceof Error ? err : new Error(String(err)));
			}
		}
		try {
			await deleteCouchUser(USER.name);
		} catch (err) {
			errors.push(err instanceof Error ? err : new Error(String(err)));
		}
		try {
			for (const db of [SHELTER_DB, CATALOG_DB]) {
				const left = (await allDocuments(db)).filter(
					(d) => owned.has(d._id) || d.created_by === USER.name
				);
				if (left.length > 0) {
					errors.push(new Error(`Leak in ${db}: ${left.map((d) => d._id).join(', ')}`));
				}
			}
		} catch (err) {
			errors.push(err instanceof Error ? err : new Error(String(err)));
		}
		if (errors.length > 0) throw new AggregateError(errors, 'self-purchased e2e teardown failed');
	});

	test.beforeEach(async ({ page }) => {
		await routeBrowserCouchThroughApp(page);
		await injectSession(page, USER, session);
	});

	const stockRow = (page: import('@playwright/test').Page) =>
		page.getByRole('row').filter({ hasText: itemName });

	test('stock table: the ซื้อเอง filter narrows the row to what was bought', async ({ page }) => {
		const search = encodeURIComponent(itemName);

		await page.goto(`/back-office/supply?q=${search}`);
		await expect(stockRow(page)).toContainText('210', { timeout: 15_000 });
		await expect(stockRow(page)).toContainText('2 ล็อต');

		await page.goto(`/back-office/supply?q=${search}&sp=1`);
		await expect(stockRow(page)).toContainText('10', { timeout: 15_000 });
		await expect(stockRow(page)).not.toContainText('210');
		await expect(stockRow(page)).toContainText('1 ล็อต');
	});

	test('item sheet: the filter hides lot A but B keeps place 2, never "เบิกถัดไป"', async ({
		page
	}) => {
		await page.goto(`/back-office/supply?q=${encodeURIComponent(itemName)}&sp=1`);
		await stockRow(page).getByText(itemName).click({ timeout: 15_000 });
		const sheet = page.locator('[data-slot="sheet-content"]');

		// The header keeps the total and names the self-purchased part.
		await expect(sheet).toContainText('210');
		await expect(sheet).toContainText('ซื้อเอง 10');

		// Filter on: only the bought lot, still the second to issue. The sheet mounts every tab, so
		// look at the lot cards (list items) rather than the whole sheet text.
		const lots = sheet.getByRole('listitem');
		await expect(lots.filter({ hasText: LOT_B })).toHaveCount(1);
		await expect(lots.filter({ hasText: LOT_A })).toHaveCount(0);
		await expect(lots.filter({ hasText: LOT_B })).toContainText('ลำดับที่ 2');
		await expect(lots.filter({ hasText: 'เบิกถัดไป' })).toHaveCount(0);

		// Switch off: both lots, and A (earlier expiry) is the one to issue next.
		await sheet.getByLabel('เฉพาะล็อตที่ซื้อเอง').click();
		await expect(sheet).toContainText(LOT_A);
		await expect(sheet.getByRole('listitem').filter({ hasText: LOT_A })).toContainText('เบิกถัดไป');
		await expect(sheet.getByRole('listitem').filter({ hasText: LOT_B })).toContainText('ซื้อเอง');
	});

	test('ledger: a flagged receipt is its own ซื้อเอง group, not ปรับยอด', async ({ page }) => {
		await page.goto(`/back-office/supply?tab=movements&range=all&lq=${encodeURIComponent(RUN_ID)}`);
		const rows = page.getByRole('row').filter({ hasText: itemName });
		await expect(rows).toHaveCount(2, { timeout: 15_000 });
		await expect(rows.filter({ hasText: LOT_B })).toContainText('ซื้อเอง');
		await expect(rows.filter({ hasText: LOT_B })).not.toContainText('ปรับปรุงคลัง');
		await expect(rows.filter({ hasText: LOT_A })).toContainText('รับบริจาค');

		// The type filter keeps only the self-purchased group and lands in the URL.
		await page.getByRole('button', { name: 'ซื้อเอง', exact: true }).click();
		await expect(page).toHaveURL(/type=self_purchased/);
		await expect(rows).toHaveCount(1);
		await expect(rows.first()).toContainText(LOT_B);
	});

	test('item history prints the same ซื้อเอง label', async ({ page }) => {
		await page.goto(`/back-office/supply?q=${encodeURIComponent(itemName)}`);
		await stockRow(page).getByText(itemName).click({ timeout: 15_000 });
		const sheet = page.locator('[data-slot="sheet-content"]');
		await sheet.getByRole('tab', { name: 'ประวัติ' }).click();

		const bought = sheet.getByRole('row').filter({ hasText: LOT_B });
		await expect(bought).toContainText('ซื้อเอง', { timeout: 15_000 });
		await expect(bought).not.toContainText('ปรับปรุงคลัง');
		await expect(sheet.getByRole('row').filter({ hasText: LOT_A })).toContainText('รับบริจาค');
	});
});
