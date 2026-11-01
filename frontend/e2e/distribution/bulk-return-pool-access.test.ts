/**
 * Bulk return pool v3 — who may do what (BULK_RETURN_POOL_E2E_PLAN.md §7, ids BRP-A* / BRP-V*).
 *
 * D1: open pool, edit name / location, cancel, submit, receive are `warehouse_staff`,
 * `supply_coordinator`, `shelter_manager`; add / move / void entry additionally
 * `distribution_staff`; `system_admin` keeps the usual `isRole()` override (decided, BRP-A-SA).
 *
 * - BRP-A1 / BRP-A2: the board in the browser, per role.
 * - BRP-V1*: the validate_doc_update boundary, no browser (`expectWrites`, pattern of V5).
 *
 * BRP-A3 (surface guards: DST redirected from `/back-office/distribution`, WH cannot reach
 * `/onsite/distribution`) is NOT repeated here: distribution-desk-access.test.ts "page access by
 * role" already asserts both guards for every capability, flat and compound (desk: SM + DST,
 * back-office: SM + WH + SC).
 */

import { roleSet, SA_ROLES, shelterCode } from './distribution';
import { expect, test } from './fixtures';
import {
	actor,
	CREATED,
	buildEntryBody,
	buildMoveBody,
	buildPoolBody,
	buildReceiveLedgerBody,
	buildVoidBody,
	cancelBody,
	couchAsUser,
	currentPoolOf,
	docPath,
	expectWrites,
	newEntryId,
	poolName,
	readEntries,
	readMoves,
	readPool,
	readVoids,
	receiveBody,
	receiveLedgerRows,
	seedEntry,
	seedOpenPool,
	seedReturnableItem,
	seedSubmittedPool,
	submitBody,
	switchUser,
	waitForPoolByName
} from './bulk-return-pool';
import { DESK_TAGS } from './distribution-desk-setup';
import { BulkReturnPoolBoard, POOL_COPY } from './pages/bulk-return-pool.page';

test.describe('Bulk return pool v3 — roles in the browser (BRP-A)', { tag: DESK_TAGS }, () => {
	test('BRP-A1 onsite DST adds, moves and voids entries but is not offered the manage actions', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('brp_a1');
		const nameA = poolName(scenario, 'Pool-A');
		const nameB = poolName(scenario, 'Pool-B');
		const poolA = await seedOpenPool(scenario, { name: nameA });
		const poolB = await seedOpenPool(scenario, { name: nameB });
		const item = await seedReturnableItem(scenario, 'a1');
		const seeded = await seedEntry(scenario, poolA, { item, qty: '1', returner: 'unspecified' });
		const board = new BulkReturnPoolBoard(page);

		const dst = await switchUser(page, scenario, 'dst', 'distribution_staff');
		await board.gotoDesk();

		// Board level: add is offered, opening a pool is not.
		await expect(board.headerAction(POOL_COPY.addEntries)).toBeVisible();
		await expect(board.headerAction(POOL_COPY.openNew)).toHaveCount(0);

		// Add (succeeds).
		await board.addFromBoard({
			pool: nameA,
			returner: 'unspecified',
			lines: [{ item, qty: '2' }]
		});
		await expect.poll(async () => (await readEntries(poolA.poolId)).length).toBe(2);
		const added = (await readEntries(poolA.poolId)).find((entry) => entry._id !== seeded);
		expect(added).toMatchObject({ created_by: dst.user.name, qty: '2' });

		// Detail: entry actions yes; edit / submit / receive / cancel not offered.
		const detail = await board.openDetail(nameA);
		await expect(board.action(nameA, POOL_COPY.addEntries)).toBeVisible();
		await expect(board.action(nameA, POOL_COPY.editHeader)).toHaveCount(0);
		await expect(board.action(nameA, POOL_COPY.submit)).toHaveCount(0);
		await expect(board.action(nameA, POOL_COPY.receive)).toHaveCount(0);
		await expect(board.action(nameA, POOL_COPY.cancelPool)).toHaveCount(0);
		await expect(detail.getByRole('heading', { name: POOL_COPY.cancelPool })).toHaveCount(0);
		const rows = detail.getByRole('listitem').filter({ hasText: 'ผู้คืน:' });
		await expect(rows).toHaveCount(2);
		await expect(rows.getByRole('button', { name: POOL_COPY.move })).toHaveCount(2);
		await expect(rows.getByRole('button', { name: POOL_COPY.voidEntry })).toHaveCount(2);

		// Move the seeded entry (oldest first) to pool B (succeeds).
		await board.moveEntry(nameA, item.name, nameB, 0);
		await expect.poll(async () => (await readMoves(seeded)).length).toBe(1);
		const [move] = await readMoves(seeded);
		expect(move).toMatchObject({ created_by: dst.user.name, to_pool_id: poolB.poolId });
		expect(await currentPoolOf({ _id: seeded, pool_id: poolA.poolId })).toBe(poolB.poolId);

		// Void the entry that is left in A (succeeds). `moveEntry` reopened the sheet, so it lists
		// only the added entry; assert that first so index 0 cannot be the moved one.
		await expect(rows).toHaveCount(1);
		const addedId = added?._id ?? '';
		await board.voidEntry(nameA, item.name, 0);
		await expect.poll(async () => (await readVoids(addedId)).length).toBe(1);
		expect((await readVoids(addedId))[0]).toMatchObject({
			created_by: dst.user.name,
			pool_id: poolA.poolId
		});
	});

	for (const [capability, short] of [
		['warehouse_staff', 'wh'],
		['supply_coordinator', 'sc'],
		['shelter_manager', 'sm']
	] as const) {
		test(`BRP-A2 back-office ${capability} opens, adds, submits and receives`, async ({
			page,
			scenarioAs
		}) => {
			const scenario = await scenarioAs(`brp_a2_${short}`);
			const name = poolName(scenario, `A2${short}`);
			const item = await seedReturnableItem(scenario, `a2${short}`);
			const board = new BulkReturnPoolBoard(page);

			const staff = await switchUser(page, scenario, short, capability);
			await board.gotoBackOffice();
			await board.openPool({ name });
			const poolId = await waitForPoolByName(name);
			await board.addFromDetail(name, {
				pool: name,
				returner: 'unspecified',
				lines: [{ item, qty: '2' }]
			});
			await board.submitPool(name);
			const receive = await board.openReceive(name);
			await board.confirmReceive(receive, name);

			await expect.poll(async () => (await readPool(poolId)).status).toBe('RECEIVED');
			expect(await readPool(poolId)).toMatchObject({
				created_by: staff.user.name,
				submitted_by: staff.user.name,
				received_by: staff.user.name
			});
			const ledger = await receiveLedgerRows(poolId);
			expect(ledger).toHaveLength(1);
			expect(ledger[0]).toMatchObject({ qty: '2', created_by: staff.user.name });
		});
	}

	// Open point (a) of PR #768, decided by kong: system_admin keeps the usual `isRole()` override
	// (no SA-specific block), so SA can open a pool in the shelter it picked.
	test('BRP-A-SA system_admin can open a pool (usual SA override)', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('brp_sa', SA_ROLES);
		// SA holds no shelter scope; it works in whichever shelter it picked.
		await page.evaluate(
			(code) => localStorage.setItem('tent.activeShelterCode', code),
			shelterCode()
		);
		const board = new BulkReturnPoolBoard(page);
		await board.gotoBackOffice();
		await expect(board.headerAction(POOL_COPY.openNew)).toBeVisible();

		const body = buildPoolBody({ name: poolName(scenario, 'SA'), createdBy: scenario.user.name });
		const res = await couchAsUser(scenario.session, 'PUT', docPath(body._id), body);
		expect(res.status).toBe(CREATED);
	});
});

test.describe('Bulk return pool v3 — database writes (BRP-V1)', { tag: DESK_TAGS }, () => {
	// No browser: each actor writes straight to CouchDB with its own session. The v3 doc shapes come
	// from bulk-return-pool.ts (what the app writes), not from a v2 pool body.

	// Built per test: `roleSet` reads the run's shelter code, which exists only once a worker runs.
	const managers = () => [
		actor('wh_flat', roleSet('warehouse_staff', 'flat'), true),
		actor('sc_compound', roleSet('supply_coordinator', 'compound'), true),
		actor('sm_flat', roleSet('shelter_manager', 'flat'), true)
	];
	const deniedForPool = () => [
		actor('dst_compound', roleSet('distribution_staff', 'compound'), false),
		actor('reg_flat', roleSet('registration_staff', 'flat'), false)
	];

	test('BRP-V1a creating a pool is WH, SC, SM only', async ({ scenarioAs }) => {
		const scenario = await scenarioAs('brp_v1a');
		await expectWrites(scenario, [...managers(), ...deniedForPool()], async (session, name) => {
			const body = buildPoolBody({ name: `E2E V1a pool ${name}`, createdBy: name });
			return (await couchAsUser(session, 'PUT', docPath(body._id), body)).status;
		});
	});

	test('BRP-V1b submit, receive and cancel transitions are WH, SC, SM only', async ({
		scenarioAs
	}) => {
		const scenario = await scenarioAs('brp_v1b');
		const item = await seedReturnableItem(scenario, 'v1b');
		const actors = [...managers(), ...deniedForPool()];

		await expectWrites(scenario, actors, async (session, name) => {
			const pool = await seedOpenPool(scenario, { name: 'E2E V1b submit' });
			const body = submitBody(await readPool(pool.poolId), name, {
				itemsSummary: [{ item_id: item.itemId, qty: '1' }],
				entryIds: [newEntryId()]
			});
			return (await couchAsUser(session, 'PUT', docPath(pool.poolId), body)).status;
		});

		await expectWrites(scenario, actors, async (session, name) => {
			const pool = await seedSubmittedPool(scenario, {
				name: 'E2E V1b receive',
				items: [{ item, qty: '2' }]
			});
			const body = receiveBody(await readPool(pool.poolId), name, [
				{ item_id: item.itemId, expected_qty: '2', received_qty: '2' }
			]);
			return (await couchAsUser(session, 'PUT', docPath(pool.poolId), body)).status;
		});

		await expectWrites(scenario, actors, async (session, name) => {
			const pool = await seedOpenPool(scenario, { name: 'E2E V1b cancel' });
			const body = cancelBody(await readPool(pool.poolId), name);
			return (await couchAsUser(session, 'PUT', docPath(pool.poolId), body)).status;
		});
	});

	test('BRP-V1c entries, moves and voids are WH, SC, SM, DST (not registration)', async ({
		scenarioAs
	}) => {
		const scenario = await scenarioAs('brp_v1c');
		const item = await seedReturnableItem(scenario, 'v1c');
		const actors = [
			...managers(),
			actor('dst_compound', roleSet('distribution_staff', 'compound'), true),
			actor('dst_flat', roleSet('distribution_staff', 'flat'), true),
			actor('reg_flat', roleSet('registration_staff', 'flat'), false)
		];

		// The board folds every entry / move / void of the shelter and throws on an orphan, so each
		// write below references real seeded docs: accepted or rejected, the data stays consistent.
		await expectWrites(scenario, actors, async (session, name) => {
			const pool = await seedOpenPool(scenario, { name: `E2E V1c entry ${name}` });
			const body = buildEntryBody({
				poolId: pool.poolId,
				itemId: item.itemId,
				qty: '1',
				returner: 'unspecified',
				createdBy: name
			});
			return (await couchAsUser(session, 'PUT', docPath(body._id), body)).status;
		});

		await expectWrites(scenario, actors, async (session, name) => {
			const from = await seedOpenPool(scenario, { name: `E2E V1c move from ${name}` });
			const to = await seedOpenPool(scenario, { name: `E2E V1c move to ${name}` });
			const entryId = await seedEntry(scenario, from, {
				item,
				qty: '1',
				returner: 'unspecified'
			});
			const body = buildMoveBody({
				entryId,
				seq: 1,
				fromPoolId: from.poolId,
				toPoolId: to.poolId,
				itemId: item.itemId,
				qty: '1',
				createdBy: name
			});
			return (await couchAsUser(session, 'PUT', docPath(body._id), body)).status;
		});

		await expectWrites(scenario, actors, async (session, name) => {
			const pool = await seedOpenPool(scenario, { name: `E2E V1c void ${name}` });
			const entryId = await seedEntry(scenario, pool, {
				item,
				qty: '1',
				returner: 'unspecified'
			});
			const body = buildVoidBody({
				entryId,
				poolId: pool.poolId,
				itemId: item.itemId,
				qty: '1',
				createdBy: name
			});
			return (await couchAsUser(session, 'PUT', docPath(body._id), body)).status;
		});
	});

	test('BRP-V1d the receive ledger row is WH, SC, SM only — DST cannot book stock', async ({
		scenarioAs
	}) => {
		const scenario = await scenarioAs('brp_v1d');
		const item = await seedReturnableItem(scenario, 'v1d');
		await expectWrites(scenario, [...managers(), ...deniedForPool()], async (session, name) => {
			const pool = await seedOpenPool(scenario, { name: `E2E V1d ledger ${name}` });
			const body = await buildReceiveLedgerBody({
				poolId: pool.poolId,
				itemId: item.itemId,
				qty: '1',
				createdBy: name
			});
			return (await couchAsUser(session, 'PUT', docPath(body._id), body)).status;
		});
	});
});
