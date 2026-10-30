/**
 * Distribution Desk — staff QR cards as recipients (CR-211 AC-15): a scanned `TKT-STF-HASH-` card
 * selects the staff user and logs `recipient_type: 'staff'` / `user:{name}` (AC-07), a second meal
 * the same day is caught (AC-09), a card of a user linked to a volunteer is caught after that
 * volunteer's meal (AC-10), and a lowercase payload still resolves (FR-SQR-40).
 *
 * The scanner dialog's manual code box is the same path a barcode gun or the camera feeds, so no
 * camera is needed. Cards are seeded the way `createUser` mints them: only the hash lives in
 * `_users`, and the QR carries that hash.
 */

import { randomBytes } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectTicketLogs } from './checks';
import {
	addScenarioActor,
	getShelterDocument,
	roleSet,
	scenarioPoint,
	seedDistributionLog,
	seedItemWithStock,
	seedTicket,
	seedVolunteer,
	shelterDb,
	type DistributionScenario,
	type SeededItem,
	type SeededRecipient,
	type SeededTicket
} from './distribution';
import { couchReq, putDocument } from '../helpers/couch';
import { DeskPage } from './pages/desk.page';
import { DESK_TAGS } from './distribution-desk-setup';

interface SeededStaffCard extends SeededRecipient {
	userName: string;
	displayName: string;
	/** What the printed card QR encodes (uppercase hex, as the card renders it). */
	payload: string;
}

/** Add `fields` to a `_users` doc as the admin — the way `createUser` / backfill write them. */
async function patchUser(name: string, fields: Record<string, unknown>): Promise<void> {
	const path = `/_users/org.couchdb.user:${encodeURIComponent(name)}`;
	const got = await couchReq('GET', path);
	if (got.status >= 400 || !got.data || typeof got.data !== 'object') {
		throw new Error(`Could not load E2E user ${name} for staff card`);
	}
	const res = await couchReq('PUT', path, { ...(got.data as Record<string, unknown>), ...fields });
	if (res.status >= 400) throw new Error(`Could not add staff card to ${name}`);
}

/** A kitchen staff user of the run's shelter holding a staff card; `extra` lands on `_users`. */
async function seedStaffCard(
	scenario: DistributionScenario,
	label: string,
	extra: Record<string, unknown> = {}
): Promise<SeededStaffCard> {
	const { user } = await addScenarioActor(scenario, label, roleSet('kitchen_staff', 'compound'));
	const hash = randomBytes(32).toString('hex');
	await patchUser(user.name, { staff_token_hash: hash, ...extra });
	const displayName = user.display_name ?? user.name;
	return {
		recipientId: `user:${user.name}`,
		firstName: displayName,
		lastName: '',
		userName: user.name,
		displayName,
		payload: `TKT-STF-HASH-${hash.toUpperCase()}`
	};
}

function selectedStaffCard(page: Page, card: SeededStaffCard): Locator {
	return page
		.getByText(card.displayName, { exact: true })
		.locator('xpath=ancestor::div[contains(@class, "rounded-lg")][1]');
}

async function foodDesk(
	page: Page,
	scenario: DistributionScenario
): Promise<{ desk: DeskPage; item: SeededItem; ticket: SeededTicket }> {
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
	const desk = new DeskPage(page);
	await desk.goto();
	await desk.openTab('food');
	await desk.selectPoint(scenarioPoint(scenario));
	await desk.selectTicket('food', ticket);
	await desk.itemButton(item.name).click();
	return { desk, item, ticket };
}

test.describe('Staff QR recipients (CR-211)', { tag: DESK_TAGS }, () => {
	test('STF-1 a scanned staff card gets a meal logged under user:{name}', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('staff_meal');
		const card = await seedStaffCard(scenario, 'cook');
		const { desk, item, ticket } = await foodDesk(page, scenario);

		await desk.chooseRecipientByScan(card.payload);
		await expect(selectedStaffCard(page, card)).toContainText('เจ้าหน้าที่ครัว');
		await desk.fillFoodQty('1');
		await desk.foodSubmit().click();
		await expect(desk.toast(`บันทึกแจกอาหารสำเร็จ: ${item.name} จำนวน 1 ชุด`)).toBeVisible();

		const [log] = await expectTicketLogs(ticket, item, 1, 'Staff meal');
		expect(log).toMatchObject({
			qty: '1',
			status: 'fulfilled',
			is_override: false,
			meal: 'lunch',
			recipient_type: 'staff',
			recipient_id: card.recipientId
		});
	});

	test('STF-2 a staff second meal the same day needs a confirmed override', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('staff_duplicate');
		const card = await seedStaffCard(scenario, 'cook');
		const { desk, item, ticket } = await foodDesk(page, scenario);
		await seedDistributionLog(scenario, { ticket, item, recipient: card, meal: 'lunch' });

		await desk.chooseRecipientByScan(card.payload);
		await expect(selectedStaffCard(page, card)).toBeVisible();
		await expect(desk.alert(/รับมื้อนี้ไปแล้ว 1 ครั้ง รวม 1 กล่อง/)).toBeVisible();
		await desk.foodSubmit().click();
		await expect(desk.overrideDialog()).toHaveAccessibleName('แจ้งเตือน: ได้รับอาหารมื้อนี้แล้ว');
		await desk.confirmOverride('เจ้าหน้าที่เข้ากะต่อเนื่อง');
		await expect(desk.toast(/บันทึกแจกอาหารสำเร็จ/)).toBeVisible();

		const logs = await expectTicketLogs(ticket, item, 2, 'Staff override meal');
		expect(logs.find((log) => log.is_override === true)).toMatchObject({
			recipient_type: 'staff',
			recipient_id: card.recipientId,
			override_reason: 'เจ้าหน้าที่เข้ากะต่อเนื่อง'
		});
	});

	test('STF-3 a staff card of a volunteer-linked user is caught after the volunteer meal', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('staff_volunteer_link');
		const volunteer = await seedVolunteer(
			scenario,
			`Link${scenario.namespace.slice(-6)}`,
			'Helper'
		);
		// A hash minted before the user was linked: resolve must map it to the volunteer id.
		const card = await seedStaffCard(scenario, 'linked', {
			volunteer_id: volunteer.recipientId,
			personnel_type: 'volunteer'
		});
		const volunteerDoc = await getShelterDocument(volunteer.recipientId);
		if (!volunteerDoc) throw new Error(`Seeded volunteer ${volunteer.recipientId} is missing`);
		await putDocument(shelterDb(), { ...volunteerDoc, user_name: card.userName });

		const { desk, item, ticket } = await foodDesk(page, scenario);
		await desk.chooseRecipientByScan(volunteer.passUrl);
		await expect(desk.selectedVolunteerCard(volunteer)).toBeVisible();
		await desk.fillFoodQty('1');
		await desk.foodSubmit().click();
		await expect(desk.toast(/บันทึกแจกอาหารสำเร็จ/)).toBeVisible();
		await expectTicketLogs(ticket, item, 1, 'Volunteer meal before staff card');

		// A scanned recipient reopens the scanner for the next person.
		const scanner = desk.scannerDialog();
		await expect(scanner).toBeVisible();
		await scanner.locator('#camera-code-manual').fill(card.payload);
		await scanner.getByRole('button', { name: 'ตกลง' }).click();
		await expect(
			page.getByText(`${volunteer.firstName} ${volunteer.lastName}`, { exact: true })
		).toBeVisible();
		await expect(desk.alert(/รับมื้อนี้ไปแล้ว 1 ครั้ง รวม 1 กล่อง/)).toBeVisible();
		await desk.foodSubmit().click();
		await expect(desk.overrideDialog()).toBeVisible();
	});

	test('STF-4 a lowercase staff card payload still resolves', async ({ page, scenarioAs }) => {
		const scenario = await scenarioAs('staff_lowercase');
		const card = await seedStaffCard(scenario, 'cook');
		const { desk } = await foodDesk(page, scenario);

		await desk.chooseRecipientByScan(card.payload.toLowerCase());
		await expect(selectedStaffCard(page, card)).toContainText('เจ้าหน้าที่ครัว');
	});
});
