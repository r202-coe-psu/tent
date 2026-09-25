/**
 * Durable-loan browser journey. The prerequisite ticket, catalog stock, and
 * recipient are real CouchDB fixtures; issuance and physical returns use the
 * application UI and assert persisted CouchDB documents.
 */

import { expect, test, type Page } from '@playwright/test';
import { subQty } from '../../src/lib/utils/qty';
import { clearSession, injectSession } from '../helpers/login';
import {
	cleanupDistributionScenario,
	createDistributionScenario,
	findShelterDocuments,
	getShelterDocument,
	routeBrowserCouchThroughApp,
	seedDistributingTicket,
	seedItemWithStock,
	seedRecipient,
	type DistributionScenario,
	type SeededItem,
	type SeededRecipient
} from './distribution';

const LOAN_QTY = '5';
const PARTIAL_RETURN_QTY = '2';
const FINAL_RETURN_QTY = '3';

interface TicketFixture {
	ticketId: string;
	ticketNo: string;
}

async function selectSuppliesTicket(
	page: Page,
	ticket: TicketFixture,
	item: SeededItem
): Promise<void> {
	const selector = page.getByLabel('เลือกตั๋วพัสดุที่ใช้งาน');
	if ((await selector.count()) > 0) {
		await selector.click();
		await page.getByRole('option', { name: new RegExp(ticket.ticketNo) }).click();
		await expect(selector).toContainText(ticket.ticketNo);
	}
	await expect(page.getByRole('button', { name: new RegExp(item.name) })).toBeVisible();
}

async function selectRecipient(page: Page, recipient: SeededRecipient): Promise<void> {
	const fullName = `${recipient.firstName} ${recipient.lastName}`;
	const selectedRecipientCard = page
		.getByText(recipient.recipientId, { exact: true })
		.locator('xpath=ancestor::div[contains(@class, "rounded-lg")][1]');

	if ((await selectedRecipientCard.count()) > 0) {
		await expect(selectedRecipientCard).toBeVisible();
		await expect(selectedRecipientCard.getByText(fullName, { exact: true })).toBeVisible();
		await expect(
			selectedRecipientCard.getByRole('button', { name: 'เปลี่ยนผู้รับ' })
		).toBeVisible();
		return;
	}

	const searchInput = page.locator('#recipient-search-input');
	await expect(searchInput).toBeVisible();
	await searchInput.fill(recipient.firstName);

	await page
		.getByRole('button', {
			name: new RegExp(`${recipient.firstName}.*${recipient.lastName}`)
		})
		.click();

	await expect(selectedRecipientCard).toBeVisible();
	await expect(selectedRecipientCard.getByText(fullName, { exact: true })).toBeVisible();
	await expect(selectedRecipientCard.getByRole('button', { name: 'เปลี่ยนผู้รับ' })).toBeVisible();
}

async function withScenario<T>(
	label: string,
	fn: (scenario: DistributionScenario) => Promise<T>
): Promise<T> {
	const scenario = await createDistributionScenario(label);
	let result!: T;
	let scenarioError: unknown;
	let cleanupError: unknown;

	try {
		result = await fn(scenario);
	} catch (error) {
		scenarioError = error;
	}

	try {
		await cleanupDistributionScenario(scenario);
	} catch (error) {
		cleanupError = error;
	}

	if (scenarioError && cleanupError) {
		throw new AggregateError([scenarioError, cleanupError], 'Scenario and cleanup both failed');
	}

	if (scenarioError) {
		throw scenarioError;
	}

	if (cleanupError) {
		throw cleanupError;
	}

	return result;
}

async function returnPhysical(
	page: Page,
	recipient: SeededRecipient,
	item: SeededItem,
	quantity: string
): Promise<void> {
	await page.getByRole('button', { name: /4\. รับคืนสิ่งของ/ }).click();
	await selectRecipient(page, recipient);
	const loanCard = page
		.getByText(item.name, { exact: true })
		.locator('xpath=ancestor::div[contains(@class, "rounded-xl")][1]');
	await expect(loanCard).toBeVisible();
	await loanCard.getByRole('button', { name: /รับคืนของจริง/ }).click();
	const dialog = page.getByRole('dialog', { name: /ตรวจรับคืนพัสดุเข้าคลัง/ });
	await dialog.getByLabel(/จำนวนที่ตรวจรับคืนครั้งนี้/).fill(quantity);
	await dialog.getByRole('button', { name: /ยืนยันตรวจรับคืนเข้าคลัง/ }).click();
	await expect(dialog).toBeHidden();
}

test.beforeEach(async ({ page }) => {
	await routeBrowserCouchThroughApp(page);
});

test.afterEach(async ({ page }) => {
	await clearSession(page);
	await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('Journey C: a durable loan remains a persisted log through partial and final physical returns', async ({
	page
}) => {
	await withScenario('durable_loan', async (scenario) => {
		const item = await seedItemWithStock(scenario, {
			name: `E2E durable ${scenario.namespace}`,
			stockQty: LOAN_QTY,
			returnable: true,
			typeClass: 'DURABLE'
		});
		const recipient = await seedRecipient(
			scenario,
			`Loan${scenario.namespace.slice(-6)}`,
			'Recipient'
		);
		const seededTicket = await seedDistributingTicket(scenario, item, LOAN_QTY);
		const ticket: TicketFixture = seededTicket;
		await injectSession(page, scenario.user, scenario.session);

		await page.goto('/onsite/distribution');
		await page.getByRole('button', { name: /3\. จ่ายพัสดุ/ }).click();
		await selectSuppliesTicket(page, ticket, item);
		await page.getByRole('button', { name: new RegExp(item.name) }).click();
		await selectRecipient(page, recipient);
		const quantityInput = page.locator('#supplies-qty-input');
		await quantityInput.fill(LOAN_QTY);
		await expect(quantityInput).toHaveValue(LOAN_QTY);
		await page.getByRole('button', { name: 'ยืนยันบันทึกการยืมสิ่งของ' }).click();
		await expect(page.getByText(/บันทึกยืมสิ่งของสำเร็จ/)).toBeVisible();

		let logId = '';
		await expect
			.poll(
				async () => {
					const logs = await findShelterDocuments(
						(doc) =>
							doc.type === 'distribution_log' &&
							doc.ticket_id === ticket.ticketId &&
							doc.item_id === item.itemId &&
							doc.recipient_id === recipient.recipientId
					);
					logId = logs[0]?._id ?? '';
					return logId;
				},
				{ message: `Loan issuance did not create a DistributionLog for ${ticket.ticketNo}` }
			)
			.toMatch(/^distribution_log:/);
		await expect
			.poll(async () => (await getShelterDocument(logId))?.status, {
				message: `Loan ${logId} should begin active`
			})
			.toBe('active');

		await returnPhysical(page, recipient, item, PARTIAL_RETURN_QTY);
		await expect
			.poll(async () => (await getShelterDocument(logId))?.qty_returned, {
				message: `Partial return for ${logId} should persist ${PARTIAL_RETURN_QTY}`
			})
			.toBe(PARTIAL_RETURN_QTY);
		const partial = await getShelterDocument(logId);
		expect(partial).toMatchObject({
			status: 'partially_returned',
			qty: LOAN_QTY,
			qty_returned: PARTIAL_RETURN_QTY
		});
		expect(partial?._id).toBe(logId);
		expect(subQty(String(partial?.qty), String(partial?.qty_returned))).toBe(FINAL_RETURN_QTY);
		const partialReceipts = await findShelterDocuments(
			(doc) => doc.type === 'stock_ledger' && doc.reason === 'receive' && doc.ref_id === logId
		);
		expect(partialReceipts).toHaveLength(1);
		expect(partialReceipts[0]?.qty).toBe(PARTIAL_RETURN_QTY);
		await expect(page.getByText('คงค้าง', { exact: true })).toBeVisible();
		await expect(page.getByText(FINAL_RETURN_QTY, { exact: true })).toBeVisible();

		await returnPhysical(page, recipient, item, FINAL_RETURN_QTY);
		await expect
			.poll(async () => (await getShelterDocument(logId))?.qty_returned, {
				message: `Final return for ${logId} should persist ${LOAN_QTY}`
			})
			.toBe(LOAN_QTY);
		const final = await getShelterDocument(logId);
		expect(final).toMatchObject({ status: 'returned', qty_returned: LOAN_QTY });
		expect(final?._id).toBe(logId);

		const receipts = await findShelterDocuments(
			(doc) => doc.type === 'stock_ledger' && doc.reason === 'receive' && doc.ref_id === logId
		);
		expect(receipts).toHaveLength(2);
		expect(receipts.map((receipt) => receipt.qty).sort()).toEqual([
			PARTIAL_RETURN_QTY,
			FINAL_RETURN_QTY
		]);
		const outstanding = await findShelterDocuments(
			(doc) =>
				doc.type === 'distribution_log' &&
				doc.recipient_id === recipient.recipientId &&
				['active', 'partially_returned'].includes(String(doc.status))
		);
		expect(outstanding).not.toContainEqual(expect.objectContaining({ _id: logId }));
	});
});
