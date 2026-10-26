import { test, expect, type Page } from '@playwright/test';
import {
	APP_BASE_URL,
	COUCH_BASE,
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
 * E2E: shelter storage points in the stock UIs (#647, draft-storage-point-multi-type).
 *
 * The shelter's `common_areas.sub_storage` is patched into the real `registry` read
 * (SH001 is shared — its master doc is never written); ledger lots are real docs in
 * `shelter_sh001`, removed in afterAll.
 *
 * Covers:
 * 1. Receive form: each "สถานที่จัดเก็บ" option shows what the point can hold (desktop + mobile)
 * 2. Stock filter "ที่เก็บ": configured points (incl. one never received into) + ledger-only
 *    names of lots still on the shelf + "คลังหลัก" — never an outbound row's destination or an
 *    emptied lot's place (merge with #569)
 * 3. Filtering by a point / "คลังหลัก" narrows the table
 * 4. #647 AC3 — the stock page shows what each point can hold: in the "ที่เก็บ" options and
 *    under each lot in the item detail panel
 */

const RUN_ID = `ssp_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
const SHELTER_CODE = 'SH001';
const SHELTER_DB = 'shelter_sh001';
const CATALOG_DB = 'catalog';

const WH_STAFF: TestUser = {
	name: `wh_ssp_${RUN_ID}`,
	password: 'Password1!',
	roles: [`shelter:${SHELTER_CODE}`, 'warehouse_staff'],
	display_name: 'Storage Points E2E'
};

const POINT_FOOD = {
	id: `e2e-sp-food-${RUN_ID}`,
	name: `E2E ห้องอาหาร ${RUN_ID}`,
	types: ['food_dry', 'drinking_water'],
	area_m2: null
};
/** Configured but never received into — must still be a filter option. */
const POINT_MEDS = {
	id: `e2e-sp-meds-${RUN_ID}`,
	name: `E2E ห้องยา ${RUN_ID}`,
	types: ['medical_supplies'],
	area_m2: null
};
const LEGACY_ZONE = `E2E ห้องเก่า ${RUN_ID}`;
const EMPTIED_ZONE = `E2E ห้องว่าง ${RUN_ID}`;
const DESTINATION = `E2E อาคารปลายทาง ${RUN_ID}`;

const itemAId = `item_master:${ulid()}`;
const itemAName = `E2E น้ำดื่มขวด ${RUN_ID}`;
const itemBId = `item_master:${ulid()}`;
const itemBName = `E2E ผ้าห่ม ${RUN_ID}`;

const testUsernames = new Set<string>([WH_STAFF.name]);
const ownedShelterDocIds = new Set<string>();
const ownedCatalogDocIds = new Set<string>();
const sessions: Record<string, string> = {};

async function seedItem(id: string, name: string, sku: string): Promise<void> {
	const nowIso = new Date().toISOString();
	await putDocument(CATALOG_DB, {
		_id: id,
		type: 'item_master',
		schema_v: 4,
		created_at: nowIso,
		updated_at: nowIso,
		created_by: WH_STAFF.name,
		name,
		category: 'item_category:food',
		sku,
		base_unit: 'piece',
		conversions: [],
		default_inventory_uom: 'piece',
		default_issue_uom: 'piece',
		distribution_type: 'recurring',
		type_class: 'CONSUMABLE',
		deactivated: false,
		dietary: [],
		returnable: false,
		shelf_life_days: 365
	});
	ownedCatalogDocIds.add(id);
}

async function seedLedger(row: {
	itemId: string;
	qty: string;
	reason: 'receive' | 'distribute';
	lotRef: string;
	lot: Record<string, unknown>;
	id?: string;
}): Promise<void> {
	const nowIso = new Date().toISOString();
	const id = row.id ?? `stock_ledger:${ulid()}`;
	await putDocument(SHELTER_DB, {
		_id: id,
		type: 'stock_ledger',
		schema_v: 6,
		shelter_code: SHELTER_CODE,
		created_at: nowIso,
		updated_at: nowIso,
		created_by: WH_STAFF.name,
		item_id: row.itemId,
		qty: row.qty,
		unit: 'piece',
		reason: row.reason,
		adjust_reason: null,
		ref_id: row.reason === 'distribute' ? `requisition_ticket:${ulid()}` : null,
		lot_ref: row.lotRef,
		occurred_at: nowIso,
		lot: row.lot
	});
	ownedShelterDocIds.add(id);
}

/**
 * Serve SH001's real master doc with this run's storage points. Registered after
 * {@link routeBrowserCouchThroughApp}, so it wins for `registry/_all_docs` only.
 */
async function withStoragePoints(page: Page): Promise<void> {
	await page.route(`${COUCH_BASE}/registry/_all_docs*`, async (route) => {
		const request = route.request();
		const target = new URL(request.url());
		const corsHeaders = {
			'access-control-allow-origin': new URL(APP_BASE_URL).origin,
			'access-control-allow-credentials': 'true',
			'access-control-allow-methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
			'access-control-allow-headers':
				request.headers()['access-control-request-headers'] ?? 'Content-Type, Accept'
		};
		if (request.method() === 'OPTIONS') {
			await route.fulfill({ status: 204, headers: corsHeaders });
			return;
		}
		const response = await route
			.fetch({ url: `${APP_BASE_URL}/couch${target.pathname}${target.search}` })
			.catch(() => null);
		if (!response) return;
		const body = (await response.json()) as {
			rows?: { doc?: Record<string, unknown> & { code?: string; type?: string } }[];
		};
		for (const row of body.rows ?? []) {
			if (row.doc?.type === 'shelter' && row.doc.code === SHELTER_CODE) {
				const commonAreas = (row.doc.common_areas ?? {}) as Record<string, unknown>;
				row.doc.common_areas = { ...commonAreas, sub_storage: [POINT_FOOD, POINT_MEDS] };
			}
		}
		await route
			.fulfill({ response, json: body, headers: { ...response.headers(), ...corsHeaders } })
			.catch(() => undefined);
	});
}

/** A "ที่เก็บ" filter option; its text may carry a second line of type labels. */
function locationOption(page: Page, name: string) {
	return page.getByRole('option').filter({ hasText: name });
}

async function openSupply(page: Page): Promise<void> {
	await routeBrowserCouchThroughApp(page);
	await withStoragePoints(page);
	await injectSession(page, WH_STAFF, sessions[WH_STAFF.name]);
	await page.goto('/back-office/supply');
	await expect(page.getByRole('heading', { name: 'คลังของศูนย์' })).toBeVisible({
		timeout: 10_000
	});
}

test.describe('Storage points in stock UIs (#647)', () => {
	test.describe.configure({ mode: 'serial' });

	test.beforeAll(async () => {
		await createCouchUser(WH_STAFF);
		await seedSecurityQuestion(WH_STAFF.name);
		sessions[WH_STAFF.name] = await couchLogin(WH_STAFF.name, WH_STAFF.password);

		await seedItem(itemAId, itemAName, `E2E-WATER-${RUN_ID}`);
		await seedItem(itemBId, itemBName, `E2E-BLANKET-${RUN_ID}`);

		// Item A — lot in POINT_FOOD, partly handed out to DESTINATION (outbound `lot.note`)
		const lotFood = `stock_ledger:${ulid()}`;
		await seedLedger({
			id: lotFood,
			itemId: itemAId,
			qty: '10',
			reason: 'receive',
			lotRef: lotFood,
			lot: { lot_no: 'L-SSP-001', storage_point_id: POINT_FOOD.id, storage_zone: POINT_FOOD.name }
		});
		await seedLedger({
			itemId: itemAId,
			qty: '-4',
			reason: 'distribute',
			lotRef: lotFood,
			lot: { lot_no: 'L-SSP-001', note: DESTINATION }
		});

		// Item A — lot with no location (main store)
		const lotMain = `stock_ledger:${ulid()}`;
		await seedLedger({
			id: lotMain,
			itemId: itemAId,
			qty: '3',
			reason: 'receive',
			lotRef: lotMain,
			lot: { lot_no: 'L-SSP-002' }
		});

		// Item A — lot fully handed out: its place is no longer a filter option
		const lotEmptied = `stock_ledger:${ulid()}`;
		await seedLedger({
			id: lotEmptied,
			itemId: itemAId,
			qty: '2',
			reason: 'receive',
			lotRef: lotEmptied,
			lot: { lot_no: 'L-SSP-003', storage_zone: EMPTIED_ZONE }
		});
		await seedLedger({
			itemId: itemAId,
			qty: '-2',
			reason: 'distribute',
			lotRef: lotEmptied,
			lot: { lot_no: 'L-SSP-003', storage_zone: EMPTIED_ZONE }
		});

		// Item B — lot under a free-text name that is not a configured point (legacy)
		const lotLegacy = `stock_ledger:${ulid()}`;
		await seedLedger({
			id: lotLegacy,
			itemId: itemBId,
			qty: '7',
			reason: 'receive',
			lotRef: lotLegacy,
			lot: { lot_no: 'L-SSP-004', storage_zone: LEGACY_ZONE }
		});
	});

	test.afterEach(async ({ page }) => {
		await page.unrouteAll({ behavior: 'ignoreErrors' });
		await clearSession(page);
	});

	test.afterAll(async () => {
		const errors: Error[] = [];
		const purge = async (db: string, owned: Set<string>) => {
			const docs = await allDocuments(db);
			const toDelete = docs.filter(
				(d) =>
					owned.has(d._id) || (typeof d.created_by === 'string' && testUsernames.has(d.created_by))
			);
			const results = await Promise.allSettled(toDelete.map((doc) => deleteDocument(db, doc)));
			for (const r of results) {
				if (r.status === 'rejected') {
					errors.push(r.reason instanceof Error ? r.reason : new Error(String(r.reason)));
				}
			}
		};
		for (const [db, owned] of [
			[SHELTER_DB, ownedShelterDocIds],
			[CATALOG_DB, ownedCatalogDocIds]
		] as const) {
			try {
				await purge(db, owned);
				const left = (await allDocuments(db)).filter((d) => owned.has(d._id));
				if (left.length > 0) {
					errors.push(new Error(`${db} leak: ${left.map((d) => d._id).join(', ')}`));
				}
			} catch (err) {
				errors.push(err instanceof Error ? err : new Error(String(err)));
			}
		}
		try {
			await deleteCouchUser(WH_STAFF.name);
		} catch (err) {
			errors.push(err instanceof Error ? err : new Error(String(err)));
		}
		if (errors.length > 0) {
			throw new AggregateError(errors, `Failed to cleanly teardown E2E run ${RUN_ID}`);
		}
	});

	test('receive form: each storage point option shows what it can hold', async ({ page }) => {
		await openSupply(page);

		await page.getByRole('button', { name: 'รับเข้า', exact: true }).first().click();
		const dialog = page.getByRole('dialog');
		await dialog.getByLabel('สถานที่จัดเก็บ (จุดเก็บของของศูนย์)').click();

		const foodOption = page.getByRole('option', { name: `📍 ${POINT_FOOD.name}` });
		await expect(foodOption).toBeVisible();
		await expect(foodOption).toContainText('อาหารแห้ง, น้ำดื่ม');
		const medsOption = page.getByRole('option', { name: `📍 ${POINT_MEDS.name}` });
		await expect(medsOption).toContainText('ยา');
		await expect(page.getByRole('option', { name: 'ไม่ระบุ (คลังหลัก)' })).toBeVisible();

		// Picking an option closes the list and shows the point name alone on the trigger
		await foodOption.click();
		await expect(dialog.getByLabel('สถานที่จัดเก็บ (จุดเก็บของของศูนย์)')).toHaveText(
			`📍 ${POINT_FOOD.name}`
		);
	});

	test('receive form on mobile: the type line stays inside the screen', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await openSupply(page);

		await page.getByRole('button', { name: 'รับเข้า', exact: true }).last().click();
		const dialog = page.getByRole('dialog');
		await dialog.getByLabel('สถานที่จัดเก็บ (จุดเก็บของของศูนย์)').click();

		const foodOption = page.getByRole('option', { name: `📍 ${POINT_FOOD.name}` });
		await expect(foodOption).toContainText('อาหารแห้ง, น้ำดื่ม');
		const box = await foodOption.boundingBox();
		expect(box).not.toBeNull();
		expect(box!.x).toBeGreaterThanOrEqual(0);
		expect(box!.x + box!.width).toBeLessThanOrEqual(390);
	});

	test('stock filter "ที่เก็บ" lists places that hold stock, never a destination', async ({
		page
	}) => {
		await openSupply(page);

		await page.locator('[aria-label="กรองที่เก็บ"]').click();
		// #647 AC3 — a configured point shows what it can hold under its name
		await expect(locationOption(page, POINT_FOOD.name)).toContainText('อาหารแห้ง, น้ำดื่ม');
		await expect(locationOption(page, POINT_MEDS.name)).toContainText('ยา');
		await expect(page.getByRole('option', { name: LEGACY_ZONE, exact: true })).toBeVisible();
		await expect(page.getByRole('option', { name: 'คลังหลัก', exact: true })).toBeVisible();
		await expect(page.getByRole('option', { name: DESTINATION })).toHaveCount(0);
		await expect(page.getByRole('option', { name: EMPTIED_ZONE })).toHaveCount(0);
		await page.keyboard.press('Escape');
	});

	test('filtering by a point or "คลังหลัก" narrows the table', async ({ page }) => {
		await openSupply(page);
		const search = page.getByPlaceholder('ค้นหาชื่อ / SKU / สแกนบาร์โค้ด');
		await search.fill(RUN_ID);
		const rowA = page.getByRole('row').filter({ hasText: itemAName });
		const rowB = page.getByRole('row').filter({ hasText: itemBName });
		await expect(rowA).toBeVisible({ timeout: 10_000 });
		await expect(rowB).toBeVisible();

		const pick = async (name: string) => {
			await page.locator('[aria-label="กรองที่เก็บ"]').click();
			await locationOption(page, name).click();
		};

		await pick('คลังหลัก');
		await expect(page).toHaveURL(/loc=main/);
		await expect(rowA).toBeVisible();
		await expect(rowB).toHaveCount(0);

		await pick(LEGACY_ZONE);
		await expect(rowB).toBeVisible();
		await expect(rowA).toHaveCount(0);

		// A point nothing was received into yet: a valid filter with no rows of this run
		await pick(POINT_MEDS.name);
		await expect(rowA).toHaveCount(0);
		await expect(rowB).toHaveCount(0);
	});

	test('item detail: each lot shows what its storage point can hold (#647 AC3)', async ({
		page
	}) => {
		await openSupply(page);
		await page.getByPlaceholder('ค้นหาชื่อ / SKU / สแกนบาร์โค้ด').fill(itemAName);
		const row = page.getByRole('row').filter({ hasText: itemAName });
		await expect(row).toBeVisible({ timeout: 10_000 });
		await row.getByRole('button', { name: itemAName, exact: true }).click();

		const sheet = page.getByRole('dialog');
		await expect(sheet.getByRole('heading', { name: itemAName })).toBeVisible();
		await expect(sheet.getByText('เก็บได้: อาหารแห้ง, น้ำดื่ม')).toHaveCount(1);
		await page.keyboard.press('Escape');
	});
});
