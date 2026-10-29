/**
 * Bulk return pool v3 — reopen loans of a submitted pool's entry (CR-193 §35, ids BRP-R*).
 *
 * A bulk-return entry cuts the borrower's loan when it is added to a pool. After the pool is
 * SUBMITTED, a shelter manager (or warehouse staff) can reopen the loans that entry cut
 * ("เปิดยอดยืมกลับ") with a reason. Staff who cannot reopen (distribution_staff) are not offered the
 * button and see no reason text.
 *
 * Setup is real, not seeded: the entry is added through the UI so the loan carries
 * `applied_bulk_entry_ids` (the reopen needs the applied ref, which `seedEntry` does not write).
 */

import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
	poolName,
	readDoc,
	readEntries,
	readPool,
	readStatus,
	seedLoan,
	seedOpenPool,
	sortedStrings,
	switchUser
} from './bulk-return-pool';
import { getShelterDocument, seedRecipient, type DistributionScenario } from './distribution';
import { DESK_TAGS } from './distribution-desk-setup';
import { BulkReturnPoolBoard } from './pages/bulk-return-pool.page';

// Copied from src/lib/features/distribution/ui/model/bulk-return-pool-v3.ts (e2e does not import UI).
const REOPEN_ACTION = 'เปิดยอดยืมกลับ';
const REOPEN_REASON_LABEL = 'เหตุผล';
const REOPEN_CONFIRM = 'ยืนยันเปิดยอดยืมกลับ';
const REOPEN_DONE_NOTE = 'เปิดยอดยืมกลับแล้ว';
const REOPEN_BLOCKED_TESTID = 'bulk-return-reopen-blocked';
const reopenSuccessToast = (count: number) => `เปิดยอดยืมกลับแล้ว ${count} รายการ`;

/** An evacuee's 2-item loan fully returned through one UI entry into a pool that is then SUBMITTED. */
async function seedSubmittedEntryThatCutLoan(
	page: Page,
	scenario: DistributionScenario,
	tag: string
) {
	const name = poolName(scenario, tag);
	const pool = await seedOpenPool(scenario, { name });
	const evacuee = await seedRecipient(scenario, `Brp${scenario.namespace.slice(-6)}`, 'Reopen');
	const loan = await seedLoan(scenario, evacuee, tag.toLowerCase(), '2');
	const board = new BulkReturnPoolBoard(page);

	// Shelter manager adds the entry at back-office (cuts the loan), then submits the pool.
	await switchUser(page, scenario, 'sm', 'shelter_manager');
	await board.gotoBackOffice();
	await board.addFromBoard({
		pool: name,
		returner: evacuee,
		lines: [{ item: loan.item, qty: '2' }]
	});
	await expect.poll(() => readStatus(loan.logId)).toBe('returned');
	const [entry] = await readEntries(pool.poolId);
	expect((await readDoc(loan.logId)).applied_bulk_entry_ids).toEqual([entry._id]);

	await board.gotoBackOffice();
	await board.openDetail(name);
	await board.submitPool(name);
	await expect.poll(async () => (await readPool(pool.poolId)).status).toBe('SUBMITTED');

	return { board, name, pool, loan, entry };
}

test.describe('Bulk return pool v3 — reopen loans (BRP-R)', { tag: DESK_TAGS }, () => {
	test('BRP-R1 shelter manager reopens the loan an entry cut after the pool was submitted', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('brp_r1');
		const { board, name, loan, entry } = await seedSubmittedEntryThatCutLoan(page, scenario, 'R1');

		const detail = board.detail(name);
		const row = board.entryRow(name, loan.item.name);
		await expect(row).toBeVisible();
		await expect(row.getByText(REOPEN_DONE_NOTE)).toHaveCount(0);
		await row.getByRole('button', { name: REOPEN_ACTION, exact: true }).click();

		// The dialog is titled with the action; confirm stays disabled until a reason is typed.
		const dialog = page.getByRole('dialog', { name: REOPEN_ACTION });
		await expect(dialog).toBeVisible();
		const confirm = dialog.getByRole('button', { name: REOPEN_CONFIRM, exact: true });
		await expect(confirm).toBeDisabled();
		const reason = `E2E reopen ${scenario.namespace}`;
		await dialog.getByLabel(REOPEN_REASON_LABEL).fill(reason);
		await expect(confirm).toBeEnabled();
		await confirm.click();

		await expect(board.toast(reopenSuccessToast(1))).toBeVisible();
		await expect(dialog).toBeHidden();

		// The loan is outstanding again and no longer lists the entry as applied.
		await expect.poll(() => readStatus(loan.logId)).toBe('active');
		const log = await getShelterDocument(loan.logId);
		expect(log).toMatchObject({ status: 'active', qty_returned: '0' });
		expect(sortedStrings(log?.applied_bulk_entry_ids)).not.toContain(entry._id);

		// The entry row shows the reopened state and no longer offers the button.
		await expect(row.getByText(REOPEN_DONE_NOTE)).toBeVisible();
		await expect(row.getByRole('button', { name: REOPEN_ACTION, exact: true })).toHaveCount(0);
		await expect(detail).toBeVisible();
	});

	test('BRP-R2 distribution staff sees the same submitted entry without any reopen action', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('brp_r2');
		const { board, name, loan } = await seedSubmittedEntryThatCutLoan(page, scenario, 'R2');

		// Positive control: the manager is offered the button for this very entry. submitPool leaves
		// the pool sheet open, so use it directly (a fresh openDetail would click behind the modal).
		const managerRow = board.entryRow(name, loan.item.name);
		await expect(
			managerRow.getByRole('button', { name: REOPEN_ACTION, exact: true })
		).toBeVisible();
		await board.closeDetail(name);

		// DST works at the desk; the pool board is read-only for it once the pool is SUBMITTED.
		await switchUser(page, scenario, 'dst', 'distribution_staff');
		await board.gotoDesk();
		await board.openDetail(name);
		const row = board.entryRow(name, loan.item.name);
		await expect(row).toBeVisible();
		// The applied-loan line only renders after the loan refs loaded, so the checks below are not
		// vacuous (the reopen decision waits for the same data).
		await expect(row).toContainText(/ตัดยอดยืม/);

		await expect(row.getByRole('button', { name: REOPEN_ACTION })).toHaveCount(0);
		await expect(row.getByText(REOPEN_ACTION)).toHaveCount(0);
		await expect(row.getByTestId(REOPEN_BLOCKED_TESTID)).toHaveCount(0);
		await expect(board.detail(name).getByText(REOPEN_REASON_LABEL)).toHaveCount(0);

		// Nothing changed for the loan.
		expect(await readStatus(loan.logId)).toBe('returned');
	});
});
