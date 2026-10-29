/**
 * Bulk return pool — deep link from back-office to the desk (issue #921, PR #980).
 *
 * A distribution_staff user without back-office access who follows a back-office pool link
 * (`/back-office/distribution?view=bulk_pools&pool=<id>`) lands on the desk's returns step
 * (supplies mode) with that pool's detail open, and closing the detail keeps
 * `?mode=supplies&tab=returns` (no `pool`).
 *
 * Two more cases: a desk link to a pool that does not exist shows the "pool not found" toast and
 * opens the returns step with no `pool`; and a mode-changing desk link followed client-side with an
 * unsaved food draft asks first, and "stay" keeps the mode, draft and URL (FR-DFS-05).
 *
 * The plain `/back-office/distribution` redirect to `/portal` is covered by
 * distribution-desk-access.test.ts and is not repeated here.
 */

import type { Page } from '@playwright/test';
import { seedOpenPool, switchUser, poolName } from './bulk-return-pool';
import { scenarioPoint, seedItemWithStock, seedRecipient, seedTicket } from './distribution';
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
		const deskUrl = () => deskUrlOf(page);

		await switchUser(page, scenario, 'dst', 'distribution_staff');
		await page.goto(
			`/back-office/distribution?view=bulk_pools&pool=${encodeURIComponent(pool.poolId)}`
		);

		await expect
			.poll(deskUrl)
			.toEqual(['/onsite/distribution', 'supplies', 'returns', pool.poolId]);
		await expect(board.heading()).toBeVisible();
		await board.expectDetail(name);

		// Closing the detail rewrites the whole desk URL without `pool`.
		await board.closeDetail(name);
		await expect.poll(deskUrl).toEqual(['/onsite/distribution', 'supplies', 'returns', null]);
		await expect(board.heading()).toBeVisible();

		// Browser Back restores the desk from `page.state.deskSearch`: a pool the user closed must stay
		// closed, not reopen from the stale `pool` param of the entry the link first landed on.
		// Client-side navigation away (the desk renders no in-app link): SvelteKit's router intercepts
		// the anchor click, so Back below is a router popstate, not a fresh document load.
		await page.evaluate(() => {
			const a = document.createElement('a');
			a.href = '/portal';
			document.body.append(a);
			a.click();
		});
		await expect.poll(() => new URL(page.url()).pathname).toBe('/portal');
		await page.goBack();
		await expect.poll(deskUrl).toEqual(['/onsite/distribution', 'supplies', 'returns', null]);
		await expect(board.heading()).toBeVisible();
		await expect(board.detail(name)).toBeHidden();

		// Leaving returns for another step of the same mode keeps the mode and carries no `pool`. The
		// detail is a modal dialog, so the tab buttons are only reachable once it is closed (above).
		const desk = new DeskPage(page);
		await desk.openTab('supplies');
		await expect.poll(deskUrl).toEqual(['/onsite/distribution', 'supplies', 'supplies', null]);

		await desk.openTab('receive');
		await expect.poll(deskUrl).toEqual(['/onsite/distribution', 'supplies', 'receive', null]);

		await desk.openTab('returns');
		await expect.poll(deskUrl).toEqual(['/onsite/distribution', 'supplies', 'returns', null]);
		await expect(board.heading()).toBeVisible();
	});

	test('a pool link to a pool that does not exist warns and opens the returns step with no pool', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('brp_desk_link_missing');
		const board = new BulkReturnPoolBoard(page);
		const desk = new DeskPage(page);

		await switchUser(page, scenario, 'dst', 'distribution_staff');
		await page.goto(
			`/onsite/distribution?mode=supplies&tab=returns&pool=${encodeURIComponent('bulk_return_pool:does-not-exist')}`
		);

		await expect(desk.toast('ไม่พบกองนี้ อาจถูกลบหรืออยู่ศูนย์อื่น')).toBeVisible();
		await expect
			.poll(() => deskUrlOf(page))
			.toEqual(['/onsite/distribution', 'supplies', 'returns', null]);
		await expect(board.heading()).toBeVisible();
	});

	// A full `page.goto` would reload the desk and lose the draft, so the link is followed through
	// the SvelteKit router (anchor click), as with the '/portal' hop above.
	// `foodSetup` is local to distribution-desk-handover.test.ts (a spec file cannot be imported),
	// so the few setup lines it needs are repeated here.
	test('a mode-changing desk link with an unsaved food draft asks first; staying keeps the draft', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('brp_desk_link_draft');
		const item = await seedItemWithStock(scenario, {
			name: `E2E meal ${scenario.namespace}`,
			stockQty: '50',
			returnable: false,
			typeClass: 'CONSUMABLE'
		});
		const ticket = await seedTicket(scenario, {
			type: 'food',
			status: 'DISTRIBUTING',
			meal: 'lunch',
			lines: [{ item, allocatedQty: '10' }]
		});
		const recipient = await seedRecipient(
			scenario,
			`Food${scenario.namespace.slice(-6)}`,
			'Recipient'
		);
		const desk = new DeskPage(page);
		await desk.goto();
		await desk.openTab('food');
		await desk.selectPoint(scenarioPoint(scenario));
		await desk.selectTicket('food', ticket);
		const qty = page.locator('#food-qty-input');

		await desk.itemButton(item.name).click();
		await desk.chooseRecipientBySearch(recipient);
		await desk.fillFoodQty('2');

		await page.evaluate(() => {
			const a = document.createElement('a');
			a.href = '/onsite/distribution?mode=supplies&tab=returns';
			document.body.append(a);
			a.click();
		});
		const confirm = page.getByRole('alertdialog', { name: /สลับไปโหมดสิ่งของ/ });
		await expect(confirm).toBeVisible();
		await confirm.getByRole('button', { name: 'อยู่โหมดเดิม' }).click();
		await expect(confirm).toBeHidden();
		await expect(desk.modeButton('food')).toHaveAttribute('aria-pressed', 'true');
		await expect(qty).toHaveValue('2');
		await expect
			.poll(() => deskUrlOf(page))
			.toEqual(['/onsite/distribution', 'food', 'food', null]);
	});
});

/** [pathname, mode, tab, pool]: `pool` is the id, or `null` when absent. */
function deskUrlOf(page: Page): Array<string | null> {
	const url = new URL(page.url());
	return [
		url.pathname,
		url.searchParams.get('mode'),
		url.searchParams.get('tab'),
		url.searchParams.get('pool')
	];
}
