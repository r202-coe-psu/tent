/**
 * Bulk return pool v3 — app gaps that would poison the shared worker shelter if they ran there
 * (BULK_RETURN_POOL_E2E_PLAN.md, GAP BRP-F11). Kept `test.fixme` until the app is fixed.
 */

import { injectSession } from '../helpers/login';
import { expect, test } from './fixtures';
import {
	buildVoidBody,
	CREATED,
	docPath,
	newEntryId,
	poolName,
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
	// GAP: the VDU cannot check that the entry a move / void refers to exists, so such a doc is
	// accepted when it is written directly or replicated before its entry (e.g. edge to central).
	// `resolveBulkReturnEntries` then throws "Void references unknown entry" for the WHOLE overview,
	// and the board shows 'ไม่สามารถโหลดข้อมูลกองรับคืนได้' for every user of the shelter. Desired
	// behaviour: one bad event does not hide every pool. Fails today, hence fixme.
	test.fixme('GAP: BRP-F11 one orphan move/void doc accepted by the VDU makes the pool board fail to load for the whole shelter', async ({
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
	});
});
