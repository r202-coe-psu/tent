/**
 * Bulk return pool v3 — lifecycle and rules (BULK_RETURN_POOL_E2E_PLAN.md §5, ids BRP-F*).
 *
 * Open, add / move / void entries, submit, receive and cancel, on both staff surfaces (back-office
 * tab "กองรับคืนพัสดุ" and desk tab 4), with every browser step read back from CouchDB: loans
 * (`applied_bulk_entry_ids`), entries, move / void docs, and the `stock_ledger` rows that exist only
 * after the warehouse receives. Business decisions are cited as D1…D14 (plan §2.1).
 *
 * Pools whose creation is not the subject are seeded with the admin API BEFORE the page loads (the
 * board reads the pool list once on mount); loans come from `seedLoan`, except where the plan lends
 * through the desk (F2, F5).
 */

import { putDocument } from '../helpers/couch';
import { injectSession } from '../helpers/login';
import { expect, test } from './fixtures';
import {
	buildEntryBody,
	buildPoolBody,
	CREATED,
	currentPoolOf,
	docPath,
	expectedReceiveLedgerId,
	FORBIDDEN,
	lendViaDesk,
	poolName,
	readDoc,
	readEntries,
	readMoves,
	readPool,
	readPoolsByName,
	readStatus,
	readVoids,
	receiveLedgerRows,
	seedEntry,
	seedLoan,
	seedOpenPool,
	seedReturnableItem,
	sortedIds,
	sortedStrings,
	switchUser,
	waitForPoolByName,
	type ItemSummaryRow
} from './bulk-return-pool';
import {
	addScenarioActor,
	couchAsUser,
	getShelterDocument,
	roleSet,
	seedRecipient,
	shelterDb
} from './distribution';
import { DESK_TAGS } from './distribution-desk-setup';
import { BulkReturnPoolBoard, POOL_COPY } from './pages/bulk-return-pool.page';

const byItem = (a: ItemSummaryRow, b: ItemSummaryRow) => a.item_id.localeCompare(b.item_id);

test.describe('Bulk return pool v3 — lifecycle (BRP-F)', { tag: DESK_TAGS }, () => {
	test('BRP-F1 mixed-surface happy path: WH opens, DST adds at the desk, WH submits and receives one short', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('brp_f1');
		const evacuee = await seedRecipient(scenario, `Brp${scenario.namespace.slice(-6)}`, 'Returner');
		// A: loan of 3 (returned in two pieces), B: loan of 2, C: returnable item nobody borrowed.
		const loanA = await seedLoan(scenario, evacuee, 'a', '3');
		const loanB = await seedLoan(scenario, evacuee, 'b', '2');
		const itemC = await seedReturnableItem(scenario, 'c');
		const name = poolName(scenario, 'F1');
		const board = new BulkReturnPoolBoard(page);

		// 1. WH opens the pool at back-office (UI).
		const wh = await switchUser(page, scenario, 'wh', 'warehouse_staff');
		await board.gotoBackOffice();
		await board.openPool({ name });
		const poolId = await waitForPoolByName(name);
		const opened = await readPool(poolId);
		expect(opened).toMatchObject({ status: 'OPEN', schema_v: 3, name, created_by: wh.user.name });
		expect(opened).not.toHaveProperty('location_storage_point_id');

		// 2. DST adds entries at the desk: E returns A and B, an unknown person returns C, then
		//    E's second piece of A goes in through the loan card ("คืนเข้ากองรับคืน").
		const dst = await switchUser(page, scenario, 'dst', 'distribution_staff');
		const desk = await board.gotoDesk();
		await board.addFromBoard({
			pool: name,
			returner: evacuee,
			lines: [
				{ item: loanA.item, qty: '2' },
				{ item: loanB.item, qty: '2' }
			]
		});
		await board.addFromBoard({
			pool: name,
			returner: 'unspecified',
			lines: [{ item: itemC, qty: '3' }]
		});
		await desk.chooseRecipientBySearch(evacuee);
		const dialog = await board.startAddFromLoanCard(loanA.item.name);
		await expect(dialog.getByText(evacuee.recipientId, { exact: true })).toBeVisible();
		await expect(dialog.locator('[id^="add-entry-item-"]')).toContainText(loanA.item.name);
		await board.fillAddDialog(dialog, { pool: name, lines: [{ qty: '1' }] });
		await board.saveAddDialog(dialog);

		await expect.poll(async () => (await readEntries(poolId)).length).toBe(4);
		const entries = await readEntries(poolId);
		const entriesA = entries.filter((e) => e.item_id === loanA.item.itemId);
		const entriesB = entries.filter((e) => e.item_id === loanB.item.itemId);
		const entriesC = entries.filter((e) => e.item_id === itemC.itemId);
		expect(entriesA.map((e) => e.qty).sort()).toEqual(['1', '2']);
		expect(entriesA.every((e) => e.created_by === dst.user.name)).toBe(true);
		expect(entriesC).toHaveLength(1);
		expect(entriesC[0]).toMatchObject({ returner_type: 'unspecified', returner_id: null });
		expect(entriesC[0].loan_refs).toEqual([]);

		// D11: loans carry the applying entry ids; A is returned in two pieces, B in one.
		await expect.poll(() => readStatus(loanA.logId)).toBe('returned');
		const logA = await getShelterDocument(loanA.logId);
		const logB = await getShelterDocument(loanB.logId);
		expect(logA).toMatchObject({
			status: 'returned',
			qty_returned: '3',
			clear_reason: 'bulk_dropoff'
		});
		expect(logB).toMatchObject({
			status: 'returned',
			qty_returned: '2',
			clear_reason: 'bulk_dropoff'
		});
		expect(sortedStrings(logA?.applied_bulk_entry_ids)).toEqual(sortedIds(entriesA));
		expect(sortedStrings(logB?.applied_bulk_entry_ids)).toEqual(sortedIds(entriesB));

		// 3. WH submits at back-office; nothing is stock yet (D7).
		await injectSession(page, wh.user, wh.session);
		await board.gotoBackOffice();
		await board.expectCardStatus(name, 'OPEN');
		const detail = await board.openDetail(name);
		await board.submitPool(name);
		await expect(detail).toContainText(POOL_COPY.status.SUBMITTED);
		await expect(detail).toContainText('ยอดที่ส่งเข้าคลัง');
		for (const item of [loanA.item, loanB.item, itemC]) {
			await expect(detail).toContainText(item.name);
		}
		await board.closeDetail(name);
		await board.expectCardStatus(name, 'SUBMITTED');

		await expect.poll(async () => (await readPool(poolId)).status).toBe('SUBMITTED');
		const submitted = await readPool(poolId);
		const expectedSummary: ItemSummaryRow[] = [
			{ item_id: loanA.item.itemId, qty: '3' },
			{ item_id: loanB.item.itemId, qty: '2' },
			{ item_id: itemC.itemId, qty: '3' }
		];
		expect((submitted.items_summary as ItemSummaryRow[]).slice().sort(byItem)).toEqual(
			expectedSummary.slice().sort(byItem)
		);
		expect(sortedStrings(submitted.entry_ids)).toEqual(sortedIds(entries));
		expect(submitted).toMatchObject({ submitted_by: wh.user.name });
		expect(await receiveLedgerRows(poolId)).toHaveLength(0);

		// 4. WH receives with B one short (damaged). No storage points: main store.
		await board.openDetail(name);
		const receive = await board.openReceive(name);
		await expect(board.receiveQty(receive, loanA.item)).toHaveValue('3');
		await expect(board.receiveReason(receive, loanB.item)).toHaveCount(0);
		await board.receiveQty(receive, loanB.item).fill('1');
		await expect(board.receiveReason(receive, loanB.item)).toBeVisible();
		await expect(board.receiveReason(receive, loanA.item)).toHaveCount(0);
		await expect(board.receiveReason(receive, itemC)).toHaveCount(0);
		await board.chooseReason(receive, loanB.item, 'damaged');
		// The point select is still rendered; with no points it only offers the main store.
		await expect(board.receiveStorage(receive)).toContainText(POOL_COPY.unspecifiedPointOption);
		await expect(receive.getByText('ศูนย์นี้ยังไม่ได้ตั้งค่าจุดเก็บของ')).toBeVisible();
		await board.confirmReceive(receive, name);

		await expect(detail).toContainText(POOL_COPY.status.RECEIVED);
		await expect(detail).toContainText(POOL_COPY.receiveRecord);
		await expect(detail).toContainText(POOL_COPY.mainStore);
		await expect(detail).toContainText(POOL_COPY.reasons.damaged);

		await expect.poll(async () => (await readPool(poolId)).status).toBe('RECEIVED');
		const received = await readPool(poolId);
		expect(received).toMatchObject({ received_by: wh.user.name });
		expect(received).not.toHaveProperty('received_storage_point_id');
		const receivedItems = received.received_items as Array<Record<string, unknown>>;
		const rowOf = (itemId: string) => receivedItems.find((row) => row.item_id === itemId);
		expect(rowOf(loanB.item.itemId)).toMatchObject({
			expected_qty: '2',
			received_qty: '1',
			discrepancy_reason: 'damaged'
		});
		expect(rowOf(loanA.item.itemId)).toEqual({
			item_id: loanA.item.itemId,
			expected_qty: '3',
			received_qty: '3'
		});

		// D7: stock rows carry the ACTUAL quantity, one per item, deterministic ids, no point.
		const ledger = await receiveLedgerRows(poolId);
		expect(ledger).toHaveLength(3);
		const actualQty: Array<[string, string]> = [
			[loanA.item.itemId, '3'],
			[loanB.item.itemId, '1'],
			[itemC.itemId, '3']
		];
		for (const [itemId, qty] of actualQty) {
			const row = ledger.find((r) => r.item_id === itemId);
			expect(row).toMatchObject({
				_id: await expectedReceiveLedgerId(poolId, itemId),
				reason: 'receive',
				ref_id: poolId,
				qty,
				lot: { note: 'bulk_return_pool' }
			});
			expect(row?.lot).not.toHaveProperty('storage_point_id');
			expect(row?.lot).not.toHaveProperty('storage_zone');
			expect(row).not.toHaveProperty('ref_type');
		}
	});

	test('BRP-F2 partial return: 2 of 3 through the loan card leaves 1 outstanding', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('brp_f2');
		const name = poolName(scenario, 'F2');
		const pool = await seedOpenPool(scenario, { name });
		const { item, logId } = await lendViaDesk(page, scenario, '3');
		const board = new BulkReturnPoolBoard(page);

		await board.addFromLoanCard(item.name, { pool: name, lines: [{ qty: '2' }] });

		const card = board.loanCard(item.name);
		await expect(card).toContainText(/คืนแล้ว\s*2/);
		await expect(card).toContainText(/คงค้าง\s*1/);

		await expect.poll(() => readStatus(logId)).toBe('partially_returned');
		const log = await getShelterDocument(logId);
		expect(log).toMatchObject({ qty_returned: '2', clear_reason: 'bulk_dropoff' });
		const entries = await readEntries(pool.poolId);
		expect(entries).toHaveLength(1);
		expect(log?.applied_bulk_entry_ids).toEqual([entries[0]._id]);
		expect(entries[0].loan_refs).toEqual([{ distribution_log_id: logId, qty: '2' }]);
	});

	test('BRP-F3 an empty pool cannot be submitted but can be cancelled; it stays in CouchDB', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('brp_f3');
		const name = poolName(scenario, 'F3');
		const board = new BulkReturnPoolBoard(page);

		await board.gotoBackOffice();
		await board.openPool({ name });
		const poolId = await waitForPoolByName(name);

		await expect(board.action(name, POOL_COPY.submit)).toBeDisabled();
		await expect(board.submitReason()).toHaveText(POOL_COPY.submitEmptyReason);
		await expect(board.action(name, POOL_COPY.cancelPool)).toBeEnabled();

		await board.cancelPool(name);
		await expect(board.card(name)).toHaveCount(0);
		await board.showCancelled(true);
		await board.expectCardStatus(name, 'CANCELLED');

		await expect.poll(async () => (await readPool(poolId)).status).toBe('CANCELLED');
		const cancelled = await readPool(poolId);
		expect(cancelled).toMatchObject({ cancelled_by: scenario.user.name });
		expect(typeof cancelled.cancelled_at).toBe('string');
	});

	test('BRP-F4 a pool with an entry cannot be cancelled; after the entry moves out it can', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('brp_f4');
		const nameA = poolName(scenario, 'Pool-A');
		const nameB = poolName(scenario, 'Pool-B');
		const poolA = await seedOpenPool(scenario, { name: nameA });
		const poolB = await seedOpenPool(scenario, { name: nameB });
		const item = await seedReturnableItem(scenario, 'f4');
		const entryId = await seedEntry(scenario, poolA, { item, qty: '2', returner: 'unspecified' });
		const board = new BulkReturnPoolBoard(page);

		await board.gotoBackOffice();
		const detail = await board.openDetail(nameA);
		await expect(board.action(nameA, POOL_COPY.cancelPool)).toBeDisabled();
		await expect(board.cancelReason()).toHaveText(POOL_COPY.cancelNotEmptyReason);

		await board.moveEntry(nameA, item.name, nameB);
		await expect(detail).toContainText(POOL_COPY.noEntries);
		await expect(board.action(nameA, POOL_COPY.cancelPool)).toBeEnabled();

		await expect.poll(async () => (await readMoves(entryId)).length).toBe(1);
		const [move] = await readMoves(entryId);
		expect(move._id).toMatch(new RegExp(`^bulk_return_entry_move:${entryId.split(':')[1]}:0001$`));
		expect(move).toMatchObject({
			entry_id: entryId,
			seq: 1,
			from_pool_id: poolA.poolId,
			to_pool_id: poolB.poolId,
			item_id: item.itemId,
			qty: '2'
		});
		expect(await currentPoolOf(await readDoc(entryId))).toBe(poolB.poolId);

		await board.cancelPool(nameA);
		await expect.poll(async () => (await readPool(poolA.poolId)).status).toBe('CANCELLED');
		expect((await readPool(poolB.poolId)).status).toBe('OPEN');
	});

	test('BRP-F5 voiding an entry reopens its loan and empties the pool again', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('brp_f5');
		const name = poolName(scenario, 'F5');
		const pool = await seedOpenPool(scenario, { name });
		const { item, logId, recipient } = await lendViaDesk(page, scenario, '2');
		const board = new BulkReturnPoolBoard(page);

		await board.addFromLoanCard(item.name, { pool: name, lines: [{ qty: '2' }] });
		await expect.poll(() => readStatus(logId)).toBe('returned');
		const [entry] = await readEntries(pool.poolId);
		expect((await getShelterDocument(logId))?.applied_bulk_entry_ids).toEqual([entry._id]);

		await board.openDetail(name);
		await board.voidEntry(name, item.name);

		await expect.poll(() => readStatus(logId)).toBe('active');
		const log = await getShelterDocument(logId);
		// Plan §9(c): the reopened loan keeps clear_reason 'bulk_dropoff' (default to confirm).
		expect(log).toMatchObject({ qty_returned: '0', clear_reason: 'bulk_dropoff' });
		expect(log?.applied_bulk_entry_ids).toEqual([]);
		const voids = await readVoids(entry._id);
		expect(voids).toHaveLength(1);
		expect(voids[0]._id).toBe(`bulk_return_entry_void:${entry._id.split(':')[1]}`);
		expect(voids[0]).toMatchObject({
			entry_id: entry._id,
			pool_id: pool.poolId,
			item_id: item.itemId,
			qty: '2',
			created_by: scenario.user.name
		});
		// Append-only: the entry doc is still there.
		expect(await getShelterDocument(entry._id)).not.toBeNull();

		// The sheet no longer lists the entry (voided rows are folded out), net count 0: submit is off.
		const detail = board.detail(name);
		await expect(detail).toContainText(POOL_COPY.noEntries);
		await expect(board.action(name, POOL_COPY.submit)).toBeDisabled();
		await expect(board.submitReason()).toHaveText(POOL_COPY.submitEmptyReason);

		// The loan is back at the counter with its full qty outstanding.
		await board.closeDetail(name);
		const desk = await board.gotoDesk();
		await desk.chooseRecipientBySearch(recipient);
		await expect(board.loanCard(item.name)).toContainText(/คงค้าง\s*2/);
	});

	test('BRP-F6 a late entry after submit shows as "ค้าง" and is moved to another OPEN pool', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('brp_f6');
		const nameS = poolName(scenario, 'Pool-S');
		const nameT = poolName(scenario, 'Pool-T');
		const source = await seedOpenPool(scenario, { name: nameS });
		const target = await seedOpenPool(scenario, { name: nameT });
		const item = await seedReturnableItem(scenario, 'f6');
		const evacuee = await seedRecipient(scenario, `Brp${scenario.namespace.slice(-6)}`, 'Late');
		const loan = await seedLoan(scenario, evacuee, 'f6loan', '1');
		await seedEntry(scenario, source, { item, qty: '1', returner: 'unspecified' });
		const board = new BulkReturnPoolBoard(page);

		// WH locks the pool in: submit snapshots entry_ids (D5).
		const wh = await switchUser(page, scenario, 'wh', 'warehouse_staff');
		await board.gotoBackOffice();
		await board.openDetail(nameS);
		await board.submitPool(nameS);
		await board.closeDetail(nameS);
		await expect.poll(async () => (await readPool(source.poolId)).status).toBe('SUBMITTED');
		const snapshot = await readPool(source.poolId);

		// The UI never writes into a SUBMITTED pool; the VDU cannot see pool state, so a direct PUT can.
		const dst = await addScenarioActor(scenario, 'dst', roleSet('distribution_staff', 'flat'));
		const late = buildEntryBody({
			poolId: source.poolId,
			itemId: item.itemId,
			qty: '1',
			returner: evacuee,
			createdBy: dst.user.name
		});
		expect((await couchAsUser(dst.session, 'PUT', docPath(late._id), late)).status).toBe(CREATED);

		// WH sees the badge and the notice.
		await injectSession(page, wh.user, wh.session);
		await board.gotoBackOffice();
		await expect(board.card(nameS)).toContainText(POOL_COPY.lateBadge);
		const whDetail = await board.openDetail(nameS);
		await expect(whDetail).toContainText(POOL_COPY.lateNotice);

		// DST moves the late entry (second row: oldest first) to the other OPEN pool at the desk.
		await injectSession(page, dst.user, dst.session);
		await board.gotoDesk();
		await expect(board.card(nameS)).toContainText(POOL_COPY.lateBadge);
		await board.openDetail(nameS);
		await expect(board.entryRow(nameS, item.name, 0).getByRole('button')).toHaveCount(0);
		await board.moveEntry(nameS, item.name, nameT, 1);

		await expect.poll(async () => (await readMoves(late._id)).length).toBe(1);
		expect((await readMoves(late._id))[0]).toMatchObject({
			from_pool_id: source.poolId,
			to_pool_id: target.poolId
		});
		expect(await currentPoolOf(late)).toBe(target.poolId);

		// The snapshot never changed and never included the late entry; its loan was not touched.
		const after = await readPool(source.poolId);
		expect(after.items_summary).toEqual(snapshot.items_summary);
		expect(after.entry_ids).toEqual(snapshot.entry_ids);
		expect(after.entry_ids as string[]).not.toContain(late._id);
		const log = await getShelterDocument(loan.logId);
		expect(log).toMatchObject({ status: 'active' });
		expect(log).not.toHaveProperty('applied_bulk_entry_ids');
		expect(await receiveLedgerRows(source.poolId)).toHaveLength(0);
	});

	test('BRP-F7a the name input stops at 80 characters', async ({ page, scenarioAs }) => {
		await scenarioAs('brp_f7a');
		const board = new BulkReturnPoolBoard(page);

		await board.gotoBackOffice();
		const dialog = await board.startOpenPool();
		const input = dialog.locator('#open-pool-name');
		await input.pressSequentially('x'.repeat(90));
		// maxlength=80: the "over 80" UI error is unreachable, only the VDU (F7b) can reject.
		await expect(input).toHaveValue('x'.repeat(80));
		await expect(dialog.getByText('80/80')).toBeVisible();
		await dialog.getByRole('button', { name: POOL_COPY.dialogCancel, exact: true }).click();
		await expect(dialog).toBeHidden();
	});

	test('BRP-F7b the VDU rejects an 81-character pool name and accepts 80', async ({
		scenarioAs
	}) => {
		const scenario = await scenarioAs('brp_f7b');
		const wh = await addScenarioActor(scenario, 'wh', roleSet('warehouse_staff', 'flat'));

		const tooLong = buildPoolBody({ name: 'x'.repeat(81), createdBy: wh.user.name });
		const rejected = await couchAsUser(wh.session, 'PUT', docPath(tooLong._id), tooLong);
		expect(rejected.status).toBe(FORBIDDEN);
		expect((rejected.data as { reason?: string }).reason).toContain(
			'bulk_return_pool name must be 1 to 80 characters'
		);
		expect(await getShelterDocument(tooLong._id)).toBeNull();

		const limit = buildPoolBody({ name: 'y'.repeat(80), createdBy: wh.user.name });
		expect((await couchAsUser(wh.session, 'PUT', docPath(limit._id), limit)).status).toBe(CREATED);
	});

	test('BRP-F7c a second OPEN pool cannot reuse a name; once the first is cancelled it can', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('brp_f7c');
		const name = poolName(scenario, 'Same');
		const board = new BulkReturnPoolBoard(page);

		await board.gotoBackOffice();
		await board.openPool({ name });
		await waitForPoolByName(name);
		await board.closeDetail(name);

		// The UI warns while typing and the workflow refuses the write (advisory check, D9).
		const dialog = await board.startOpenPool();
		await dialog.locator('#open-pool-name').fill(name);
		await expect(dialog.getByText(POOL_COPY.nameDuplicateWarning)).toBeVisible();
		await dialog.getByRole('button', { name: POOL_COPY.openSubmit, exact: true }).click();
		await expect(dialog.locator('#open-pool-name-error')).toHaveText(POOL_COPY.nameTakenError);
		await expect(dialog).toBeVisible();
		expect(await readPoolsByName(name)).toHaveLength(1);
		await dialog.getByRole('button', { name: POOL_COPY.dialogCancel, exact: true }).click();
		await expect(dialog).toBeHidden();

		// Only OPEN pools count: cancel the first (empty) one and the same name is accepted.
		await board.openDetail(name);
		await board.cancelPool(name);
		await board.openPool({ name });
		const statuses = async () => (await readPoolsByName(name)).map((pool) => pool.status).sort();
		await expect.poll(statuses).toEqual(['CANCELLED', 'OPEN']);
	});

	test('BRP-F8a an unspecified returner is stored with returner_id null and no loan refs', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('brp_f8a');
		const name = poolName(scenario, 'F8a');
		const pool = await seedOpenPool(scenario, { name });
		const item = await seedReturnableItem(scenario, 'f8a');
		const board = new BulkReturnPoolBoard(page);

		await board.gotoBackOffice();
		await board.openDetail(name);
		await board.addFromDetail(name, {
			pool: name,
			returner: 'unspecified',
			lines: [{ item, qty: '4' }]
		});

		await expect.poll(async () => (await readEntries(pool.poolId)).length).toBe(1);
		const [entry] = await readEntries(pool.poolId);
		expect(entry).toMatchObject({
			returner_type: 'unspecified',
			returner_id: null,
			loan_refs: [],
			item_id: item.itemId,
			qty: '4'
		});
		const row = board.entryRow(name, item.name);
		await expect(row).toContainText('ไม่ระบุผู้คืน');
		await expect(row).toContainText('ไม่ได้ตัดยอดยืม');
	});

	test('BRP-F8b an evacuee with no outstanding loan is warned, and the entry is saved without loan refs', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('brp_f8b');
		const name = poolName(scenario, 'F8b');
		const pool = await seedOpenPool(scenario, { name });
		const item = await seedReturnableItem(scenario, 'f8b');
		const evacuee = await seedRecipient(scenario, `Brp${scenario.namespace.slice(-6)}`, 'NoLoan');
		const board = new BulkReturnPoolBoard(page);

		await board.gotoBackOffice();
		await board.openDetail(name);
		const dialog = await board.startAddFromDetail(name);
		await board.fillAddDialog(dialog, {
			pool: name,
			returner: evacuee,
			lines: [{ item, qty: '1' }]
		});
		await expect(
			dialog.getByRole('status').filter({ hasText: POOL_COPY.noLoanWarning })
		).toBeVisible();
		await board.saveAddDialog(dialog);

		await expect.poll(async () => (await readEntries(pool.poolId)).length).toBe(1);
		const [entry] = await readEntries(pool.poolId);
		expect(entry).toMatchObject({
			returner_type: 'evacuee',
			returner_id: evacuee.recipientId,
			loan_refs: []
		});
	});

	test('BRP-F9 name and location are editable while OPEN and immutable from SUBMITTED', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('brp_f9');
		const original = poolName(scenario, 'F9');
		const renamed = poolName(scenario, 'F9r');
		const pool = await seedOpenPool(scenario, { name: original });
		const item = await seedReturnableItem(scenario, 'f9');
		await seedEntry(scenario, pool, { item, qty: '1', returner: 'unspecified' });
		const board = new BulkReturnPoolBoard(page);

		const wh = await switchUser(page, scenario, 'wh', 'warehouse_staff');
		await board.gotoBackOffice();
		await board.openDetail(original);
		await board.editHeader(original, { name: renamed });
		await expect.poll(async () => (await readPool(pool.poolId)).name).toBe(renamed);
		await expect(board.detail(renamed)).toBeVisible();

		await board.submitPool(renamed);
		await expect(board.detail(renamed)).toContainText(POOL_COPY.status.SUBMITTED);
		await expect(board.action(renamed, POOL_COPY.editHeader)).toHaveCount(0);

		// VDU: the same rules hold for a direct write by the warehouse.
		await expect.poll(async () => (await readPool(pool.poolId)).status).toBe('SUBMITTED');
		const submitted = await readPool(pool.poolId);
		const put = (body: Record<string, unknown>) =>
			couchAsUser(wh.session, 'PUT', docPath(pool.poolId), body);
		const reasonOf = (res: { data: unknown }) => (res.data as { reason?: string }).reason;
		const at = new Date().toISOString();

		const rename = await put({ ...submitted, name: 'E2E renamed after submit', updated_at: at });
		expect(rename.status).toBe(FORBIDDEN);
		expect(reasonOf(rename)).toContain(
			'name and location are immutable once the pool has left OPEN'
		);

		// D1 forward-only. With the snapshot kept, the OPEN shape check fails first ...
		const keptSnapshot = await put({ ...submitted, status: 'OPEN', updated_at: at });
		expect(keptSnapshot.status).toBe(FORBIDDEN);
		expect(reasonOf(keptSnapshot)).toContain('OPEN bulk_return_pool must not have items_summary');

		// ... so strip the snapshot to reach the transition rule itself.
		const stripped: Record<string, unknown> = { ...submitted };
		for (const field of ['items_summary', 'entry_ids', 'submitted_at', 'submitted_by']) {
			delete stripped[field];
		}
		const reopen = await put({ ...stripped, status: 'OPEN', updated_at: at });
		expect(reopen.status).toBe(FORBIDDEN);
		expect(reasonOf(reopen)).toContain(
			'Invalid bulk_return_pool status transition SUBMITTED -> OPEN'
		);

		const after = await readPool(pool.poolId);
		expect(after).toMatchObject({ status: 'SUBMITTED', name: renamed });
	});

	// GAP found by running the suite against real CouchDB (PR #768): while the detail sheet is OPEN
	// it does not re-render from the refreshed overview row. The overview query does refetch (the
	// board card shows the new count / status / name), but the open sheet keeps the old row for 20s+:
	// stale entries after move / void / add, stale title after rename, still "เก็บเข้าคลัง" instead
	// of "ตรวจรับ" after submit. It shows the fresh row only once closed and reopened. After
	// "เปิดกอง" succeeds the new pool's sheet never auto-opens either, although `onOpened` sets
	// `selectedPoolId`. BulkReturnPoolBoard says "Detail follows the live overview row, so it
	// refreshes after every mutation". The page object works around it with `reopenDetail`; this
	// test asserts the intended behaviour without that workaround.
	test.fixme('GAP: BRP-F10 the open detail sheet follows the live row after a mutation and opens after create', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('brp_f10');
		const created = poolName(scenario, 'F10new');
		const nameA = poolName(scenario, 'F10-A');
		const nameB = poolName(scenario, 'F10-B');
		const poolA = await seedOpenPool(scenario, { name: nameA });
		await seedOpenPool(scenario, { name: nameB });
		const item = await seedReturnableItem(scenario, 'f10');
		await seedEntry(scenario, poolA, { item, qty: '1', returner: 'unspecified' });
		const board = new BulkReturnPoolBoard(page);

		await board.gotoBackOffice();

		// Create: the new pool's sheet opens by itself, titled with the new name.
		const dialog = await board.startOpenPool();
		await dialog.locator('#open-pool-name').fill(created);
		await dialog.getByRole('button', { name: POOL_COPY.openSubmit, exact: true }).click();
		await expect(dialog).toBeHidden();
		await expect(board.detail(created)).toBeVisible();
		await board.closeDetail(created);

		// Mutate from the open sheet: it must show the result without being closed and reopened.
		const detail = await board.openDetail(nameA);
		await expect(board.entryRow(nameA, item.name)).toBeVisible();
		await board.entryRow(nameA, item.name).getByRole('button', { name: POOL_COPY.move }).click();
		const move = board.moveDialog();
		await expect(move).toBeVisible();
		await move.locator('#move-entry-target').click();
		await page.getByRole('option', { name: nameB, exact: true }).click();
		await move.getByRole('button', { name: POOL_COPY.moveConfirm, exact: true }).click();
		await expect(move).toBeHidden();
		await expect(detail).toContainText(POOL_COPY.noEntries);
	});

	// Draft for an open point (b) of PR #768: loan drift between allocation and apply. The apply
	// step fails on every retry because the entry (already written with loan_refs) points at a loan
	// that is no longer active, and no rule says what should happen. The assertion below is the
	// recovery the plan expects once kong decides (the second save goes through).
	// Blocked on PR #768 body → Not included → Open points for kong (system_admin / loan drift).
	test.fixme('BRP-F-drift a loan cleared between allocation and apply does not wedge the retry (open point b)', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('brp_fdrift');
		const name = poolName(scenario, 'Fdrift');
		await seedOpenPool(scenario, { name });
		const evacuee = await seedRecipient(scenario, `Brp${scenario.namespace.slice(-6)}`, 'Drift');
		const loan = await seedLoan(scenario, evacuee, 'drift', '2');
		const board = new BulkReturnPoolBoard(page);

		// The loan is written off (lost) by someone else while the first apply is in flight.
		let drifted = false;
		await page.route(
			(url) => url.pathname.includes(encodeURIComponent(loan.logId)),
			async (route) => {
				if (!drifted && route.request().method() === 'PUT') {
					drifted = true;
					const current = await getShelterDocument(loan.logId);
					if (current) {
						await putDocument(shelterDb(), {
							...current,
							status: 'lost',
							clear_reason: 'lost',
							notes: 'E2E drift',
							returned_at: new Date().toISOString(),
							returned_by: scenario.user.name,
							updated_at: new Date().toISOString()
						});
					}
					await route.abort();
					return;
				}
				await route.fallback();
			}
		);

		await board.gotoBackOffice();
		const dialog = await board.startAddFromBoard();
		await board.fillAddDialog(dialog, {
			pool: name,
			returner: evacuee,
			lines: [{ item: loan.item, qty: '2' }]
		});
		await dialog.getByRole('button', { name: POOL_COPY.saveEntries }).click();
		await expect(dialog.getByRole('alert')).toBeVisible();

		// Expected recovery (to be confirmed): the retry settles instead of failing forever.
		await dialog.getByRole('button', { name: POOL_COPY.saveEntries }).click();
		await expect(dialog).toBeHidden();
		expect(await getShelterDocument(loan.logId)).toMatchObject({ status: 'lost' });
	});
});
