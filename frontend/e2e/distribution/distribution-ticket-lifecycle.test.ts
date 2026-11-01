/**
 * Browser journeys against the real E2E CouchDB. Fixtures establish catalog
 * stock only; every ticket, log, and ledger transition is browser-driven.
 */

import { expect, test } from './fixtures';
import { expectTicketLogs, expectTicketStatus, ledgerRows } from './checks';
import {
	getShelterDocument,
	scenarioPoint,
	seedItemWithStock,
	type DistributionScenario,
	type SeededItem,
	type SeededTicket
} from './distribution';
import { BackOfficePage } from './pages/back-office.page';
import { DeskPage } from './pages/desk.page';

const REQUESTED_QTY = '120';
const ALLOCATED_QTY = '100';
const DISTRIBUTED_QTY = '80';
const ZERO_RETURN_QTY = '0';
const DISCREPANCY_QTY = '20';
const DECLARED_RETURN_QTY = '20';
const INVALID_VERIFIED_QTY = '21';
const VERIFIED_RETURN_QTY = '15';

/** Back-office create → allocate → approve → dispatch, then receive at the desk. */
async function ticketAtDesk(
	backOffice: BackOfficePage,
	desk: DeskPage,
	scenario: DistributionScenario,
	item: SeededItem
): Promise<SeededTicket> {
	const ticket = await backOffice.createSuppliesTicket(
		item,
		REQUESTED_QTY,
		scenarioPoint(scenario),
		scenario.user.name
	);
	await expectTicketStatus(ticket, 'PENDING_PICK', 'Create checkpoint');
	await backOffice.allocate(ticket, item, ALLOCATED_QTY);
	await backOffice.approve(ticket);
	await backOffice.dispatch(ticket, item);
	await desk.goto();
	await desk.receive(ticket);
	await expectTicketStatus(ticket, 'DISTRIBUTING', 'Frontline receive checkpoint');
	return ticket;
}

async function distributeToOutside(
	desk: DeskPage,
	scenario: DistributionScenario,
	ticket: SeededTicket,
	item: SeededItem
): Promise<void> {
	await desk.openTab('supplies');
	await desk.selectPoint(scenarioPoint(scenario));
	await desk.itemButton(item.name).click();
	await desk.chooseOutsideRecipient();
	await desk.fillSuppliesQty(DISTRIBUTED_QTY);
	await desk.suppliesSubmit('consumable').click();
	await expect(desk.toast(/บันทึกแจกจ่ายพัสดุสำเร็จ/)).toBeVisible();
	const [log] = await expectTicketLogs(ticket, item, 1, 'Distribution checkpoint');
	expect(log).toMatchObject({ qty: DISTRIBUTED_QTY, recipient_type: 'outside' });
}

test.describe('Back-office ↔ desk ticket journeys', { tag: ['@critical', '@distribution'] }, () => {
	test('Journey A: 100 allocated, 80 distributed, 0 returned completes without a warehouse receipt', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('ticket_zero_return');
		const desk = new DeskPage(page);
		const backOffice = new BackOfficePage(page);
		const item = await seedItemWithStock(scenario, {
			name: `E2E consumable ${scenario.namespace}`,
			stockQty: ALLOCATED_QTY,
			returnable: false,
			typeClass: 'CONSUMABLE'
		});

		const ticket = await ticketAtDesk(backOffice, desk, scenario, item);
		await distributeToOutside(desk, scenario, ticket, item);

		await test.step('Close shift with zero returns', async () => {
			await desk.openTab('reconciliation');
			await desk.selectTicket('reconciliation', ticket);
			await desk.closeShift({ [item.name]: ZERO_RETURN_QTY });
			await expectTicketStatus(ticket, 'COMPLETED', 'Zero-return close-shift checkpoint');
			await expect(page.getByRole('button', { name: /ส่งคืนพัสดุกลับคลังกลาง/ })).toHaveCount(0);
		});

		await test.step('Assert final ticket and warehouse receipt absence', async () => {
			const persisted = await getShelterDocument(ticket.ticketId);
			expect(persisted?.items).toMatchObject([
				{
					allocated_qty: ALLOCATED_QTY,
					distributed_qty: DISTRIBUTED_QTY,
					returned_qty: ZERO_RETURN_QTY,
					discrepancy_qty: DISCREPANCY_QTY
				}
			]);
			expect(await ledgerRows('receive', ticket.ticketId)).toHaveLength(0);
			await backOffice.expectCompletedInBrowser(ticket);
		});
	});

	test('Journey B: warehouse credits only the lower verified return quantity back into the source lot', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('ticket_physical_return');
		const desk = new DeskPage(page);
		const backOffice = new BackOfficePage(page);
		const item = await seedItemWithStock(scenario, {
			name: `E2E returnable stock ${scenario.namespace}`,
			stockQty: ALLOCATED_QTY,
			returnable: false,
			typeClass: 'CONSUMABLE'
		});

		const ticket = await ticketAtDesk(backOffice, desk, scenario, item);
		await distributeToOutside(desk, scenario, ticket, item);

		await desk.openTab('reconciliation');
		await desk.selectTicket('reconciliation', ticket);
		await desk.closeShift({ [item.name]: DECLARED_RETURN_QTY });
		await expectTicketStatus(ticket, 'SHIFT_CLOSED', 'Declared-return close-shift checkpoint');
		expect((await getShelterDocument(ticket.ticketId))?.items).toMatchObject([
			{ returned_qty: DECLARED_RETURN_QTY }
		]);
		const card = desk.reconciliationCard(ticket);
		await expect(card.getByText('ปิดรอบแจกแล้ว', { exact: true })).toBeVisible();
		await page.getByRole('button', { name: /ส่งคืนพัสดุกลับคลังกลาง/ }).click();
		await expectTicketStatus(ticket, 'RETURN_PENDING_RECEIPT', 'Submit-returns checkpoint');
		await expect(card.getByText('รอคลังตรวจรับคืน', { exact: true })).toBeVisible();

		await backOffice.receiveWarehouseReturn(
			ticket,
			item,
			VERIFIED_RETURN_QTY,
			INVALID_VERIFIED_QTY
		);
		// CR-208: the verified leftovers go back into the lot the ticket was dispatched from.
		const [dispatched] = await ledgerRows('distribute', ticket.ticketId);
		const returns = await ledgerRows('distribution_return', ticket.ticketId);
		expect(returns).toHaveLength(1);
		expect(returns[0]).toMatchObject({ qty: VERIFIED_RETURN_QTY, lot_ref: dispatched?.lot_ref });
		expect(returns[0]?.lot).toBeUndefined();
		expect(await ledgerRows('receive', ticket.ticketId)).toHaveLength(0);

		await backOffice.completeTicket(ticket);
		await backOffice.expectCompletedInBrowser(ticket);
	});
});
