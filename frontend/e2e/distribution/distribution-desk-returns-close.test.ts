/**
 * Distribution Desk — getting things back and closing out (plan §4.6–§4.7):
 * tab 4 loan return counter, tab 5 shift close and the warehouse hand-off.
 * T5-1 (zero returns → COMPLETED) is Journey A in distribution-ticket-lifecycle.test.ts.
 */

import type { Page, Route } from '@playwright/test';
import { subQty } from '../../src/lib/utils/qty';
import { COUCH_BASE } from '../helpers/couch';
import { injectSession } from '../helpers/login';
import { expect, test } from './fixtures';
import { expectTicketLogs, expectTicketStatus, ledgerRows } from './checks';
import {
	addScenarioActor,
	findShelterDocuments,
	getShelterDocument,
	roleSet,
	scenarioPoint,
	seedDistributionLog,
	seedItemWithStock,
	seedRecipient,
	seedTicket,
	type DistributionScenario,
	type SeededItem,
	type SeededRecipient,
	type SeededTicket
} from './distribution';
import { BackOfficePage } from './pages/back-office.page';
import { DeskPage } from './pages/desk.page';
import { DESK_TAGS } from './distribution-desk-setup';

/** Attempts `withRetry` (src/lib/db/couch-db.ts, MAX_RETRIES) makes on a 5xx before giving up. */
const WITH_RETRY_ATTEMPTS = 3;

// Journey C (= T4-1) plus every other way a loan leaves the counter.
interface LoanSetup {
	desk: DeskPage;
	item: SeededItem;
	ticket: SeededTicket;
	recipient: SeededRecipient;
	logId: string;
}

/** Issue a `qty` loan through tab 3, then land on tab 4 with the borrower selected. */
async function issueLoan(
	page: Page,
	scenario: DistributionScenario,
	qty: string
): Promise<LoanSetup> {
	const item = await seedItemWithStock(scenario, {
		name: `E2E durable ${scenario.namespace}`,
		stockQty: qty,
		returnable: true,
		typeClass: 'DURABLE'
	});
	const recipient = await seedRecipient(
		scenario,
		`Loan${scenario.namespace.slice(-6)}`,
		'Recipient'
	);
	const ticket = await seedTicket(scenario, {
		type: 'supplies',
		status: 'DISTRIBUTING',
		lines: [{ item, allocatedQty: qty }]
	});
	const desk = new DeskPage(page);
	await desk.goto();
	await desk.openTab('supplies');
	await desk.selectPoint(scenarioPoint(scenario));
	await desk.selectTicket('supplies', ticket);
	await desk.itemButton(item.name).click();
	await desk.chooseRecipientBySearch(recipient);
	await desk.fillSuppliesQty(qty);
	await desk.suppliesSubmit('loan').click();
	await expect(desk.toast(/บันทึกยืมสิ่งของสำเร็จ/)).toBeVisible();
	const [log] = await expectTicketLogs(ticket, item, 1, 'Loan issuance');
	expect(log.status).toBe('active');

	await desk.openTab('returns');
	await desk.chooseRecipientBySearch(recipient);
	await expect(desk.loanCard(item.name)).toBeVisible();
	return { desk, item, ticket, recipient, logId: log._id };
}

async function expectLog(logId: string, fields: Record<string, unknown>, checkpoint: string) {
	await expect
		.poll(async () => (await getShelterDocument(logId))?.status, { message: checkpoint })
		.toBe(fields.status);
	expect(await getShelterDocument(logId)).toMatchObject(fields);
}

// T5-1 (zero returns → COMPLETED) is Journey A in distribution-ticket-lifecycle.test.ts.
interface CloseSetup {
	desk: DeskPage;
	kit: SeededItem;
	blanket: SeededItem;
	ticket: SeededTicket;
}

/** DISTRIBUTING ticket: kit 10 (6 handed out), blanket 4 (`loaned` out as active loans). */
async function closeSetup(
	page: Page,
	scenario: DistributionScenario,
	loaned = '0'
): Promise<CloseSetup> {
	const kit = await seedItemWithStock(scenario, {
		name: `E2E close kit ${scenario.namespace}`,
		stockQty: '10',
		returnable: false,
		typeClass: 'CONSUMABLE'
	});
	const blanket = await seedItemWithStock(scenario, {
		name: `E2E close blanket ${scenario.namespace}`,
		stockQty: '4',
		returnable: true,
		typeClass: 'DURABLE'
	});
	const ticket = await seedTicket(scenario, {
		type: 'supplies',
		status: 'DISTRIBUTING',
		lines: [
			{ item: kit, allocatedQty: '10' },
			{ item: blanket, allocatedQty: '4' }
		]
	});
	const person = await seedRecipient(scenario, `Close${scenario.namespace.slice(-6)}`, 'Recipient');
	await seedDistributionLog(scenario, { ticket, item: kit, recipient: person, qty: '6' });
	if (loaned !== '0') {
		await seedDistributionLog(scenario, {
			ticket,
			item: blanket,
			recipient: person,
			qty: loaned,
			returnable: true
		});
	}
	const desk = new DeskPage(page);
	await desk.goto();
	await desk.openTab('reconciliation', 'supplies');
	await desk.selectPoint(scenarioPoint(scenario));
	await desk.selectTicket('reconciliation', ticket);
	await expect(desk.reconciliationHeading(ticket)).toBeVisible();
	return { desk, kit, blanket, ticket };
}

test.describe('Tab 4 — loan return counter (plan §4.6)', { tag: DESK_TAGS }, () => {
	test('Journey C: a durable loan remains a persisted log through partial and final physical returns', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('durable_loan');
		const { desk, item, recipient, logId } = await issueLoan(page, scenario, '5');

		await desk.returnPhysical(item.name, '2');
		await expectLog(
			logId,
			{ status: 'partially_returned', qty: '5', qty_returned: '2' },
			'Partial return'
		);
		const partial = await getShelterDocument(logId);
		expect(subQty(String(partial?.qty), String(partial?.qty_returned))).toBe('3');
		expect((await ledgerRows('receive', logId)).map((r) => r.qty)).toEqual(['2']);
		await expect(desk.loanCard(item.name)).toContainText('คงค้าง');

		await desk.returnPhysical(item.name, '3');
		await expectLog(
			logId,
			{ status: 'returned', qty_returned: '5', clear_reason: 'routine' },
			'Final return'
		);
		expect((await ledgerRows('receive', logId)).map((r) => r.qty).sort()).toEqual(['2', '3']);
		const outstanding = await findShelterDocuments(
			(doc) =>
				doc.type === 'distribution_log' &&
				doc.recipient_id === recipient.recipientId &&
				['active', 'partially_returned'].includes(String(doc.status))
		);
		expect(outstanding.map((doc) => doc._id)).not.toContain(logId);
	});

	test('T4-2/T4-3 a return above the outstanding qty is blocked; condition is recorded', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('loan_over_return');
		const { desk, item, logId } = await issueLoan(page, scenario, '3');

		await desk.loanCard(item.name).getByRole('button', { name: 'รับคืนจากผู้ยืม' }).click();
		const dialog = page.getByRole('dialog', { name: /ตรวจรับคืนพัสดุเข้าคลัง/ });
		await dialog.getByLabel(/จำนวนที่ตรวจรับคืนครั้งนี้/).fill('4');
		await expect(dialog.getByRole('button', { name: /ยืนยันตรวจรับคืนเข้าคลัง/ })).toBeDisabled();
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
		expect(await ledgerRows('receive', logId)).toHaveLength(0);

		await desk.returnPhysical(item.name, '3', /ต้องซ่อมบำรุง/);
		await expectLog(
			logId,
			{ status: 'returned', qty_returned: '3', condition_on_return: 'MAINTENANCE' },
			'Condition return'
		);
	});

	for (const [reason, label] of [
		['lost', 'สูญหาย'],
		['waived', 'ยกเว้นการคืน']
	] as const) {
		test(`T4-4/T4-5 closing a loan as ${reason} writes no stock receipt`, async ({
			page,
			scenarioAs
		}) => {
			const scenario = await scenarioAs(`loan_clear_${reason}`);
			const { desk, item, logId } = await issueLoan(page, scenario, '2');

			await desk
				.loanCard(item.name)
				.getByRole('button', { name: /ปิดรายการโดยไม่มีของคืน/ })
				.click();
			const dialog = desk.nonPhysicalDialog();
			await expect(dialog).toBeVisible();
			await dialog.getByLabel(label, { exact: false }).first().check();
			const confirm = dialog.getByRole('button', { name: 'ยืนยันตัดจำหน่ายรายการ' });
			await expect(confirm).toBeDisabled();
			await dialog.locator('#clear-notes-input').fill(`E2E ${label}`);
			await confirm.click();
			await expect(dialog).toBeHidden();

			await expectLog(
				logId,
				{ status: reason, clear_reason: reason, returned_by: scenario.user.name },
				`Non-physical clear (${reason})`
			);
			expect(await ledgerRows('receive', logId)).toHaveLength(0);
			const reservations = await findShelterDocuments(
				(doc) => doc.type === 'loan_return_reservation' && doc.distribution_log_id === logId
			);
			expect(reservations.map((doc) => doc.mode)).toContain('NON_PHYSICAL');
		});
	}

	test('T4-10/T4-11 the counter starts empty and lists cleared loans as closed history', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('loan_history');
		const desk = new DeskPage(page);
		await desk.goto();
		await desk.openTab('returns');
		await expect(page.getByText('สแกน QR ผู้ที่นำของมาคืน')).toBeVisible();
		await expect(page.getByRole('button', { name: 'บุคคลภายนอก' })).toHaveCount(0);

		const { item, logId } = await issueLoan(page, scenario, '1');
		await desk.returnPhysical(item.name, '1');
		await expectLog(logId, { status: 'returned' }, 'Return before history');
		await expect(
			page.getByRole('button', { name: /ประวัติรายการยืมที่ปิดแล้ว \(1 รายการ\)/ })
		).toBeVisible();
	});

	test('T4-8 nothing is recorded while central is unreachable; the same return succeeds after reconnect', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('loan_offline');
		const { desk, item, logId } = await issueLoan(page, scenario, '2');

		// Central drops: every app → CouchDB request fails, so the desk marks itself disconnected.
		// The browser requests COUCH_BASE directly (the `/couch` hop happens inside the helper's
		// route.fetch), so abort there; a later route runs before the helper's.
		const centralDown = (route: Route) => route.abort('internetdisconnected');
		await page.route(`${COUCH_BASE}/**`, centralDown);
		await desk.loanCard(item.name).getByRole('button', { name: 'รับคืนจากผู้ยืม' }).click();
		const dialog = page.getByRole('dialog', { name: /ตรวจรับคืนพัสดุเข้าคลัง/ });
		await dialog.getByLabel(/จำนวนที่ตรวจรับคืนครั้งนี้/).fill('2');
		await dialog.getByRole('button', { name: /ยืนยันตรวจรับคืนเข้าคลัง/ }).click();
		await expect(page.getByText('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้', { exact: false })).toBeVisible({
			timeout: 15_000
		});
		await expect(dialog).toBeVisible();
		expect(await getShelterDocument(logId)).toMatchObject({ status: 'active' });
		expect(await ledgerRows('receive', logId)).toHaveLength(0);

		// The outage submit is still in the app's retry backoff. Reconnecting before it settles lets
		// its last retry succeed and close the dialog by itself, so wait until it has given up.
		const confirm = dialog.getByRole('button', { name: /ยืนยันตรวจรับคืนเข้าคลัง/ });
		await expect(dialog.getByRole('button', { name: /กำลังบันทึกรับคืน\.\.\./ })).toHaveCount(0, {
			timeout: 30_000
		});
		await expect(confirm).toBeEnabled();

		// Back online: the live `_changes` poll reconnects the desk without a reload (the
		// banner's retry button sits under the dialog's overlay).
		await page.unroute(`${COUCH_BASE}/**`, centralDown); // keep the helper's own route
		await expect(page.getByText('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้', { exact: false })).toBeHidden({
			timeout: 20_000
		});
		await dialog
			.getByRole('button', { name: /ยืนยันตรวจรับคืนเข้าคลัง|ดำเนินการต่อให้สมบูรณ์/ })
			.click();
		await expect(dialog).toBeHidden();
		await expectLog(logId, { status: 'returned', qty_returned: '2' }, 'Return after reconnect');
		expect((await ledgerRows('receive', logId)).map((r) => r.qty)).toEqual(['2']);
	});

	test('T4-9 a return interrupted after the stock receipt resumes without counting stock twice', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('loan_resume');
		const { desk, item, recipient, logId } = await issueLoan(page, scenario, '2');

		// The log update is the last write of a counter return: fail it so the operation stops
		// after its reservation and stock receipt are already persisted.
		let failLogWrites = true;
		let failedPuts = 0;
		await page.route(
			(url) => url.pathname.includes(encodeURIComponent(logId)),
			async (route) => {
				if (failLogWrites && route.request().method() === 'PUT') {
					failedPuts += 1;
					await route.fulfill({ status: 500, body: '{"error":"e2e"}' });
					return;
				}
				await route.fallback();
			}
		);
		await desk.loanCard(item.name).getByRole('button', { name: 'รับคืนจากผู้ยืม' }).click();
		const dialog = page.getByRole('dialog', { name: /ตรวจรับคืนพัสดุเข้าคลัง/ });
		await dialog.getByLabel(/จำนวนที่ตรวจรับคืนครั้งนี้/).fill('2');
		await dialog.getByRole('button', { name: /ยืนยันตรวจรับคืนเข้าคลัง/ }).click();
		await expect.poll(async () => (await ledgerRows('receive', logId)).length).toBe(1);

		// Keep the fault up until the app's withRetry (src/lib/db/couch-db.ts, MAX_RETRIES = 3 with
		// 200/400ms backoff) has exhausted every attempt and marked the endpoint disconnected;
		// lifting it earlier lets a later retry succeed and close the loan.
		await expect.poll(() => failedPuts).toBeGreaterThanOrEqual(WITH_RETRY_ATTEMPTS);
		await expect(page.getByText('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้', { exact: false })).toBeVisible({
			timeout: 15_000
		});
		expect(await getShelterDocument(logId)).toMatchObject({ status: 'active' });

		failLogWrites = false;
		await page.reload();
		await desk.openTab('returns');
		await desk.chooseRecipientBySearch(recipient);
		// Writes are gated on the endpoint being connected again.
		await expect(page.getByText('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้', { exact: false })).toBeHidden({
			timeout: 20_000
		});
		await desk.loanCard(item.name).getByRole('button', { name: 'รับคืนจากผู้ยืม' }).click();
		// Past the stock write the operation can only go forward: inputs are locked to it.
		await expect(dialog.getByText('รายการนี้บันทึกลงสต็อกแล้ว ไม่สามารถยกเลิกได้')).toBeVisible();
		await expect(dialog.getByLabel(/จำนวนที่ตรวจรับคืนครั้งนี้/)).toBeDisabled();
		await dialog.getByRole('button', { name: 'ดำเนินการต่อให้สมบูรณ์' }).click();
		await expect(dialog).toBeHidden();

		await expectLog(logId, { status: 'returned', qty_returned: '2' }, 'Resumed return');
		expect((await ledgerRows('receive', logId)).map((r) => r.qty)).toEqual(['2']);
	});
});

test.describe('Tab 5 — shift close and returns (plan §4.7)', { tag: DESK_TAGS }, () => {
	test('T5-2/T5-5 declaring returns closes the shift with per-item figures, then submits to the warehouse', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('close_with_returns');
		const { desk, kit, blanket, ticket } = await closeSetup(page, scenario);

		await desk.closeShift({ [kit.name]: '4', [blanket.name]: '4' });
		await expect(desk.toast(/อยู่ในสถานะปิดรอบแล้ว/)).toBeVisible();
		await expectTicketStatus(ticket, 'SHIFT_CLOSED', 'Close-shift checkpoint');
		expect((await getShelterDocument(ticket.ticketId))?.items).toMatchObject([
			{ item_id: kit.itemId, distributed_qty: '6', returned_qty: '4', discrepancy_qty: '0' },
			{ item_id: blanket.itemId, distributed_qty: '0', returned_qty: '4', discrepancy_qty: '0' }
		]);

		await page.getByRole('button', { name: /ส่งคืนพัสดุกลับคลังกลาง/ }).click();
		await expect(desk.toast(/รอคลังตรวจรับ/)).toBeVisible();
		await expectTicketStatus(ticket, 'RETURN_PENDING_RECEIPT', 'Submit-returns checkpoint');
		await expect(
			desk.reconciliationCard(ticket).getByText('รอคลังตรวจรับคืน', { exact: true })
		).toBeVisible();
	});

	test('T5-3 negative or above-in-hand returns are rejected before close', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('close_validation');
		const { desk, kit, blanket, ticket } = await closeSetup(page, scenario);
		const confirm = page.getByRole('button', { name: /ยืนยันปิดรอบแจกจ่าย/ });

		await desk.returnQtyInput(blanket.name).fill('0');
		await desk.returnQtyInput(kit.name).fill('-1');
		await desk.returnQtyInput(kit.name).blur();
		await expect(page.getByText('จำนวนส่งคืนต้องไม่ติดลบ (≥ 0)')).toBeVisible();
		await expect(confirm).toBeDisabled();

		await desk.returnQtyInput(kit.name).fill('5');
		await desk.returnQtyInput(kit.name).blur();
		await expect(page.getByText('จำนวนส่งคืน (5) ต้องไม่เกินจำนวนคงเหลือในมือ (4)')).toBeVisible();
		await expect(confirm).toBeDisabled();

		await desk.returnQtyInput(kit.name).fill('4');
		await expect(confirm).toBeEnabled();
		await expectTicketStatus(ticket, 'DISTRIBUTING', 'Nothing closed by invalid input');
	});

	// D-E3: outstanding loans do not block the close (FR-DDS-06) — they count as distributed.
	test('T5-4 outstanding loans are flagged but do not block the close', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('close_open_loans');
		const { desk, kit, blanket, ticket } = await closeSetup(page, scenario, '2');

		await expect(desk.reconciliationCard(ticket)).toContainText('ของยืมค้างคืน 2');
		await desk.closeShift({ [kit.name]: '4', [blanket.name]: '2' });
		await expectTicketStatus(ticket, 'SHIFT_CLOSED', 'Close with open loans');
		expect((await getShelterDocument(ticket.ticketId))?.items).toMatchObject([
			{ item_id: kit.itemId, distributed_qty: '6', returned_qty: '4' },
			{ item_id: blanket.itemId, distributed_qty: '2', returned_qty: '2', discrepancy_qty: '0' }
		]);
	});

	for (const capability of ['warehouse_staff', 'supply_coordinator'] as const) {
		test(`T5-7 ${capability} verifies the return and completes the ticket in back-office`, async ({
			page,
			scenarioAs
		}) => {
			const scenario = await scenarioAs(`close_handoff_${capability}`);
			const { desk, kit, blanket, ticket } = await closeSetup(page, scenario);
			await desk.closeShift({ [kit.name]: '4', [blanket.name]: '4' });
			await expectTicketStatus(ticket, 'SHIFT_CLOSED', 'Close-shift checkpoint');
			await page.getByRole('button', { name: /ส่งคืนพัสดุกลับคลังกลาง/ }).click();
			await expectTicketStatus(ticket, 'RETURN_PENDING_RECEIPT', 'Submit-returns checkpoint');

			const warehouse = await addScenarioActor(
				scenario,
				capability,
				roleSet(capability, 'compound')
			);
			await injectSession(page, warehouse.user, warehouse.session);
			const backOffice = new BackOfficePage(page);
			await backOffice.receiveWarehouseReturn(ticket, kit, '3', '5');
			// CR-208: the verified return goes back into the lot the kit was dispatched from.
			const returns = await ledgerRows('distribution_return', ticket.ticketId);
			expect(returns.find((r) => r.item_id === kit.itemId)).toMatchObject({
				qty: '3',
				lot_ref: kit.lotId
			});
			await backOffice.completeTicket(ticket);
			expect(await getShelterDocument(ticket.ticketId)).toMatchObject({ status: 'COMPLETED' });
		});
	}

	// Regression: with two tickets at one point and no explicit pick, closing the shown ticket
	// used to swap the card to the other ticket mid-task (selection fell back to the
	// supplies tab's active ticket, which changes once the shown one leaves DISTRIBUTING).
	test('T5-8 the closed ticket stays on screen through close and submit', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('close_selection');
		const item = await seedItemWithStock(scenario, {
			name: `E2E close pick ${scenario.namespace}`,
			stockQty: '10',
			returnable: false,
			typeClass: 'CONSUMABLE'
		});
		const tickets = [
			await seedTicket(scenario, {
				type: 'supplies',
				status: 'DISTRIBUTING',
				lines: [{ item, allocatedQty: '5' }]
			}),
			await seedTicket(scenario, {
				type: 'supplies',
				status: 'DISTRIBUTING',
				lines: [{ item, allocatedQty: '5' }]
			})
		];
		const desk = new DeskPage(page);
		await desk.goto();
		await desk.openTab('supplies');
		await desk.selectPoint(scenarioPoint(scenario));
		await desk.openTab('reconciliation');

		const heading = page.getByRole('heading', { name: /^ใบเบิก TKT-/ });
		const shownNo = ((await heading.textContent()) ?? '').match(/TKT-SUPPLIES-\d+/)?.[0];
		const shown = tickets.find((t) => t.ticketNo === shownNo);
		if (!shown) throw new Error(`Reconciliation card shows an unexpected ticket: ${shownNo}`);

		await desk.closeShift({ [item.name]: '2' });
		await expectTicketStatus(shown, 'SHIFT_CLOSED', 'Close checkpoint');
		await expect(desk.reconciliationHeading(shown)).toBeVisible();

		await page.getByRole('button', { name: /ส่งคืนพัสดุกลับคลังกลาง/ }).click();
		await expectTicketStatus(shown, 'RETURN_PENDING_RECEIPT', 'Submit checkpoint');
		await expect(desk.reconciliationHeading(shown)).toBeVisible();
		await expect(
			desk.reconciliationCard(shown).getByText('รอคลังตรวจรับคืน', { exact: true })
		).toBeVisible();
	});
});
