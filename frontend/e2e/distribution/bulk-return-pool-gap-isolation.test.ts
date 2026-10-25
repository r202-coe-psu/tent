/**
 * Bulk return pool v3 — regression tests for fixed app gaps that would poison the shared worker
 * shelter if they ran there (BULK_RETURN_POOL_E2E_PLAN.md, GAP BRP-F11 orphan move/void and
 * GAP BRP-F12 move gap, both fixed).
 */

import { injectSession } from '../helpers/login';
import { expect, test } from './fixtures';
import {
	buildMoveBody,
	buildVoidBody,
	CREATED,
	docPath,
	newEntryId,
	poolName,
	seedEntry,
	seedOpenPool,
	seedReturnableItem
} from './bulk-return-pool';
import { addScenarioActor, couchAsUser, roleSet } from './distribution';
import { DESK_TAGS } from './distribution-desk-setup';
import { BulkReturnPoolBoard } from './pages/bulk-return-pool.page';

// Its own storage-point option (different from the storage spec's) makes Playwright start a
// separate worker, and so a separate shelter: enabling the test can never poison other specs.
// Playwright only allows a worker-forcing `test.use` at the top level, hence a file of its own.
test.use({
	shelterStoragePoints: [
		[{ id: 'sp-e2e-gap-isolation', name: 'E2E GAP isolation', type: 'general' }],
		{ scope: 'worker' }
	]
});

test.describe('Bulk return pool v3 — GAP isolation', { tag: DESK_TAGS }, () => {
	// Regression test for the fixed GAP BRP-F11: the VDU cannot check that the entry a move / void
	// refers to exists, so such a doc is accepted when it is written directly or replicated before
	// its entry (e.g. edge to central). The fold used to throw "Void references unknown entry" for
	// the WHOLE overview and the board showed 'ไม่สามารถโหลดข้อมูลกองรับคืนได้' for every user of the
	// shelter. Now the orphan is skipped, the board loads and the pool card shows "รอซิงก์ <n>".
	test('GAP: BRP-F11 one orphan move/void doc accepted by the VDU makes the pool board fail to load for the whole shelter', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('brp_f11');
		const name = poolName(scenario, 'F11');
		const pool = await seedOpenPool(scenario, { name });
		const item = await seedReturnableItem(scenario, 'f11');
		const board = new BulkReturnPoolBoard(page);

		const dst = await addScenarioActor(scenario, 'dst', roleSet('distribution_staff', 'flat'));
		const orphan = buildVoidBody({
			entryId: newEntryId(),
			poolId: pool.poolId,
			itemId: item.itemId,
			qty: '1',
			createdBy: dst.user.name
		});
		expect((await couchAsUser(dst.session, 'PUT', docPath(orphan._id), orphan)).status).toBe(
			CREATED
		);

		await injectSession(page, dst.user, dst.session);
		await board.gotoDesk();
		await expect(board.card(name)).toBeVisible();
		await expect(board.card(name)).toContainText('รอซิงก์');
	});
});

// A second describe in the same file: Playwright forbids a worker-forcing `test.use` inside a
// describe, so this shares the isolation worker / shelter of the F11 test above. That is fine: the
// top-level `test.use` already separates the whole file from every other spec, and each test uses
// its own scenario, pools and entry.
test.describe('Bulk return pool v3 — GAP isolation (move gap)', { tag: DESK_TAGS }, () => {
	// Regression test for the fixed GAP BRP-F12: move seq 2 replicated before move seq 1 made the fold
	// throw "Move seq must be contiguous from 1" for the WHOLE overview. Now the entry counts in no
	// pool while its chain has a gap, the pools it touches show "รอซิงก์ <n>", and the board heals
	// itself once the missing move arrives.
	test('GAP: BRP-F12 a move seq replicated before an earlier seq crashed the pool board for the whole shelter', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('brp_f12');
		const nameA = poolName(scenario, 'F12A');
		const nameB = poolName(scenario, 'F12B');
		const nameC = poolName(scenario, 'F12C');
		const poolA = await seedOpenPool(scenario, { name: nameA });
		const poolB = await seedOpenPool(scenario, { name: nameB });
		const poolC = await seedOpenPool(scenario, { name: nameC });
		const item = await seedReturnableItem(scenario, 'f12');
		const entryId = await seedEntry(scenario, poolA, {
			item,
			qty: '1',
			returner: 'unspecified'
		});
		const board = new BulkReturnPoolBoard(page);

		const dst = await addScenarioActor(scenario, 'dst', roleSet('distribution_staff', 'flat'));
		const move = (seq: number, from: string, to: string) =>
			buildMoveBody({
				entryId,
				seq,
				fromPoolId: from,
				toPoolId: to,
				itemId: item.itemId,
				qty: '1',
				createdBy: dst.user.name
			});

		// Only seq 2 (B to C) has arrived: the chain has a gap.
		const second = move(2, poolB.poolId, poolC.poolId);
		expect((await couchAsUser(dst.session, 'PUT', docPath(second._id), second)).status).toBe(
			CREATED
		);

		await injectSession(page, dst.user, dst.session);
		await board.gotoDesk();
		// The board loads (no crash) and every pool the entry touches is flagged. The entry counts in
		// no pool, so each card shows a zero entry count.
		for (const name of [nameA, nameB, nameC]) {
			await expect(board.card(name)).toBeVisible();
			await expect(board.card(name)).toContainText('รอซิงก์');
			await expect(board.card(name)).toContainText(/(?<!\d)0\s*รายการ/);
		}

		// Seq 1 (A to B) arrives: the entry is counted in its final pool C and nothing is pending.
		const first = move(1, poolA.poolId, poolB.poolId);
		expect((await couchAsUser(dst.session, 'PUT', docPath(first._id), first)).status).toBe(CREATED);

		await board.gotoDesk();
		await expect(board.card(nameC)).toContainText(/(?<!\d)1\s*รายการ/);
		for (const name of [nameA, nameB]) {
			await expect(board.card(name)).toContainText(/(?<!\d)0\s*รายการ/);
		}
		for (const name of [nameA, nameB, nameC]) {
			await expect(board.card(name)).not.toContainText('รอซิงก์');
		}
	});
});
