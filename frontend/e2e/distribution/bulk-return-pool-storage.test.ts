/**
 * Bulk return pool v3 — storage points, CR-139 (BULK_RETURN_POOL_E2E_PLAN.md §6, ids BRP-S*).
 *
 * This spec asks the `shelter` worker fixture for two storage points
 * (`test.use({ shelterStoragePoints })`): Playwright starts a separate worker, and so a separate
 * `E2E Distribution …` shelter, for it. The points are written onto that shelter's own registry
 * doc; every other spec keeps a shelter without points (the "คลังหลัก" case, covered by BRP-F1).
 */

import { expect, test, type StoragePointSeed } from './fixtures';
import {
	poolName,
	readPool,
	receiveLedgerRows,
	seedEntry,
	seedOpenPool,
	seedReturnableItem,
	switchUser,
	waitForPoolByName
} from './bulk-return-pool';
import { DESK_TAGS } from './distribution-desk-setup';
import { BulkReturnPoolBoard, POOL_COPY, pointOption } from './pages/bulk-return-pool.page';

const POINT_A: StoragePointSeed = { id: 'sp-e2e-a', name: 'E2E จุดเก็บ A', type: 'general' };
const POINT_B: StoragePointSeed = { id: 'sp-e2e-b', name: 'E2E จุดเก็บ B', type: 'food_dry' };

// Tuple form: a bare array value would be read as Playwright's `[value, options]` pair.
test.use({ shelterStoragePoints: [[POINT_A, POINT_B], { scope: 'worker' }] });

test.describe('Bulk return pool v3 — storage points (BRP-S)', { tag: DESK_TAGS }, () => {
	test('BRP-S1 a pool is opened at point A and received into point B', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('brp_s1');
		const name = poolName(scenario, 'S1');
		const item = await seedReturnableItem(scenario, 's1');
		const board = new BulkReturnPoolBoard(page);

		// Open with location A (D8): id and a name snapshot are stored together.
		const wh = await switchUser(page, scenario, 'wh', 'warehouse_staff');
		await board.gotoBackOffice();
		await board.openPool({ name, location: POINT_A.name });
		const poolId = await waitForPoolByName(name);
		expect(await readPool(poolId)).toMatchObject({
			status: 'OPEN',
			location_storage_point_id: POINT_A.id,
			location_storage_zone: POINT_A.name
		});
		await expect(board.detail(name)).toContainText(POINT_A.name);
		await board.closeDetail(name);
		await expect(board.card(name)).toContainText(POINT_A.name);

		// Setup (not the subject): one entry, then back to the board so it is listed.
		await seedEntry(scenario, { poolId }, { item, qty: '2', returner: 'unspecified' });
		await board.gotoBackOffice();
		await board.openDetail(name);
		await board.submitPool(name);

		// Receive into point B, not the pool's own location.
		const receive = await board.openReceive(name);
		await expect(board.receiveStorage(receive)).toContainText(POOL_COPY.unspecifiedPointOption);
		await board.chooseReceiveStorage(receive, POINT_B.name);
		await board.confirmReceive(receive, name);

		await expect(board.detail(name)).toContainText(POOL_COPY.receiveRecord);
		await expect(board.detail(name)).toContainText(POINT_B.name);

		await expect.poll(async () => (await readPool(poolId)).status).toBe('RECEIVED');
		const received = await readPool(poolId);
		expect(received).toMatchObject({
			received_by: wh.user.name,
			received_storage_point_id: POINT_B.id,
			received_storage_zone: POINT_B.name,
			// The location chosen at open is frozen from SUBMITTED on.
			location_storage_point_id: POINT_A.id,
			location_storage_zone: POINT_A.name
		});
		const ledger = await receiveLedgerRows(poolId);
		expect(ledger).toHaveLength(1);
		for (const row of ledger) {
			expect(row).toMatchObject({
				reason: 'receive',
				ref_id: poolId,
				qty: '2',
				lot: {
					note: 'bulk_return_pool',
					storage_point_id: POINT_B.id,
					storage_zone: POINT_B.name
				}
			});
		}
	});

	test('BRP-S2 a shelter with points must name one at receive', async ({ page, scenarioAs }) => {
		const scenario = await scenarioAs('brp_s2');
		const name = poolName(scenario, 'S2');
		const item = await seedReturnableItem(scenario, 's2');
		const pool = await seedOpenPool(scenario, { name });
		await seedEntry(scenario, pool, { item, qty: '1', returner: 'unspecified' });
		const board = new BulkReturnPoolBoard(page);

		await switchUser(page, scenario, 'wh', 'warehouse_staff');
		await board.gotoBackOffice();
		await board.openDetail(name);
		await board.submitPool(name);
		const receive = await board.openReceive(name);

		// Pressing confirm without a point is refused in the UI (the VDU does not enforce it, §9(c)).
		await receive.getByRole('button', { name: POOL_COPY.receiveConfirm, exact: true }).click();
		await expect(
			receive.getByRole('alert').filter({ hasText: POOL_COPY.storageRequired })
		).toBeVisible();
		await expect(receive).toBeVisible();
		expect((await readPool(pool.poolId)).status).toBe('SUBMITTED');
		expect(await receiveLedgerRows(pool.poolId)).toHaveLength(0);

		// The first option is the main store; it does not count as a chosen point.
		await board.receiveStorage(receive).click();
		await expect(page.getByRole('option').first()).toHaveText(POOL_COPY.unspecifiedPointOption);
		await page.getByRole('option', { name: pointOption(POINT_A.name) }).click();
		await board.confirmReceive(receive, name);

		await expect.poll(async () => (await readPool(pool.poolId)).status).toBe('RECEIVED');
		expect(await readPool(pool.poolId)).toMatchObject({
			received_storage_point_id: POINT_A.id,
			received_storage_zone: POINT_A.name
		});
		expect(await receiveLedgerRows(pool.poolId)).toHaveLength(1);
	});
});
