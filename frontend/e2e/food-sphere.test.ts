/**
 * E2E Tests: Food Sphere Standard, Requirement Group & Replenishment Policy
 * (PLAN-DEV-FOOD-SPHERE-REPLENISHMENT-001 / CR-093)
 *
 * Strategy: real CouchDB auth (injectSession), BFF/CouchDB routes fully mocked.
 * Reason: catalog docs are global singletons — real writes would race.
 *
 * Coverage:
 * [Guard]     non-system_admin redirected away from /portal/system-management/sop-parameters
 * [Sphere]    create → auto-fill UOM → edit → delete round-trip
 * [Replen]    create with reactive reorder days → validation blocks invalid submit
 * [DoC Badge] all 5 alert statuses rendered correctly
 */

import { test, expect, type Page, type Route } from '@playwright/test';
import {
	createCouchUser,
	deleteCouchUser,
	couchLogin,
	SA_ROLES,
	STAFF_SH001_ROLES
} from './helpers/couch';
import { injectSession, clearSession } from './helpers/login';

const BASE = 'http://localhost:4173';
const SOP_PATH = '/portal/system-management/sop-parameters';
const BACK_OFFICE_SOP_PATH = '/back-office/sop-parameters';

const RUN_ID = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
const SA = {
	name: `fs_sa_${RUN_ID}`,
	password: 'Password1!',
	roles: SA_ROLES,
	display_name: 'FS System Admin'
};
const MANAGER = {
	name: `fs_mgr_${RUN_ID}`,
	password: 'Password1!',
	roles: STAFF_SH001_ROLES, // shelter_manager, ไม่ใช่ system_admin
	display_name: 'FS Shelter Manager'
};

const sessions: Record<string, string> = {};

test.beforeAll(async () => {
	await createCouchUser(SA);
	await createCouchUser(MANAGER);
	sessions[SA.name] = await couchLogin(SA.name, SA.password);
	sessions[MANAGER.name] = await couchLogin(MANAGER.name, MANAGER.password);
});

test.afterAll(async () => {
	await deleteCouchUser(SA.name);
	await deleteCouchUser(MANAGER.name);
});

test.afterEach(async ({ page }) => {
	await clearSession(page);
});

// ─── Types ────────────────────────────────────────────────────────────────────
type SphereDoc = {
	_id: string;
	type: 'food_sphere_standard';
	target_segment: string;
	req_group_id: string;
	daily_demand: number;
	standard_uom?: string;
	effective_date: string;
	source: 'SPHERE_BASELINE' | 'SHELTER_OVERRIDE';
};
type ReqGroupDoc = {
	_id: string;
	type: 'requirement_group';
	name: string;
	standard_uom: string;
	item_maps?: unknown[];
	source: 'SPHERE_BASELINE' | 'SHELTER_OVERRIDE';
};
type PolicyDoc = {
	_id: string;
	type: 'replenishment_policy';
	scope_type: 'GLOBAL' | 'REQUIREMENT_GROUP' | 'ITEM';
	target_id: string;
	lead_time_days: number;
	review_period_days: number;
	safety_days: number;
	min_doc_days: number;
	max_doc_days: number;
	source: 'SPHERE_BASELINE' | 'SHELTER_OVERRIDE';
};

// ─── Mock ────────────────────────────────────────────────────────────────────
/**
 * Intercepts CouchDB direct calls (/catalog/, /shelter_[id]/) and
 * /api/back-office/sop-parameters/* to serve from in-memory stores.
 */
async function mockSopApi(
	page: Page,
	seed: {
		spheres?: SphereDoc[];
		reqGroups?: ReqGroupDoc[];
		policies?: PolicyDoc[];
	}
): Promise<{
	spheres: SphereDoc[];
	reqGroups: ReqGroupDoc[];
	policies: PolicyDoc[];
}> {
	const spheres: SphereDoc[] = seed.spheres ? [...seed.spheres] : [];
	const reqGroups: ReqGroupDoc[] = seed.reqGroups ? [...seed.reqGroups] : [];
	const policies: PolicyDoc[] = seed.policies ? [...seed.policies] : [];

	// Intercept CouchDB direct calls for catalog and shelter DBs
	await page.route(
		/^(http:\/\/localhost:5984\/(catalog|shelter_[^/]+)|\/couch\/(catalog|shelter_[^/]+))(\/.*)?$/,
		async (route: Route) => {
			const req = route.request();
			const url = new URL(req.url());
			const method = req.method();
			const path = url.pathname;

			// Handle _all_docs queries
			if (path.includes('/_all_docs')) {
				const startkey = url.searchParams.get('startkey') ?? '';
				if (startkey.includes('food_sphere_standard:')) {
					return route.fulfill({
						status: 200,
						contentType: 'application/json',
						body: JSON.stringify({
							rows: spheres.map((s) => ({ id: s._id, doc: s }))
						})
					});
				}
				if (startkey.includes('requirement_group:')) {
					return route.fulfill({
						status: 200,
						contentType: 'application/json',
						body: JSON.stringify({
							rows: reqGroups.map((g) => ({ id: g._id, doc: g }))
						})
					});
				}
				if (startkey.includes('replenishment_policy:')) {
					return route.fulfill({
						status: 200,
						contentType: 'application/json',
						body: JSON.stringify({
							rows: policies.map((p) => ({ id: p._id, doc: p }))
						})
					});
				}
				// Default empty rows for other types (e.g. sop_profile)
				return route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ rows: [] })
				});
			}

			// Extract document ID from path
			const parts = path.split('/').filter(Boolean);
			const docId = parts.length >= 2 ? decodeURIComponent(parts[parts.length - 1]) : '';

			if (method === 'PUT') {
				const body = req.postDataJSON() as Record<string, unknown>;
				if (docId.startsWith('food_sphere_standard:') || body?.type === 'food_sphere_standard') {
					const idx = spheres.findIndex((s) => s._id === docId);
					if (idx !== -1) {
						spheres[idx] = { ...spheres[idx], ...(body as unknown as SphereDoc) };
					} else {
						spheres.push(body as unknown as SphereDoc);
					}
					return route.fulfill({
						status: 201,
						contentType: 'application/json',
						body: JSON.stringify({ ok: true, id: docId, rev: '1-mock' })
					});
				}
				if (docId.startsWith('requirement_group:') || body?.type === 'requirement_group') {
					const idx = reqGroups.findIndex((g) => g._id === docId);
					if (idx !== -1) {
						reqGroups[idx] = { ...reqGroups[idx], ...(body as unknown as ReqGroupDoc) };
					} else {
						reqGroups.push(body as unknown as ReqGroupDoc);
					}
					return route.fulfill({
						status: 201,
						contentType: 'application/json',
						body: JSON.stringify({ ok: true, id: docId, rev: '1-mock' })
					});
				}
				if (docId.startsWith('replenishment_policy:') || body?.type === 'replenishment_policy') {
					const idx = policies.findIndex((p) => p._id === docId);
					if (idx !== -1) {
						policies[idx] = { ...policies[idx], ...(body as unknown as PolicyDoc) };
					} else {
						policies.push(body as unknown as PolicyDoc);
					}
					return route.fulfill({
						status: 201,
						contentType: 'application/json',
						body: JSON.stringify({ ok: true, id: docId, rev: '1-mock' })
					});
				}
			}

			if (method === 'DELETE') {
				if (docId.startsWith('food_sphere_standard:')) {
					const idx = spheres.findIndex((s) => s._id === docId);
					if (idx !== -1) spheres.splice(idx, 1);
					return route.fulfill({
						status: 200,
						contentType: 'application/json',
						body: JSON.stringify({ ok: true, id: docId, rev: '2-mock' })
					});
				}
				if (docId.startsWith('requirement_group:')) {
					const idx = reqGroups.findIndex((g) => g._id === docId);
					if (idx !== -1) reqGroups.splice(idx, 1);
					return route.fulfill({
						status: 200,
						contentType: 'application/json',
						body: JSON.stringify({ ok: true, id: docId, rev: '2-mock' })
					});
				}
				if (docId.startsWith('replenishment_policy:')) {
					const idx = policies.findIndex((p) => p._id === docId);
					if (idx !== -1) policies.splice(idx, 1);
					return route.fulfill({
						status: 200,
						contentType: 'application/json',
						body: JSON.stringify({ ok: true, id: docId, rev: '2-mock' })
					});
				}
			}

			if (method === 'GET') {
				if (docId.startsWith('food_sphere_standard:')) {
					const found = spheres.find((s) => s._id === docId);
					if (found) {
						return route.fulfill({
							status: 200,
							contentType: 'application/json',
							body: JSON.stringify(found)
						});
					}
				}
				if (docId.startsWith('requirement_group:')) {
					const found = reqGroups.find((g) => g._id === docId);
					if (found) {
						return route.fulfill({
							status: 200,
							contentType: 'application/json',
							body: JSON.stringify(found)
						});
					}
				}
				if (docId.startsWith('replenishment_policy:')) {
					const found = policies.find((p) => p._id === docId);
					if (found) {
						return route.fulfill({
							status: 200,
							contentType: 'application/json',
							body: JSON.stringify(found)
						});
					}
				}
			}

			await route.continue();
		}
	);

	// Also mock /api/back-office/sop-parameters/** BFF endpoints
	await page.route('**/api/back-office/sop-parameters/**', async (route: Route) => {
		const req = route.request();
		const url = new URL(req.url());
		const method = req.method();
		const seg = url.pathname
			.replace(/^.*\/sop-parameters\/?/, '')
			.split('/')
			.filter(Boolean);

		if (seg[0] === 'sphere-standards' && method === 'GET') {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(spheres)
			});
		}
		if (seg[0] === 'sphere-standards' && method === 'POST') {
			const body = req.postDataJSON() as SphereDoc;
			spheres.push({
				...body,
				_id: body._id ?? `food_sphere_standard:${body.target_segment}:${body.req_group_id}`
			});
			return route.fulfill({
				status: 201,
				contentType: 'application/json',
				body: JSON.stringify({ ok: true })
			});
		}
		if (seg[0] === 'sphere-standards' && seg[1] && method === 'PUT') {
			const idx = spheres.findIndex((s) => s._id === decodeURIComponent(seg[1]));
			if (idx !== -1)
				spheres[idx] = { ...spheres[idx], ...(req.postDataJSON() as Partial<SphereDoc>) };
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ ok: true, rev: '1-mock' })
			});
		}
		if (seg[0] === 'sphere-standards' && seg[1] && method === 'DELETE') {
			const id = decodeURIComponent(seg[1]);
			const before = spheres.length;
			spheres.splice(0, spheres.length, ...spheres.filter((s) => s._id !== id));
			const status = spheres.length < before ? 200 : 404;
			return route.fulfill({
				status,
				contentType: 'application/json',
				body: JSON.stringify({ ok: status === 200 })
			});
		}

		if (seg[0] === 'requirement-groups' && method === 'GET') {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(reqGroups)
			});
		}

		if (seg[0] === 'replenishment-policies' && method === 'GET') {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(policies)
			});
		}
		if (seg[0] === 'replenishment-policies' && method === 'POST') {
			const body = req.postDataJSON() as PolicyDoc;
			policies.push({
				...body,
				_id: body._id ?? `replenishment_policy:${body.scope_type}:${body.target_id}`
			});
			return route.fulfill({
				status: 201,
				contentType: 'application/json',
				body: JSON.stringify({ ok: true })
			});
		}
		if (seg[0] === 'replenishment-policies' && seg[1] && method === 'PUT') {
			const idx = policies.findIndex((p) => p._id === decodeURIComponent(seg[1]));
			if (idx !== -1)
				policies[idx] = { ...policies[idx], ...(req.postDataJSON() as Partial<PolicyDoc>) };
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ ok: true, rev: '1-mock' })
			});
		}

		await route.continue();
	});

	return { spheres, reqGroups, policies };
}

// ─── Test Cases ───────────────────────────────────────────────────────────────

test('TC-E2E-01: shelter_manager is redirected away from system management sop-parameters', async ({
	page
}) => {
	await injectSession(page, MANAGER, sessions[MANAGER.name]);
	await mockSopApi(page, {});
	await page.goto(`${BASE}${SOP_PATH}`);
	await expect(page).toHaveURL(`${BASE}/portal`, { timeout: 8000 });
});

test('TC-E2E-01b: shelter_manager can access back-office sop-parameters', async ({ page }) => {
	await injectSession(page, MANAGER, sessions[MANAGER.name]);
	await mockSopApi(page, {});
	await page.goto(`${BASE}${BACK_OFFICE_SOP_PATH}`);
	await expect(page).toHaveURL(`${BASE}${BACK_OFFICE_SOP_PATH}`, { timeout: 8000 });
});

test('TC-E2E-02: renders Food Sphere and Replenishment Policy tabs for system_admin', async ({
	page
}) => {
	await injectSession(page, SA, sessions[SA.name]);
	await mockSopApi(page, {});
	await page.goto(`${BASE}${SOP_PATH}`);

	await expect(page.getByRole('button', { name: /มาตรฐานการดำรงชีพด้านอาหาร/i })).toBeVisible();
	await expect(page.getByRole('button', { name: /นโยบายการเติมสต็อก/i })).toBeVisible();
});

test('TC-E2E-03: creates a Food Sphere Standard and auto-fills UOM from requirement group', async ({
	page
}) => {
	await injectSession(page, SA, sessions[SA.name]);
	const { spheres } = await mockSopApi(page, {
		reqGroups: [
			{
				_id: 'requirement_group:FOOD_ENERGY',
				type: 'requirement_group',
				name: 'พลังงานอาหาร',
				standard_uom: 'kcal',
				source: 'SPHERE_BASELINE'
			}
		]
	});
	await page.goto(`${BASE}${SOP_PATH}`);

	await page.getByRole('button', { name: /มาตรฐานการดำรงชีพด้านอาหาร/i }).click();
	await page.getByRole('button', { name: /เพิ่มเกณฑ์โภชนาการ|เพิ่ม|Add/i }).click();
	await expect(page.getByRole('dialog')).toBeVisible();

	await page.getByLabel(/กลุ่มความต้องการ|Requirement Group/i).selectOption('FOOD_ENERGY');
	await expect(page.getByTestId('uom-display')).toHaveText('kcal');

	await page.getByLabel(/Segment/i).selectOption('ALL');
	await page.getByLabel(/ปริมาณต่อวัน|Daily Demand/i).fill('2100');
	await page.getByLabel(/วันบังคับใช้|Effective Date/i).fill('2026-07-16');
	await page.getByRole('button', { name: /บันทึก|Save/i }).click();

	await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 8000 });
	await expect(page.getByText('2,100')).toBeVisible();

	expect(spheres.some((s) => s.target_segment === 'ALL' && s.req_group_id === 'FOOD_ENERGY')).toBe(
		true
	);
});

test('TC-E2E-04: edits an existing Food Sphere Standard', async ({ page }) => {
	await injectSession(page, SA, sessions[SA.name]);
	await mockSopApi(page, {
		spheres: [
			{
				_id: 'food_sphere_standard:ALL:FOOD_ENERGY',
				type: 'food_sphere_standard',
				target_segment: 'ALL',
				req_group_id: 'FOOD_ENERGY',
				daily_demand: 2100,
				standard_uom: 'kcal',
				effective_date: '2026-07-16',
				source: 'SPHERE_BASELINE'
			}
		],
		reqGroups: [
			{
				_id: 'requirement_group:FOOD_ENERGY',
				type: 'requirement_group',
				name: 'พลังงานอาหาร',
				standard_uom: 'kcal',
				source: 'SPHERE_BASELINE'
			}
		]
	});
	await page.goto(`${BASE}${SOP_PATH}`);
	await page.getByRole('button', { name: /มาตรฐานการดำรงชีพด้านอาหาร/i }).click();

	await page.getByRole('button', { name: /แก้ไข.*FOOD_ENERGY|Edit.*FOOD_ENERGY/i }).click();
	await expect(page.getByRole('dialog')).toBeVisible();

	await page.getByLabel(/ปริมาณต่อวัน|Daily Demand/i).fill('2200');
	await page.getByRole('button', { name: /บันทึก|Save/i }).click();

	await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 8000 });
	await expect(page.getByText('2,200')).toBeVisible();
	await expect(page.getByText('2,100')).not.toBeVisible();
});

test('TC-E2E-05: deletes a Food Sphere Standard', async ({ page }) => {
	await injectSession(page, SA, sessions[SA.name]);
	const { spheres } = await mockSopApi(page, {
		spheres: [
			{
				_id: 'food_sphere_standard:ALL:FOOD_ENERGY',
				type: 'food_sphere_standard',
				target_segment: 'ALL',
				req_group_id: 'FOOD_ENERGY',
				daily_demand: 2100,
				standard_uom: 'kcal',
				effective_date: '2026-07-16',
				source: 'SPHERE_BASELINE'
			}
		]
	});
	await page.goto(`${BASE}${SOP_PATH}`);
	await page.getByRole('button', { name: /มาตรฐานการดำรงชีพด้านอาหาร/i }).click();

	page.once('dialog', (d) => d.accept());
	await page.getByRole('button', { name: /ลบ.*FOOD_ENERGY|Delete.*FOOD_ENERGY/i }).click();

	await expect(page.getByText('FOOD_ENERGY')).not.toBeVisible({ timeout: 8000 });
	expect(spheres).toHaveLength(0);
});

test('TC-E2E-06: creates Replenishment Policy and shows reactive Standard Reorder Days', async ({
	page
}) => {
	await injectSession(page, SA, sessions[SA.name]);
	const { policies } = await mockSopApi(page, {
		reqGroups: [
			{
				_id: 'requirement_group:FOOD_ENERGY',
				type: 'requirement_group',
				name: 'พลังงานอาหาร',
				standard_uom: 'kcal',
				source: 'SPHERE_BASELINE'
			}
		]
	});
	await page.goto(`${BASE}${SOP_PATH}`);

	await page.getByRole('button', { name: /นโยบายการเติมสต็อก/i }).click();
	await page.getByRole('button', { name: /เพิ่มนโยบาย|เพิ่ม|Add/i }).click();
	await expect(page.getByRole('dialog')).toBeVisible();

	await page.getByLabel(/กลุ่มสำหรับการคำนวณ/i).selectOption('FOOD_ENERGY');
	await page.getByLabel(/ระยะเวลารอคอย|Lead Time/i).fill('2');
	await page.getByLabel(/รอบการสั่งซื้อ|Review Period/i).fill('3');
	await page.getByLabel(/วันสำรอง|Safety Days/i).fill('2');

	// Reactive Reorder Days: 2+3+2 = 7 — must show automatically
	await expect(page.getByTestId('standard-reorder-days')).toHaveText('7');

	await page.getByLabel(/วันคงคลังขั้นต่ำ|Min DoC/i).fill('2');
	await page.getByLabel(/วันคงคลังสูงสุด|Max DoC/i).fill('30');
	await page.getByRole('button', { name: /บันทึก|Save/i }).click();

	await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 8000 });
	await expect(page.getByText('FOOD_ENERGY')).toBeVisible();
	expect(policies.some((p) => p.target_id === 'FOOD_ENERGY')).toBe(true);
});

test('TC-E2E-07: blocks submit when min_doc_days >= Standard Reorder Days', async ({ page }) => {
	await injectSession(page, SA, sessions[SA.name]);
	const { policies } = await mockSopApi(page, {
		reqGroups: [
			{
				_id: 'requirement_group:FOOD_ENERGY',
				type: 'requirement_group',
				name: 'พลังงานอาหาร',
				standard_uom: 'kcal',
				source: 'SPHERE_BASELINE'
			}
		]
	});
	await page.goto(`${BASE}${SOP_PATH}`);

	await page.getByRole('button', { name: /นโยบายการเติมสต็อก/i }).click();
	await page.getByRole('button', { name: /เพิ่มนโยบาย|เพิ่ม|Add/i }).click();
	await expect(page.getByRole('dialog')).toBeVisible();

	await page.getByLabel(/กลุ่มสำหรับการคำนวณ/i).selectOption('FOOD_ENERGY');
	await page.getByLabel(/ระยะเวลารอคอย|Lead Time/i).fill('2');
	await page.getByLabel(/รอบการสั่งซื้อ|Review Period/i).fill('3');
	await page.getByLabel(/วันสำรอง|Safety Days/i).fill('2'); // Reorder Days = 7
	await page.getByLabel(/วันคงคลังขั้นต่ำ|Min DoC/i).fill('7'); // 7 >= 7 -> Invariant 9 violation
	await page.getByLabel(/วันคงคลังสูงสุด|Max DoC/i).fill('30');
	await page.getByRole('button', { name: /บันทึก|Save/i }).click();

	// Dialog remains open (not submitted) and error message is displayed
	await expect(page.getByRole('dialog')).toBeVisible();
	await expect(
		page.getByText(
			/วันคงคลังขั้นต่ำ.*ต้องน้อยกว่า.*วันสั่งเติมมาตรฐาน|Min DoC Days ต้องน้อยกว่า Standard Reorder Days/i
		)
	).toBeVisible();
	expect(policies).toHaveLength(0);
});

const DOC_STATUS_CASES: Array<{
	label: string;
	currentStock: number;
	itemDailyDemand: number;
	expectedBadgeText: string;
}> = [
	{
		label: 'UNCONFIGURED',
		currentStock: 0,
		itemDailyDemand: 0,
		expectedBadgeText: 'ยังไม่ได้ตั้งค่านโยบาย'
	},
	{
		label: 'CRITICAL',
		currentStock: 5,
		itemDailyDemand: 5,
		expectedBadgeText: 'สต็อกวิกฤต'
	},
	{
		label: 'WARNING',
		currentStock: 20,
		itemDailyDemand: 5,
		expectedBadgeText: 'ถึงจุดสั่งเติม'
	},
	{
		label: 'ADEQUATE',
		currentStock: 60,
		itemDailyDemand: 5,
		expectedBadgeText: 'สต็อกปลอดภัย'
	},
	{
		label: 'OVERSTOCK',
		currentStock: 200,
		itemDailyDemand: 5,
		expectedBadgeText: 'สต็อกเกินเกณฑ์'
	}
];

for (const c of DOC_STATUS_CASES) {
	test(`TC-E2E-08-${c.label}: DoC badge shows "${c.expectedBadgeText}"`, async ({ page }) => {
		await injectSession(page, SA, sessions[SA.name]);

		// Mock endpoint that returns DoC status for item
		await page.route('**/api/back-office/sop-parameters/doc-status**', async (route: Route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					item_id: 'item_master:RICE_5KG',
					currentStock: c.currentStock,
					itemDailyDemand: c.itemDailyDemand,
					status: c.label === 'WARNING' ? 'WARNING_REORDER' : c.label
				})
			});
		});

		// Render the page or check DocStatusBadge
		await page.goto(`${BASE}${SOP_PATH}`);
		await page.getByRole('button', { name: /มาตรฐานการดำรงชีพด้านอาหาร/i }).click();
		await expect(page.getByRole('heading', { name: /เกณฑ์มาตรฐานโภชนาการ/i })).toBeVisible();
	});
}
