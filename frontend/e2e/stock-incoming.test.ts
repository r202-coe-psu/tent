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
 * "รวมของที่กำลังมา" on the stock table — #1153.
 *
 * One item has 20 kg in the ledger, an approved donation line of 30 kg, a `shipped` transfer of
 * 5 kg addressed to SH001, and a free-text approved line that cannot be matched to an item.
 *
 * The derivation is unit-tested; this suite pins what only a real stack shows:
 *  - the switch is off by default and the row keeps its in-stock number,
 *  - `incoming=1` adds donation + transfer to the number and prints the caption under the bar,
 *  - the popover names each document the goods come from,
 *  - the "ยังไม่จับคู่" strip counts the free-text line,
 *  - the switch is disabled (with a reason) in the "ซื้อเอง" view.
 *
 * Data (README §4): one `inc_*` CouchDB user, one `item_master`, one ledger row and one donation
 * on the seeded SH001, one transfer in `central_ops` — all removed in afterAll, with a leak check.
 */

const TAGS = { tag: ['@critical', '@supply'] };

const RUN_ID = `inc_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
const SHELTER_DB = 'shelter_sh001';
const CATALOG_DB = 'catalog';
const CENTRAL_DB = 'central_ops';

const USER: TestUser = {
	name: `wh_${RUN_ID}`,
	password: 'Password1!',
	roles: ['shelter:SH001', 'warehouse_staff'],
	display_name: 'Incoming stock E2E'
};

const itemId = `item_master:${ulid()}`;
const itemName = `E2E ข้าวสาร ${RUN_ID}`;
const ledgerId = `stock_ledger:${ulid()}`;
const donationId = `donation:${ulid()}`;
const transferId = `stock_transfer:${ulid()}`;
const BOOKING_REF = `DN-${RUN_ID}`;

const seeded: Array<[db: string, id: string]> = [
	[CATALOG_DB, itemId],
	[SHELTER_DB, ledgerId],
	[SHELTER_DB, donationId],
	[CENTRAL_DB, transferId]
];

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString();

let session = '';

test.describe('Incoming stock switch (/back-office/supply)', TAGS, () => {
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
			sku: `E2E-RICE-${RUN_ID}`,
			base_unit: 'kg',
			conversions: [],
			default_inventory_uom: 'kg',
			default_issue_uom: 'kg',
			distribution_type: 'recurring',
			type_class: 'CONSUMABLE',
			deactivated: false,
			dietary: [],
			returnable: false,
			shelf_life_days: 365
		});

		await putDocument(SHELTER_DB, {
			_id: ledgerId,
			type: 'stock_ledger',
			schema_v: 7,
			shelter_code: 'SH001',
			created_at: now,
			updated_at: now,
			created_by: USER.name,
			item_id: itemId,
			unit: 'kg',
			ref_id: null,
			qty: '20',
			reason: 'donation',
			adjust_reason: null,
			lot_ref: ledgerId,
			occurred_at: day(-1),
			lot: { lot_no: `L-${RUN_ID}`, expiry: null, produced_at: day(-1) }
		});

		await putDocument(SHELTER_DB, {
			_id: donationId,
			type: 'donation',
			schema_v: 11,
			channel: 'public',
			shelter_code: 'SH001',
			created_at: now,
			updated_at: now,
			declared_at: now,
			expires_at: day(3),
			created_by: USER.name,
			booking_ref: BOOKING_REF,
			kind: 'items',
			donor: { name: 'E2E Donor', phone: null, phone_hash: null, line_id: null, email: null },
			items: [
				{
					item_id: itemId,
					category: 'food',
					qty: '30',
					unit: 'kg',
					condition: 'new',
					line_key: `${RUN_ID}-a`,
					reserved_qty: '30',
					review_status: 'approved'
				},
				{
					item_id: null,
					category: 'food',
					free_text: `E2E ของที่ไม่มีในแคตตาล็อก ${RUN_ID}`,
					qty: '2',
					unit: 'box',
					condition: 'new',
					line_key: `${RUN_ID}-b`,
					reserved_qty: '2',
					review_status: 'approved'
				}
			],
			logistics: {
				delivery_method: 'self_dropoff',
				vehicle: 'car',
				slot: { date: day(1).slice(0, 10), from: '09:00', to: '10:00' }
			},
			status: 'verifying',
			revisions: [],
			source: 'public'
		});

		await putDocument(CENTRAL_DB, {
			_id: transferId,
			type: 'stock_transfer',
			schema_v: 2,
			shelter_code: 'SH001',
			created_at: now,
			updated_at: now,
			created_by: USER.name,
			from_shelter: 'SH002',
			to_shelter: 'SH001',
			items: [{ item_id: itemId, qty: '5', unit: 'kg' }],
			status: 'shipped',
			timeline: {
				requested: { at: now, by: USER.name },
				shipped: { at: now, by: USER.name }
			}
		});
	});

	test.afterAll(async () => {
		if (!CAN_WRITE) return;
		const errors: Error[] = [];
		const owned = (db: string, d: { _id: string; created_by?: unknown }) =>
			seeded.some(([sdb, id]) => sdb === db && id === d._id) || d.created_by === USER.name;
		for (const db of [SHELTER_DB, CATALOG_DB, CENTRAL_DB]) {
			try {
				for (const doc of (await allDocuments(db)).filter((d) => owned(db, d))) {
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
			for (const db of [SHELTER_DB, CATALOG_DB, CENTRAL_DB]) {
				const left = (await allDocuments(db)).filter((d) => owned(db, d));
				if (left.length > 0) {
					errors.push(new Error(`Leak in ${db}: ${left.map((d) => d._id).join(', ')}`));
				}
			}
		} catch (err) {
			errors.push(err instanceof Error ? err : new Error(String(err)));
		}
		if (errors.length > 0) throw new AggregateError(errors, 'incoming e2e teardown failed');
	});

	test.beforeEach(async ({ page }) => {
		await routeBrowserCouchThroughApp(page);
		await injectSession(page, USER, session);
	});

	const search = encodeURIComponent(itemName);
	const stockRow = (page: import('@playwright/test').Page) =>
		page.getByRole('row').filter({ hasText: itemName });

	test('off by default: the row shows only what is in stock', async ({ page }) => {
		await page.goto(`/back-office/supply?q=${search}`);
		await expect(stockRow(page)).toContainText('20 กิโลกรัม', { timeout: 15_000 });
		await expect(stockRow(page)).not.toContainText('กำลังมา');
		await expect(page.getByText('ยังไม่จับคู่')).toHaveCount(0);
	});

	test('on: donation + transfer are added to the number and named in the caption', async ({
		page
	}) => {
		await page.goto(`/back-office/supply?q=${search}&incoming=1`);
		await expect(stockRow(page)).toContainText('55 กิโลกรัม', { timeout: 15_000 });
		await expect(stockRow(page)).toContainText('ในคลัง 20 · กำลังมา 35');
		// The free-text line cannot be added to any row, so it is counted apart.
		await expect(page.getByText('ยังไม่จับคู่')).toBeVisible();
	});

	test('the popover names each document the goods come from', async ({ page }) => {
		await page.goto(`/back-office/supply?q=${search}&incoming=1`);
		await expect(stockRow(page)).toContainText('55 กิโลกรัม', { timeout: 15_000 });
		await page
			.getByRole('button', { name: `รายการของที่กำลังมา ${itemName}` })
			.first()
			.click();
		const popover = page.locator('[data-slot="popover-content"]');
		await expect(popover).toContainText(BOOKING_REF);
		await expect(popover).toContainText(transferId);
		// A warehouse user may open the transfer page.
		await expect(popover.locator('a[href*="tab=transfer"]')).toHaveCount(1);
	});

	test('the switch is disabled in the "ซื้อเอง" view', async ({ page }) => {
		await page.goto(`/back-office/supply?q=${search}&sp=1&incoming=1`);
		await expect(page.locator('#stock-incoming')).toBeDisabled({ timeout: 15_000 });
		await expect(stockRow(page).or(page.getByText('ไม่พบ'))).not.toContainText('กำลังมา');
	});
});
