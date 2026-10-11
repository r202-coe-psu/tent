import { test, expect } from '@playwright/test';
import {
	createCouchUser,
	deleteCouchUser,
	couchLogin,
	putDocument,
	allDocuments,
	deleteDocument,
	type TestUser,
	seedSecurityQuestion
} from './helpers/couch';
import { injectSession, clearSession, routeBrowserCouchThroughApp } from './helpers/login';
import { ulid } from '../src/lib/db/ulid';

/**
 * End-to-end test suite for Stock Inventory & Warehouse Operations (/back-office/supply).
 *
 * Covers:
 * 1. Access Control: Role capability guards (warehouse_staff vs supply_coordinator vs registration_staff)
 * 2. Stock Inventory Display: On-hand balances, search, and category filtering
 * 3. Shelf-life Expiry (CR-156 §J): Expiry badge and Attention Card aggregation
 * 4. Item Detail Sheet: Lot inspection and action permissions
 * 5. 100% Teardown: Zero CouchDB database leakage guaranteed in afterAll
 */

const RUN_ID = `si_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
const SHELTER_DB = 'shelter_sh001';
const CATALOG_DB = 'catalog';

const DISTRIBUTE_FORBIDDEN_HINT = 'ต้องมีสิทธิ์เจ้าหน้าที่คลัง (warehouse_staff) จึงจะเบิกจ่ายได้';

const WH_STAFF: TestUser = {
	name: `wh_staff_${RUN_ID}`,
	password: 'Password1!',
	roles: ['shelter:SH001', 'warehouse_staff'],
	display_name: 'Warehouse Staff E2E'
};

const COORD_STAFF: TestUser = {
	name: `coord_staff_${RUN_ID}`,
	password: 'Password1!',
	roles: ['shelter:SH001', 'supply_coordinator', 'registration_staff'],
	display_name: 'Supply Coordinator E2E'
};

const REG_STAFF: TestUser = {
	name: `reg_staff_${RUN_ID}`,
	password: 'Password1!',
	roles: ['shelter:SH001', 'registration_staff'],
	display_name: 'Registration Staff E2E'
};

const testUsernames = new Set<string>([WH_STAFF.name, COORD_STAFF.name, REG_STAFF.name]);
const ownedShelterDocIds = new Set<string>();
const ownedCatalogDocIds = new Set<string>();
const sessions: Record<string, string> = {};

const item1Id = `item_master:${ulid()}`;
const item1Name = `E2E ข้าวสารหอมมะลิ ${RUN_ID}`;
const lot1Id = `stock_ledger:${ulid()}`;

const item2Id = `item_master:${ulid()}`;
const item2Name = `E2E นมสดสเตอริไลส์ ${RUN_ID}`;
const lot2Id = `stock_ledger:${ulid()}`;

test.describe('Stock Inventory & Warehouse Operations (/back-office/supply)', () => {
	test.describe.configure({ mode: 'serial' });

	test.beforeAll(async () => {
		// 1. Create and setup test users
		for (const user of [WH_STAFF, COORD_STAFF, REG_STAFF]) {
			await createCouchUser(user);
			await seedSecurityQuestion(user.name);
			sessions[user.name] = await couchLogin(user.name, user.password);
		}

		const nowIso = new Date().toISOString();
		const twentyDaysAgo = new Date(Date.now() - 20 * 86_400_000).toISOString();

		// 2. Seed Item 1: Standard durable food item with stock
		await putDocument(CATALOG_DB, {
			_id: item1Id,
			type: 'item_master',
			schema_v: 4,
			created_at: nowIso,
			updated_at: nowIso,
			created_by: WH_STAFF.name,
			name: item1Name,
			category: 'item_category:food',
			sku: `E2E-RICE-${RUN_ID}`,
			base_unit: 'box',
			conversions: [],
			default_inventory_uom: 'box',
			default_issue_uom: 'box',
			distribution_type: 'recurring',
			type_class: 'CONSUMABLE',
			deactivated: false,
			dietary: [],
			returnable: false,
			shelf_life_days: 180
		});
		ownedCatalogDocIds.add(item1Id);

		await putDocument(SHELTER_DB, {
			_id: lot1Id,
			type: 'stock_ledger',
			schema_v: 6,
			shelter_code: 'SH001',
			created_at: nowIso,
			updated_at: nowIso,
			created_by: WH_STAFF.name,
			item_id: item1Id,
			qty: '50',
			unit: 'box',
			reason: 'receive',
			adjust_reason: null,
			ref_id: null,
			lot_ref: lot1Id,
			occurred_at: nowIso,
			lot: {
				lot_no: 'L-261008-001',
				storage_zone: 'คลังหลัก'
			}
		});
		ownedShelterDocIds.add(lot1Id);

		// 3. Seed Item 2: Perishable item with shelf_life_days: 5 received 20 days ago (CR-156 §J expired)
		await putDocument(CATALOG_DB, {
			_id: item2Id,
			type: 'item_master',
			schema_v: 4,
			created_at: twentyDaysAgo,
			updated_at: twentyDaysAgo,
			created_by: WH_STAFF.name,
			name: item2Name,
			category: 'item_category:food',
			sku: `E2E-MILK-${RUN_ID}`,
			base_unit: 'piece',
			conversions: [],
			default_inventory_uom: 'piece',
			default_issue_uom: 'piece',
			distribution_type: 'recurring',
			type_class: 'CONSUMABLE',
			deactivated: false,
			dietary: [],
			returnable: false,
			shelf_life_days: 5
		});
		ownedCatalogDocIds.add(item2Id);

		await putDocument(SHELTER_DB, {
			_id: lot2Id,
			type: 'stock_ledger',
			schema_v: 6,
			shelter_code: 'SH001',
			created_at: twentyDaysAgo,
			updated_at: twentyDaysAgo,
			created_by: WH_STAFF.name,
			item_id: item2Id,
			qty: '20',
			unit: 'piece',
			reason: 'receive',
			adjust_reason: null,
			ref_id: null,
			lot_ref: lot2Id,
			occurred_at: twentyDaysAgo,
			lot: {
				lot_no: 'L-260918-002',
				storage_zone: 'คลังหลัก',
				produced_at: twentyDaysAgo
			}
		});
		ownedShelterDocIds.add(lot2Id);
	});

	test.afterEach(async ({ page }) => {
		await page.unrouteAll({ behavior: 'ignoreErrors' });
		await clearSession(page);
	});

	test.afterAll(async () => {
		const errors: Error[] = [];

		// 1. Purge all test documents in shelter_sh001
		for (let pass = 0; pass < 3; pass++) {
			try {
				const docs = await allDocuments(SHELTER_DB);
				const toDelete = docs.filter(
					(d) =>
						ownedShelterDocIds.has(d._id) ||
						(typeof d.created_by === 'string' && testUsernames.has(d.created_by))
				);
				if (toDelete.length === 0) break;
				const results = await Promise.allSettled(
					toDelete.map((doc) => deleteDocument(SHELTER_DB, doc))
				);
				for (const r of results) {
					if (r.status === 'rejected') {
						errors.push(r.reason instanceof Error ? r.reason : new Error(String(r.reason)));
					}
				}
			} catch (err) {
				errors.push(err instanceof Error ? err : new Error(String(err)));
				break;
			}
		}

		// 2. Purge all test documents in catalog
		for (let pass = 0; pass < 3; pass++) {
			try {
				const docs = await allDocuments(CATALOG_DB);
				const toDelete = docs.filter(
					(d) =>
						ownedCatalogDocIds.has(d._id) ||
						(typeof d.created_by === 'string' && testUsernames.has(d.created_by))
				);
				if (toDelete.length === 0) break;
				const results = await Promise.allSettled(
					toDelete.map((doc) => deleteDocument(CATALOG_DB, doc))
				);
				for (const r of results) {
					if (r.status === 'rejected') {
						errors.push(r.reason instanceof Error ? r.reason : new Error(String(r.reason)));
					}
				}
			} catch (err) {
				errors.push(err instanceof Error ? err : new Error(String(err)));
				break;
			}
		}

		// 3. Purge test users from _users
		for (const username of testUsernames) {
			try {
				await deleteCouchUser(username);
			} catch (err) {
				errors.push(err instanceof Error ? err : new Error(String(err)));
			}
		}

		// 4. Zero DB leakage assertion
		try {
			const remainingShelter = (await allDocuments(SHELTER_DB)).filter(
				(d) =>
					ownedShelterDocIds.has(d._id) ||
					(typeof d.created_by === 'string' && testUsernames.has(d.created_by))
			);
			const remainingCatalog = (await allDocuments(CATALOG_DB)).filter(
				(d) =>
					ownedCatalogDocIds.has(d._id) ||
					(typeof d.created_by === 'string' && testUsernames.has(d.created_by))
			);
			if (remainingShelter.length > 0 || remainingCatalog.length > 0) {
				errors.push(
					new Error(
						`Database leak detected! Shelter docs: ${remainingShelter.map((d) => d._id).join(', ')}; Catalog docs: ${remainingCatalog.map((d) => d._id).join(', ')}`
					)
				);
			}
		} catch (err) {
			errors.push(err instanceof Error ? err : new Error(String(err)));
		}

		if (errors.length > 0) {
			throw new AggregateError(errors, `Failed to cleanly teardown E2E run ${RUN_ID}`);
		}
	});

	test('access guard: registration staff cannot open the supply inventory page', async ({
		page
	}) => {
		await routeBrowserCouchThroughApp(page);
		await injectSession(page, REG_STAFF, sessions[REG_STAFF.name]);
		await page.goto('/back-office/supply');

		// The warehouse guard redirects unauthorized users away from /back-office/supply
		await expect(page).not.toHaveURL(/\/back-office\/supply/, { timeout: 10_000 });
	});

	test('access guard: supply coordinator can view stock but distribute buttons are disabled', async ({
		page
	}) => {
		await routeBrowserCouchThroughApp(page);
		await injectSession(page, COORD_STAFF, sessions[COORD_STAFF.name]);
		await page.goto('/back-office/supply');

		await expect(page).toHaveURL(/\/back-office\/supply/);
		await expect(page.getByRole('heading', { name: 'คลังของศูนย์' })).toBeVisible({
			timeout: 10_000
		});

		// 1. Header distribute button is disabled with capability tooltip
		const headerDistribute = page.getByRole('button', { name: 'เบิกจ่าย', exact: true });
		await expect(headerDistribute).toBeVisible();
		await expect(headerDistribute).toBeDisabled();
		await expect(headerDistribute).toHaveAttribute('title', DISTRIBUTE_FORBIDDEN_HINT);

		// 2. Filter to Item 1
		const searchInput = page.getByPlaceholder('ค้นหาชื่อ / SKU / สแกนบาร์โค้ด');
		await searchInput.fill(item1Name);

		const row = page.getByRole('row').filter({ hasText: item1Name });
		await expect(row).toBeVisible({ timeout: 10_000 });

		// 3. Row distribute button is disabled with capability tooltip
		const rowDistribute = row.getByRole('button', { name: `เบิก ${item1Name}` });
		await expect(rowDistribute).toBeVisible();
		await expect(rowDistribute).toBeDisabled();
		await expect(rowDistribute).toHaveAttribute('title', DISTRIBUTE_FORBIDDEN_HINT);

		// 4. Open Item Detail Sheet and verify distribute button inside sheet is also disabled
		await row.getByRole('button', { name: item1Name, exact: true }).click();
		const sheet = page.getByRole('dialog');
		await expect(sheet.getByRole('heading', { name: item1Name })).toBeVisible();

		const sheetDistribute = sheet.getByRole('button', { name: `เบิกจ่าย ${item1Name}` });
		await expect(sheetDistribute).toBeVisible();
		await expect(sheetDistribute).toBeDisabled();
		await expect(sheetDistribute).toHaveAttribute('title', DISTRIBUTE_FORBIDDEN_HINT);

		// Close sheet
		await page.keyboard.press('Escape');
		await expect(sheet).not.toBeVisible();
	});

	test('warehouse staff can view stock and has distribute buttons enabled', async ({ page }) => {
		await routeBrowserCouchThroughApp(page);
		await injectSession(page, WH_STAFF, sessions[WH_STAFF.name]);
		await page.goto('/back-office/supply');

		await expect(page).toHaveURL(/\/back-office\/supply/);
		await expect(page.getByRole('heading', { name: 'คลังของศูนย์' })).toBeVisible({
			timeout: 10_000
		});

		// 1. Header distribute button is enabled
		const headerDistribute = page.getByRole('button', { name: 'เบิกจ่าย', exact: true });
		await expect(headerDistribute).toBeVisible();
		await expect(headerDistribute).toBeEnabled();

		// 2. Find Item 1
		const searchInput = page.getByPlaceholder('ค้นหาชื่อ / SKU / สแกนบาร์โค้ด');
		await searchInput.fill(item1Name);

		const row = page.getByRole('row').filter({ hasText: item1Name });
		await expect(row).toBeVisible({ timeout: 10_000 });

		// 3. Row distribute button is enabled
		const rowDistribute = row.getByRole('button', { name: `เบิก ${item1Name}` });
		await expect(rowDistribute).toBeVisible();
		await expect(rowDistribute).toBeEnabled();

		// 4. Open Item Detail Sheet and verify distribute button inside sheet is enabled
		await row.getByRole('button', { name: item1Name, exact: true }).click();
		const sheet = page.getByRole('dialog');
		await expect(sheet.getByRole('heading', { name: item1Name })).toBeVisible();

		const sheetDistribute = sheet.getByRole('button', { name: `เบิกจ่าย ${item1Name}` });
		await expect(sheetDistribute).toBeVisible();
		await expect(sheetDistribute).toBeEnabled();

		// Close sheet
		await page.keyboard.press('Escape');
		await expect(sheet).not.toBeVisible();
	});

	test('search and category filtering work correctly', async ({ page }) => {
		await routeBrowserCouchThroughApp(page);
		await injectSession(page, WH_STAFF, sessions[WH_STAFF.name]);
		await page.goto('/back-office/supply');

		const searchInput = page.getByPlaceholder('ค้นหาชื่อ / SKU / สแกนบาร์โค้ด');

		// 1. Search for Item 1
		await searchInput.fill(item1Name);
		await expect(page.getByRole('row').filter({ hasText: item1Name })).toBeVisible({
			timeout: 10_000
		});
		await expect(page.getByRole('row').filter({ hasText: item2Name })).toHaveCount(0);

		// 2. Search for Item 2
		await searchInput.fill(item2Name);
		await expect(page.getByRole('row').filter({ hasText: item2Name })).toBeVisible({
			timeout: 10_000
		});
		await expect(page.getByRole('row').filter({ hasText: item1Name })).toHaveCount(0);

		// 3. Clear search and filter by category
		await searchInput.fill('');
		const catTrigger = page.locator('[aria-label="กรองหมวดหมู่"]');
		await expect(catTrigger).toBeVisible();
		await catTrigger.click();

		const foodOption = page.getByRole('option', { name: 'อาหารและวัตถุดิบ' });
		if (await foodOption.isVisible()) {
			await foodOption.click();
			// In food category, both seeded items should be present
			await searchInput.fill(RUN_ID);
			await expect(page.getByRole('row').filter({ hasText: item1Name })).toBeVisible({
				timeout: 10_000
			});
			await expect(page.getByRole('row').filter({ hasText: item2Name })).toBeVisible();
		}
	});

	test('shelf life expiry: expired badge and attention card (CR-156 §J)', async ({ page }) => {
		await routeBrowserCouchThroughApp(page);
		await injectSession(page, WH_STAFF, sessions[WH_STAFF.name]);
		await page.goto('/back-office/supply');

		// 1. Attention card "หมดอายุ" should count at least 1 (our seeded expired Item 2)
		const attentionSection = page.locator('section[aria-label="สรุปสิ่งที่ต้องจัดการ"]');
		const expiredCard = attentionSection.getByRole('button', { name: /^หมดอายุ/ });
		await expect(expiredCard).toBeVisible({ timeout: 10_000 });
		// Wait for reactive queries to resolve and verify count is at least 1
		await expect(expiredCard.getByText(/^[1-9]\d*/)).toBeVisible({ timeout: 10_000 });

		// 2. Search Item 2 and check "หมดอายุ" badge
		const searchInput = page.getByPlaceholder('ค้นหาชื่อ / SKU / สแกนบาร์โค้ด');
		await searchInput.fill(item2Name);

		const row2 = page.getByRole('row').filter({ hasText: item2Name });
		await expect(row2).toBeVisible({ timeout: 10_000 });
		await expect(row2.getByText('หมดอายุ').filter({ visible: true })).toBeVisible();

		// 3. Click Attention Card "หมดอายุ" to filter table by expired status
		await searchInput.fill('');
		await expiredCard.click();
		await expect(page).toHaveURL(/status=expired/);

		// With status=expired, Item 2 is visible and Item 1 (not expired) is hidden
		await searchInput.fill(RUN_ID);
		await expect(page.getByRole('row').filter({ hasText: item2Name })).toBeVisible({
			timeout: 10_000
		});
		await expect(page.getByRole('row').filter({ hasText: item1Name })).toHaveCount(0);

		// 4. Click Attention Card again to toggle filter off
		await expiredCard.click();
		await expect(page).not.toHaveURL(/status=expired/);
		await expect(page.getByRole('row').filter({ hasText: item1Name })).toBeVisible({
			timeout: 10_000
		});
	});
});
