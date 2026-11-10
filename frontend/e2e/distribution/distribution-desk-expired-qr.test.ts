/**
 * Distribution Desk — handing out with an expired Person QR (CR-233 Amendment A1, FR-EQR-44..50).
 *
 * A scanned `evacuee:{ULID}@{hash6}` whose hash is an older print is refused with the dated message
 * and an "accept the risk" button; invalid hashes are refused with no button. Pressing the button
 * selects the evacuee and the handout writes a `schema_v 3` `distribution_log` carrying
 * `recipient_qr_override` (dates of the QR, the acting user, no personal data). A current QR hands
 * out normally and writes no audit.
 *
 * The `evacuee_qr` log is seeded as the CouchDB server admin (the only writer, FR-EQR-39). The
 * scanner dialog's manual code box is the same path a barcode gun or the camera feeds.
 */

import type { Page } from '@playwright/test';
import { putDocument } from '../helpers/couch';
import { expect, test } from './fixtures';
import { expectTicketLogs } from './checks';
import {
	findShelterDocuments,
	scenarioPoint,
	seedItemWithStock,
	seedRecipient,
	seedTicket,
	shelterCode,
	shelterDb,
	type DistributionScenario,
	type SeededItem,
	type SeededRecipient,
	type SeededTicket
} from './distribution';
import { DeskPage } from './pages/desk.page';
import { DESK_TAGS } from './distribution-desk-setup';

const OLD_HASH = 'a1b2c3';
const NEW_HASH = 'd4e5f6';
const UNKNOWN_HASH = '0a0b0c';
const FIRST_PRINT = '2026-11-08T06:52:00.000Z';
const LATEST_PRINT = '2026-11-08T06:53:00.000Z';

/** Two prints of the evacuee's Person QR: `OLD_HASH` is expired, `NEW_HASH` is current. */
async function seedQrLog(recipient: SeededRecipient, actor: string): Promise<void> {
	const ulid = recipient.recipientId.slice('evacuee:'.length);
	await putDocument(shelterDb(), {
		_id: `evacuee_qr:${ulid}`,
		type: 'evacuee_qr',
		schema_v: 1,
		shelter_code: shelterCode(),
		evacuee_id: recipient.recipientId,
		prints: [
			{ printed_at: FIRST_PRINT, hash: OLD_HASH, printed_by: actor, source: 'profile' },
			{ printed_at: LATEST_PRINT, hash: NEW_HASH, printed_by: actor, source: 'profile' }
		],
		created_at: FIRST_PRINT,
		updated_at: LATEST_PRINT,
		created_by: actor
	});
}

interface FoodSetup {
	desk: DeskPage;
	item: SeededItem;
	ticket: SeededTicket;
	recipient: SeededRecipient;
}

async function foodDesk(page: Page, scenario: DistributionScenario): Promise<FoodSetup> {
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
	const recipient = await seedRecipient(scenario, `Qr${scenario.namespace.slice(-6)}`, 'Expired');
	await seedQrLog(recipient, scenario.user.name);
	const desk = new DeskPage(page);
	await desk.goto();
	await desk.openTab('food');
	await desk.selectPoint(scenarioPoint(scenario));
	await desk.selectTicket('food', ticket);
	await desk.itemButton(item.name).click();
	return { desk, item, ticket, recipient };
}

test.describe('Expired Person QR at the desk (CR-233 A1)', { tag: DESK_TAGS }, () => {
	test('EQ-1 an expired QR is refused with the dated message and an accept button, nothing is logged', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('expired_qr_refused');
		const { desk, item, ticket, recipient } = await foodDesk(page, scenario);

		await desk.scanCodeKeepingDialog(`${recipient.recipientId}@${OLD_HASH}`);

		// Headless Chrome has no camera, so the dialog also carries a camera alert: match by text.
		const refusal = desk.scannerDialog().getByRole('alert').filter({ hasText: 'มีใบใหม่วันที่' });
		await expect(refusal).toBeVisible();
		await expect(refusal).not.toContainText(recipient.firstName);
		await expect(desk.acceptExpiredQrButton()).toBeVisible();
		await expect(desk.toast('สแกนไม่ผ่าน')).toBeVisible();
		await expect(desk.foodSubmit()).toBeHidden();
		await expectTicketLogs(ticket, item, 0, 'Refused expired QR');
	});

	test('EQ-2 an invalid QR has no accept button', async ({ page, scenarioAs }) => {
		const scenario = await scenarioAs('expired_qr_invalid');
		const { desk, recipient } = await foodDesk(page, scenario);

		await desk.scanCodeKeepingDialog(`${recipient.recipientId}@${UNKNOWN_HASH}`);

		await expect(
			desk.scannerDialog().getByRole('alert').filter({ hasText: 'QR ไม่ถูกต้อง' })
		).toBeVisible();
		await expect(desk.acceptExpiredQrButton()).toBeHidden();
	});

	test('EQ-3 accepting the risk selects the evacuee and logs schema_v 3 with the audit', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('expired_qr_accept');
		const { desk, item, ticket, recipient } = await foodDesk(page, scenario);

		await desk.scanCodeKeepingDialog(`${recipient.recipientId}@${OLD_HASH}`);
		await desk.acceptExpiredQrButton().click();
		await expect(desk.scannerDialog()).toBeHidden();
		await expect(page.getByText(`${recipient.firstName} ${recipient.lastName}`)).toBeVisible();

		await desk.fillFoodQty('1');
		await desk.foodSubmit().click();
		await expect(desk.toast(`บันทึกแจกอาหารสำเร็จ: ${item.name} จำนวน 1 ชุด`)).toBeVisible();

		const [log] = await expectTicketLogs(ticket, item, 1, 'Accepted expired QR');
		expect(log).toMatchObject({
			schema_v: 3,
			status: 'fulfilled',
			recipient_type: 'evacuee',
			recipient_id: recipient.recipientId,
			recipient_qr_override: {
				issued_at: FIRST_PRINT,
				current_printed_at: LATEST_PRINT,
				overridden_by: scenario.user.name
			}
		});
		expect(typeof (log.recipient_qr_override as { overridden_at: string }).overridden_at).toBe(
			'string'
		);
		// No new QR is issued by the override: the evacuee_qr log is untouched (FR-EQR-50).
		const [qrLog] = await findShelterDocuments(
			(doc) => doc.type === 'evacuee_qr' && doc.evacuee_id === recipient.recipientId
		);
		expect((qrLog.prints as unknown[]).length).toBe(2);
	});

	test('EQ-4 the current QR hands out normally with no audit and schema_v 2', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('expired_qr_current');
		const { desk, item, ticket, recipient } = await foodDesk(page, scenario);

		await desk.chooseRecipientByScan(`${recipient.recipientId}@${NEW_HASH}`);
		await expect(desk.scannerDialog()).toBeHidden();
		await desk.fillFoodQty('1');
		await desk.foodSubmit().click();
		await expect(desk.toast(`บันทึกแจกอาหารสำเร็จ: ${item.name} จำนวน 1 ชุด`)).toBeVisible();

		const [log] = await expectTicketLogs(ticket, item, 1, 'Current QR');
		expect(log.schema_v).toBe(2);
		expect(log.recipient_qr_override).toBeUndefined();
	});

	test('EQ-5 the supplies card records the same audit', async ({ page, scenarioAs }) => {
		const scenario = await scenarioAs('expired_qr_supplies');
		const kit = await seedItemWithStock(scenario, {
			name: `E2E kit ${scenario.namespace}`,
			stockQty: '20',
			returnable: false,
			typeClass: 'CONSUMABLE'
		});
		const ticket = await seedTicket(scenario, {
			type: 'supplies',
			status: 'DISTRIBUTING',
			lines: [{ item: kit, allocatedQty: '10' }]
		});
		const recipient = await seedRecipient(scenario, `Sq${scenario.namespace.slice(-6)}`, 'Expired');
		await seedQrLog(recipient, scenario.user.name);
		const desk = new DeskPage(page);
		await desk.goto();
		await desk.openTab('supplies');
		await desk.selectPoint(scenarioPoint(scenario));
		await desk.selectTicket('supplies', ticket);
		await desk.itemButton(kit.name).click();

		await desk.scanCodeKeepingDialog(`${recipient.recipientId}@${OLD_HASH}`);
		await desk.acceptExpiredQrButton().click();
		await expect(desk.scannerDialog()).toBeHidden();
		await desk.fillSuppliesQty('2');
		await desk.suppliesSubmit('consumable').click();
		await expect(desk.toast(/บันทึกแจกจ่ายพัสดุสำเร็จ/)).toBeVisible();

		const [log] = await expectTicketLogs(ticket, kit, 1, 'Supplies expired QR');
		expect(log).toMatchObject({
			schema_v: 3,
			recipient_id: recipient.recipientId,
			recipient_qr_override: {
				issued_at: FIRST_PRINT,
				current_printed_at: LATEST_PRINT,
				overridden_by: scenario.user.name
			}
		});
	});
});
