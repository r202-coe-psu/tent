/**
 * Bulk return pool — deep link from back-office to the desk (issue #921, PR #980).
 *
 * A distribution_staff user without back-office access who follows a back-office pool link
 * (`/back-office/distribution?view=bulk_pools&pool=<id>`) lands on the desk's returns tab with that
 * pool's detail open, and closing the detail keeps `?tab=returns` (no `pool`).
 *
 * The plain `/back-office/distribution` redirect to `/portal` is covered by
 * distribution-desk-access.test.ts and is not repeated here.
 */

import { seedOpenPool, switchUser, poolName } from './bulk-return-pool';
import { DESK_TAGS } from './distribution-desk-setup';
import { expect, test } from './fixtures';
import { BulkReturnPoolBoard } from './pages/bulk-return-pool.page';
import { DeskPage } from './pages/desk.page';

test.describe('Bulk return pool — desk link for DST (#921)', { tag: DESK_TAGS }, () => {
	test('a DST-only user following a back-office pool link lands on the desk with the pool open', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('brp_desk_link');
		const name = poolName(scenario, 'DeskLink');
		// The pool id comes from the seeding helper (admin API), before the page loads.
		const pool = await seedOpenPool(scenario, { name });
		const board = new BulkReturnPoolBoard(page);

		await switchUser(page, scenario, 'dst', 'distribution_staff');
		await page.goto(
			`/back-office/distribution?view=bulk_pools&pool=${encodeURIComponent(pool.poolId)}`
		);

		await expect
			.poll(() => {
				const url = new URL(page.url());
				return [url.pathname, url.searchParams.get('tab'), url.searchParams.get('pool')];
			})
			.toEqual(['/onsite/distribution', 'returns', pool.poolId]);
		await expect(board.heading()).toBeVisible();
		await board.expectDetail(name);

		await board.closeDetail(name);
		await expect
			.poll(() => {
				const url = new URL(page.url());
				return [url.pathname, url.searchParams.get('tab'), url.searchParams.has('pool')];
			})
			.toEqual(['/onsite/distribution', 'returns', false]);
		await expect(board.heading()).toBeVisible();

		// Leaving returns for another tab keeps the desk route and carries no `pool`. The detail is a
		// modal dialog, so the tab buttons are only reachable once it is closed (above).
		const desk = new DeskPage(page);
		await desk.openTab('food');
		await expect
			.poll(() => {
				const url = new URL(page.url());
				return [url.pathname, url.searchParams.get('tab'), url.searchParams.has('pool')];
			})
			.toEqual(['/onsite/distribution', 'food', false]);

		await desk.openTab('returns');
		await expect
			.poll(() => {
				const url = new URL(page.url());
				return [url.pathname, url.searchParams.get('tab'), url.searchParams.has('pool')];
			})
			.toEqual(['/onsite/distribution', 'returns', false]);
		await expect(board.heading()).toBeVisible();
	});
});
