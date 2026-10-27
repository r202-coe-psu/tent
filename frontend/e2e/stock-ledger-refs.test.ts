import { test, expect } from '@playwright/test';
import {
	createCouchUser,
	deleteCouchUser,
	couchLogin,
	couchReq,
	putDocument,
	getDocument,
	deleteDocument,
	seedSecurityQuestion,
	type TestUser
} from './helpers/couch';
import { injectSession, clearSession, routeBrowserCouchThroughApp } from './helpers/login';
import { ulid } from '../src/lib/db/ulid';

/**
 * Ledger "ที่มา / ปลายทาง" names the doc a `ref_id` points at (#811).
 *
 * A `stock_transfer` lives in `central_ops`, not the shelter DB the ledger is read from, so its
 * label must come through the transfer BFF — unit tests mock that BFF, this runs it for real.
 */

const RUN_ID = `lr_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
const SHELTER_DB = 'shelter_sh001';
const CATALOG_DB = 'catalog';
const CENTRAL_DB = 'central_ops';

const WH_STAFF: TestUser = {
	name: `wh_staff_${RUN_ID}`,
	password: 'Password1!',
	roles: ['shelter:SH001', 'warehouse_staff'],
	display_name: 'Warehouse Staff E2E'
};

const itemId = `item_master:${ulid()}`;
const itemName = `E2E ผ้าห่ม ${RUN_ID}`;
const transferId = `stock_transfer:${ulid()}`;
const missingTransferId = `stock_transfer:${ulid()}`;
const sentRowId = `stock_ledger:${ulid()}`;
const orphanRowId = `stock_ledger:${ulid()}`;

const seeded: Array<[db: string, id: string]> = [
	[CATALOG_DB, itemId],
	[CENTRAL_DB, transferId],
	[SHELTER_DB, sentRowId],
	[SHELTER_DB, orphanRowId]
];

let session = '';

function transferOutRow(id: string, refId: string, qty: string, at: string) {
	return {
		_id: id,
		type: 'stock_ledger',
		schema_v: 6,
		shelter_code: 'SH001',
		created_at: at,
		updated_at: at,
		created_by: WH_STAFF.name,
		item_id: itemId,
		qty,
		unit: 'piece',
		reason: 'transfer_out',
		adjust_reason: null,
		ref_id: refId,
		occurred_at: at
	};
}

test.describe('Stock ledger ref labels (#811)', () => {
	test.beforeAll(async () => {
		await createCouchUser(WH_STAFF);
		await seedSecurityQuestion(WH_STAFF.name);
		session = await couchLogin(WH_STAFF.name, WH_STAFF.password);

		const now = new Date().toISOString();
		await couchReq('PUT', `/${CENTRAL_DB}`); // 412 when it already exists
		await putDocument(CATALOG_DB, {
			_id: itemId,
			type: 'item_master',
			schema_v: 4,
			created_at: now,
			updated_at: now,
			created_by: WH_STAFF.name,
			name: itemName,
			category: 'item_category:food',
			sku: `E2E-BLANKET-${RUN_ID}`,
			base_unit: 'piece',
			conversions: [],
			default_inventory_uom: 'piece',
			default_issue_uom: 'piece',
			distribution_type: 'recurring',
			type_class: 'CONSUMABLE',
			deactivated: false,
			dietary: [],
			returnable: false
		});
		await putDocument(CENTRAL_DB, {
			_id: transferId,
			type: 'stock_transfer',
			schema_v: 2,
			shelter_code: 'SH001',
			created_at: now,
			updated_at: now,
			created_by: WH_STAFF.name,
			from_shelter: 'SH001',
			to_shelter: 'SH002',
			items: [{ item_id: itemId, qty: '3', unit: 'piece' }],
			status: 'shipped',
			timeline: {
				requested: { at: now, by: WH_STAFF.name },
				shipped: { at: now, by: WH_STAFF.name }
			},
			driver_name: 'E2E Driver',
			vehicle_plate: 'E2E 1234'
		});
		await putDocument(SHELTER_DB, transferOutRow(sentRowId, transferId, '-3', now));
		// Points at a transfer that is not in `central_ops`: keeps the short ref.
		await putDocument(SHELTER_DB, transferOutRow(orphanRowId, missingTransferId, '-1', now));
	});

	test.afterEach(async ({ page }) => {
		await page.unrouteAll({ behavior: 'ignoreErrors' });
		await clearSession(page);
	});

	test.afterAll(async () => {
		const errors: unknown[] = [];
		for (const [db, id] of seeded) {
			try {
				const doc = await getDocument(db, id);
				if (doc) await deleteDocument(db, doc);
			} catch (err) {
				errors.push(err);
			}
		}
		try {
			await deleteCouchUser(WH_STAFF.name);
		} catch (err) {
			errors.push(err);
		}
		if (errors.length > 0) throw new AggregateError(errors, 'E2E teardown left documents behind');
	});

	test('a transfer row names its shelters; a missing transfer keeps the short ref', async ({
		page
	}) => {
		await routeBrowserCouchThroughApp(page);
		await injectSession(page, WH_STAFF, session);
		const transfersRead = page.waitForResponse(
			(res) => res.url().includes('/api/back-office/transfer?') && res.request().method() === 'GET'
		);
		await page.goto(`/back-office/supply?tab=movements&lq=${encodeURIComponent(RUN_ID)}`);

		expect((await transfersRead).status()).toBe(200);
		const table = page.locator('table');
		await expect(table.getByRole('row').filter({ hasText: itemName })).toHaveCount(2, {
			timeout: 10_000
		});
		await expect(table.getByRole('row').filter({ hasText: 'โอนย้าย SH001 → SH002' })).toHaveCount(
			1
		);
		await expect(
			table.getByRole('row').filter({ hasText: `ใบโอนย้าย · …${missingTransferId.slice(-5)}` })
		).toHaveCount(1);
	});
});
