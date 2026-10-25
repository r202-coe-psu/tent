/**
 * Distribution Desk — who may do what (plan §4.1, §4.2).
 *
 * - Page access: every capability from the role kernel in both CR-093 forms (flat /
 *   compound), plus SA and a scope-only user, against the desk (CR-161 R5: SA, SM, DST)
 *   and back-office (SA, SM, WH, SC); shelter-scope cases across shelters.
 * - Write permissions: actors write straight to CouchDB (no browser), proving the
 *   validate_doc_update boundary (CR-161 R3/R4/R6). A mismatch with CR-161 is a bug to
 *   report, not an expectation to relax.
 */

import type { Page } from '@playwright/test';
import { SHELTER_CAPABILITIES } from '../../src/lib/auth/roles';
import { ulid } from '../../src/lib/db/ulid';
import { expect, test } from './fixtures';
import {
	addScenarioActor,
	couchAsUser,
	getShelterDocument,
	roleSet,
	SA_ROLES,
	seedItemWithStock,
	seedTicket,
	shelterCode,
	shelterDb,
	shelterName,
	type DistributionScenario,
	type RoleForm,
	type SeedTicketStatus,
	type SeededItem
} from './distribution';
import { DeskPage } from './pages/desk.page';
import { consumable, DESK_TAGS } from './distribution-desk-setup';

const CREATED = 201;
const FORBIDDEN = 403;
/** A real shelter used only as "somewhere else" — visited and read, never written. */
const OTHER_SHELTER = 'SH002';

// Every capability from the role kernel in both CR-093 forms, plus SA and scope-only,
// against the desk (CR-161 R5: SA, SM, DST) and back-office (SA, SM, WH, SC). UI guards
// only — the VDU boundary is the last describe block.
const DESK_ROLES = new Set(['shelter_manager', 'distribution_staff']);

const BACK_OFFICE_ROLES = new Set(['shelter_manager', 'warehouse_staff', 'supply_coordinator']);

/** The desk navbar resolved the shelter list (CR central-db-shelter-scope-members regression). */
async function expectNavbarShelterLoaded(page: Page, code: string): Promise<void> {
	const navbar = page.locator('nav').first();
	await expect(navbar).toContainText(await shelterName(code));
	await expect(navbar).not.toContainText('เกิดข้อผิดพลาดในการโหลดข้อมูล');
}

async function expectDesk(page: Page, allowed: boolean, code = shelterCode()): Promise<void> {
	await page.goto('/onsite/distribution');
	if (allowed) {
		await expect(page).toHaveURL(/\/onsite\/distribution/);
		await expect(page.getByRole('heading', { name: /จุดแจกจ่ายพัสดุและอาหาร/ })).toBeVisible();
		await expectNavbarShelterLoaded(page, code);
	} else {
		await expect(page).toHaveURL(/\/portal/);
		await expect(page.getByRole('region', { name: 'บริบทการปฏิบัติงาน' })).toBeVisible();
	}
}

async function expectBackOffice(page: Page, allowed: boolean): Promise<void> {
	await page.goto('/back-office/distribution');
	if (allowed) {
		await expect(page).toHaveURL(/\/back-office\/distribution/);
		await expect(page.getByRole('heading', { name: 'ระบบเบิกจ่ายพัสดุและอาหาร' })).toBeVisible();
	} else {
		await expect(page).toHaveURL(/\/portal/);
		await expect(page.getByRole('region', { name: 'บริบทการปฏิบัติงาน' })).toBeVisible();
	}
}

interface Actor {
	label: string;
	roles: string[];
	expected: typeof CREATED | typeof FORBIDDEN;
}

function actor(label: string, roles: string[], allowed: boolean): Actor {
	return { label, roles, expected: allowed ? CREATED : FORBIDDEN };
}

/** Run `write` once per actor (fresh fixture each time) and compare the HTTP status. */
async function expectWrites(
	scenario: DistributionScenario,
	actors: Actor[],
	write: (session: string, name: string) => Promise<number>
): Promise<void> {
	const results: Record<string, number> = {};
	const expected: Record<string, number> = {};
	for (const a of actors) {
		const { user, session } = await addScenarioActor(scenario, a.label, a.roles);
		results[a.label] = await write(session, user.name);
		expected[a.label] = a.expected;
	}
	expect(results).toEqual(expected);
}

async function transition(
	scenario: DistributionScenario,
	item: SeededItem,
	from: SeedTicketStatus,
	change: (name: string) => Record<string, unknown>,
	session: string,
	name: string
): Promise<number> {
	const ticket = await seedTicket(scenario, {
		type: 'supplies',
		status: from,
		lines: [{ item, allocatedQty: '5' }]
	});
	const current = await getShelterDocument(ticket.ticketId);
	const res = await couchAsUser(
		session,
		'PUT',
		`/${shelterDb()}/${encodeURIComponent(ticket.ticketId)}`,
		{ ...current, ...change(name), updated_at: new Date().toISOString() }
	);
	return res.status;
}

test.describe(
	'Access — who may open the desk and back-office (plan §4.1)',
	{ tag: DESK_TAGS },
	() => {
		test.describe('page access by role', () => {
			test('system_admin reaches desk and back-office', async ({ page, scenarioAs }) => {
				await scenarioAs('rbac_sa', SA_ROLES);
				// SA holds no shelter scope; it works in whichever shelter it picked.
				await page.evaluate(
					(code) => localStorage.setItem('tent.activeShelterCode', code),
					shelterCode()
				);
				await expectDesk(page, true);
				await expectBackOffice(page, true);
			});

			test('a scope-only user reaches neither', async ({ page, scenarioAs }) => {
				await scenarioAs('rbac_scope_only', [`shelter:${shelterCode()}`]);
				await expectDesk(page, false);
				await expectBackOffice(page, false);
			});

			for (const capability of SHELTER_CAPABILITIES) {
				for (const form of ['flat', 'compound'] as RoleForm[]) {
					const desk = DESK_ROLES.has(capability);
					const backOffice = BACK_OFFICE_ROLES.has(capability);
					test(`${form} ${capability}: desk ${desk ? 'allowed' : 'denied'}, back-office ${backOffice ? 'allowed' : 'denied'}`, async ({
						page,
						scenarioAs
					}) => {
						await scenarioAs(`rbac_${form}_${capability}`, roleSet(capability, form));
						await expectDesk(page, desk);
						await expectBackOffice(page, backOffice);
					});
				}
			}
		});

		test.describe('shelter scope', () => {
			test("R-X1 distribution staff of another shelter never see this shelter's tickets", async ({
				page,
				scenarioAs
			}) => {
				const scenario = await scenarioAs(
					'rbac_cross_shelter',
					roleSet('distribution_staff', 'compound', OTHER_SHELTER)
				);
				const item = await seedItemWithStock(scenario, {
					name: `E2E cross shelter ${scenario.namespace}`,
					stockQty: '5',
					returnable: false,
					typeClass: 'CONSUMABLE'
				});
				const ticket = await seedTicket(scenario, {
					type: 'supplies',
					status: 'IN_TRANSIT',
					lines: [{ item, allocatedQty: '5' }]
				});

				await expectDesk(page, true, OTHER_SHELTER);
				const desk = new DeskPage(page);
				await desk.openTab('receive', 'supplies');
				await expect(page.getByText(`ศูนย์: ${OTHER_SHELTER}`)).toBeVisible();
				await expect(page.getByText(ticket.ticketNo, { exact: true })).toHaveCount(0);
			});

			test('R-X2 a multi-shelter user gets the desk only in the shelter where they are DST', async ({
				page,
				scenarioAs
			}) => {
				const code = shelterCode();
				await scenarioAs('rbac_multi_shelter', [
					`shelter:${code}`,
					`shelter:${OTHER_SHELTER}`,
					`${code}:distribution_staff`,
					`${OTHER_SHELTER}:registration_staff`
				]);
				const pick = (shelter: string) =>
					page.evaluate((c) => localStorage.setItem('tent.activeShelterCode', c), shelter);
				await pick(code);
				await expectDesk(page, true);
				await pick(OTHER_SHELTER);
				await expectDesk(page, false);
			});

			test('R-X3 a flat capability with two shelter scopes grants nothing (CR-093)', async ({
				page,
				scenarioAs
			}) => {
				await scenarioAs('rbac_flat_multi', [
					`shelter:${shelterCode()}`,
					`shelter:${OTHER_SHELTER}`,
					'distribution_staff'
				]);
				await expectDesk(page, false);
			});
		});
	}
);

test.describe('Write permissions at the database (VDU, plan §4.2)', { tag: DESK_TAGS }, () => {
	// No browser: each actor writes straight to CouchDB with its own session, proving the
	// validate_doc_update boundary (CR-161 R3/R4/R6, CR-093 flat vs compound). Expectations
	// follow CR-161 — a mismatch with the VDU is a bug to report, not one to relax.

	test('V1 receiving a ticket at the point is SA / SM / DST only, flat or compound', async ({
		scenarioAs
	}) => {
		const scenario = await scenarioAs('vdu_receive');
		const item = await consumable(scenario, 'vdu');
		await expectWrites(
			scenario,
			[
				actor('sa', SA_ROLES, true),
				actor('sm_flat', roleSet('shelter_manager', 'flat'), true),
				actor('dst_flat', roleSet('distribution_staff', 'flat'), true),
				actor('dst_compound', roleSet('distribution_staff', 'compound'), true),
				actor('reg_flat', roleSet('registration_staff', 'flat'), false),
				actor('wh_compound', roleSet('warehouse_staff', 'compound'), false),
				actor('sc_flat', roleSet('supply_coordinator', 'flat'), false),
				actor('ks_compound', roleSet('kitchen_staff', 'compound'), false)
			],
			(session, name) =>
				transition(
					scenario,
					item,
					'IN_TRANSIT',
					(n) => ({ status: 'DISTRIBUTING', received_by: n }),
					session,
					name
				)
		);
	});

	test('V2 dispatch stays with the warehouse — DST cannot dispatch (CR-161 R4)', async ({
		scenarioAs
	}) => {
		const scenario = await scenarioAs('vdu_dispatch');
		const item = await consumable(scenario, 'vdu');
		await expectWrites(
			scenario,
			[
				actor('wh_flat', roleSet('warehouse_staff', 'flat'), true),
				actor('sc_compound', roleSet('supply_coordinator', 'compound'), true),
				actor('sm_compound', roleSet('shelter_manager', 'compound'), true),
				actor('dst_compound', roleSet('distribution_staff', 'compound'), false),
				actor('dst_flat', roleSet('distribution_staff', 'flat'), false),
				actor('reg_flat', roleSet('registration_staff', 'flat'), false)
			],
			(session, name) =>
				transition(
					scenario,
					item,
					'READY_FOR_DISPATCH',
					(n) => ({
						status: 'IN_TRANSIT',
						dispatched_by: n,
						driver_name: 'คนขับ E2E',
						license_plate: 'E2E-0002'
					}),
					session,
					name
				)
		);
	});

	test('V3 closing a shift is SA / SM / DST only', async ({ scenarioAs }) => {
		const scenario = await scenarioAs('vdu_close');
		const item = await consumable(scenario, 'vdu');
		await expectWrites(
			scenario,
			[
				actor('dst_compound', roleSet('distribution_staff', 'compound'), true),
				actor('sm_flat', roleSet('shelter_manager', 'flat'), true),
				actor('wh_flat', roleSet('warehouse_staff', 'flat'), false),
				actor('reg_compound', roleSet('registration_staff', 'compound'), false)
			],
			(session, name) =>
				transition(
					scenario,
					item,
					'DISTRIBUTING',
					() => ({ status: 'SHIFT_CLOSED' }),
					session,
					name
				)
		);
	});

	test('V4 a distribution log can only be written by frontline roles', async ({ scenarioAs }) => {
		const scenario = await scenarioAs('vdu_log');
		const item = await consumable(scenario, 'vdu');
		const ticket = await seedTicket(scenario, {
			type: 'supplies',
			status: 'DISTRIBUTING',
			lines: [{ item, allocatedQty: '50' }]
		});
		await expectWrites(
			scenario,
			[
				actor('dst_compound', roleSet('distribution_staff', 'compound'), true),
				actor('sm_flat', roleSet('shelter_manager', 'flat'), true),
				actor('reg_flat', roleSet('registration_staff', 'flat'), false),
				actor('wh_compound', roleSet('warehouse_staff', 'compound'), false),
				actor('sc_flat', roleSet('supply_coordinator', 'flat'), false)
			],
			async (session, name) => {
				const id = `distribution_log:${ulid()}`;
				const now = new Date().toISOString();
				const res = await couchAsUser(session, 'PUT', `/${shelterDb()}/${encodeURIComponent(id)}`, {
					_id: id,
					type: 'distribution_log',
					schema_v: 1,
					shelter_code: shelterCode(),
					created_at: now,
					updated_at: now,
					created_by: name,
					ticket_id: ticket.ticketId,
					item_id: item.itemId,
					qty: '1',
					recipient_type: 'outside',
					is_returnable: false,
					status: 'fulfilled',
					is_override: false,
					distributed_at: now,
					distributed_by: name
				});
				return res.status;
			}
		);
	});

	test('V5 bulk return pools are created by the warehouse, not DST', async ({ scenarioAs }) => {
		const scenario = await scenarioAs('vdu_pool');
		const item = await consumable(scenario, 'vdu');
		await expectWrites(
			scenario,
			[
				actor('wh_flat', roleSet('warehouse_staff', 'flat'), true),
				actor('sm_compound', roleSet('shelter_manager', 'compound'), true),
				actor('dst_compound', roleSet('distribution_staff', 'compound'), false),
				actor('reg_flat', roleSet('registration_staff', 'flat'), false)
			],
			async (session, name) => {
				const id = `bulk_return_pool:${ulid()}`;
				const now = new Date().toISOString();
				const res = await couchAsUser(session, 'PUT', `/${shelterDb()}/${encodeURIComponent(id)}`, {
					_id: id,
					type: 'bulk_return_pool',
					schema_v: 2,
					shelter_code: shelterCode(),
					created_at: now,
					updated_at: now,
					created_by: name,
					item_id: item.itemId,
					stock_ledger_id: `stock_ledger:${ulid()}`,
					total_received_qty: '3',
					claimed_qty: '0',
					unclaimed_quota: '3',
					claim_ids: [],
					status: 'ACTIVE'
				});
				return res.status;
			}
		);
	});

	test('V6 another shelter is out of reach (CR-161 R6)', async ({ scenarioAs }) => {
		const scenario = await scenarioAs('vdu_cross_shelter');
		const item = await consumable(scenario, 'vdu');
		const ticket = await seedTicket(scenario, {
			type: 'supplies',
			status: 'IN_TRANSIT',
			lines: [{ item, allocatedQty: '5' }]
		});

		// Staff of another shelter are not even members of this shelter's database.
		const outsider = await addScenarioActor(
			scenario,
			'sh002_dst',
			roleSet('distribution_staff', 'compound', OTHER_SHELTER)
		);
		const read = await couchAsUser(
			outsider.session,
			'GET',
			`/${shelterDb()}/${encodeURIComponent(ticket.ticketId)}`
		);
		expect(read.status).toBe(FORBIDDEN);

		// A member of this shelter holding DST only for another shelter cannot use it here.
		await expectWrites(
			scenario,
			[
				actor(
					'scope_here_dst_elsewhere',
					[`shelter:${shelterCode()}`, `${OTHER_SHELTER}:distribution_staff`],
					false
				)
			],
			(session, name) =>
				transition(
					scenario,
					item,
					'IN_TRANSIT',
					(n) => ({ status: 'DISTRIBUTING', received_by: n }),
					session,
					name
				)
		);
	});
});
