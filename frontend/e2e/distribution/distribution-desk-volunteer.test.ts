/**
 * Distribution Desk — volunteers as recipients (#650): a volunteer pass QR selects the
 * volunteer, meals log `recipient_type: 'volunteer'` with the `volunteer:{ulid}` id and catch a
 * repeat meal, and a volunteer may borrow and return a returnable item (CR-121 FR-LON-01).
 *
 * Each test seeds its own tickets at its own distribution point inside the run's E2E shelter;
 * every step is asserted on screen and on the persisted documents.
 */

import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectTicketLogs } from './checks';
import {
	findShelterDocuments,
	scenarioPoint,
	seedDistributionLog,
	seedItemWithStock,
	seedTicket,
	seedVolunteer,
	type DistributionScenario,
	type SeededItem,
	type SeededTicket,
	type SeededVolunteer
} from './distribution';
import { DeskPage } from './pages/desk.page';
import { DESK_TAGS } from './distribution-desk-setup';

interface FoodSetup {
	desk: DeskPage;
	item: SeededItem;
	ticket: SeededTicket;
	volunteer: SeededVolunteer;
}

async function foodSetup(
	page: Page,
	scenario: DistributionScenario,
	volunteerStatus: 'active' | 'inactive' = 'active'
): Promise<FoodSetup> {
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
	const volunteer = await seedVolunteer(scenario, `Vol${scenario.namespace.slice(-6)}`, 'Helper', {
		status: volunteerStatus
	});
	const desk = new DeskPage(page);
	await desk.goto();
	await desk.openTab('food');
	await desk.selectPoint(scenarioPoint(scenario));
	await desk.selectTicket('food', ticket);
	return { desk, item, ticket, volunteer };
}

test.describe('Volunteer recipients (#650)', { tag: DESK_TAGS }, () => {
	test('VOL-1 a scanned volunteer pass gets a meal logged under the volunteer id', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('volunteer_meal');
		const { desk, item, ticket, volunteer } = await foodSetup(page, scenario);

		await desk.itemButton(item.name).click();
		await desk.chooseRecipientByScan(volunteer.passUrl);
		await expect(desk.selectedVolunteerCard(volunteer)).toBeVisible();
		await desk.fillFoodQty('1');
		await desk.foodSubmit().click();
		await expect(desk.toast(`บันทึกแจกอาหารสำเร็จ: ${item.name} จำนวน 1 ชุด`)).toBeVisible();

		const [log] = await expectTicketLogs(ticket, item, 1, 'Volunteer meal');
		expect(log).toMatchObject({
			qty: '1',
			status: 'fulfilled',
			is_override: false,
			meal: 'lunch',
			recipient_type: 'volunteer',
			recipient_id: volunteer.recipientId
		});
	});

	test('VOL-2 a volunteer second meal the same day needs a confirmed override', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('volunteer_duplicate');
		const { desk, item, ticket, volunteer } = await foodSetup(page, scenario);
		await seedDistributionLog(scenario, { ticket, item, recipient: volunteer, meal: 'lunch' });

		await desk.itemButton(item.name).click();
		await desk.chooseRecipientByScan(volunteer.passUrl);
		await expect(desk.selectedVolunteerCard(volunteer)).toBeVisible();
		await expect(desk.alert('คนนี้รับอาหารมื้อนี้ไปแล้ววันนี้')).toBeVisible();
		await desk.foodSubmit().click();
		await expect(desk.overrideDialog()).toHaveAccessibleName('แจ้งเตือน: ได้รับอาหารมื้อนี้แล้ว');
		await desk.confirmOverride('จิตอาสาเข้ากะต่อเนื่อง');
		await expect(desk.toast(/บันทึกแจกอาหารสำเร็จ/)).toBeVisible();

		const logs = await expectTicketLogs(ticket, item, 2, 'Volunteer override meal');
		expect(logs.find((log) => log.is_override === true)).toMatchObject({
			recipient_type: 'volunteer',
			recipient_id: volunteer.recipientId,
			override_reason: 'จิตอาสาเข้ากะต่อเนื่อง'
		});
	});

	test('VOL-3 a deactivated volunteer pass is reported and selects nobody', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('volunteer_inactive');
		const { desk, item, ticket, volunteer } = await foodSetup(page, scenario, 'inactive');

		await desk.itemButton(item.name).click();
		await desk.chooseRecipientByScan(volunteer.passUrl);
		await expect(page.getByText(/ถูกปิดใช้งานแล้ว/)).toBeVisible();
		await expect(desk.selectedVolunteerCard(volunteer)).toHaveCount(0);
		await expect(desk.foodSubmit()).toHaveCount(0);
		expect(await expectTicketLogs(ticket, item, 0, 'No log for inactive')).toHaveLength(0);
	});

	test('VOL-4 a volunteer borrows a returnable item and returns it at the counter', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('volunteer_loan');
		const vest = await seedItemWithStock(scenario, {
			name: `E2E vest ${scenario.namespace}`,
			stockQty: '10',
			returnable: true,
			typeClass: 'DURABLE'
		});
		const ticket = await seedTicket(scenario, {
			type: 'supplies',
			status: 'DISTRIBUTING',
			lines: [{ item: vest, allocatedQty: '4' }]
		});
		const volunteer = await seedVolunteer(
			scenario,
			`Loan${scenario.namespace.slice(-6)}`,
			'Helper'
		);
		const desk = new DeskPage(page);
		await desk.goto();
		await desk.openTab('supplies');
		await desk.selectPoint(scenarioPoint(scenario));
		await desk.selectTicket('supplies', ticket);

		await desk.itemButton(vest.name).click();
		await desk.chooseVolunteerBySearch(volunteer);
		await desk.fillSuppliesQty('1');
		await desk.suppliesSubmit('loan').click();
		await expect(desk.toast(/บันทึกยืมสิ่งของสำเร็จ/)).toBeVisible();

		const [log] = await expectTicketLogs(ticket, vest, 1, 'Volunteer loan');
		expect(log).toMatchObject({
			qty: '1',
			status: 'active',
			is_returnable: true,
			recipient_type: 'volunteer',
			recipient_id: volunteer.recipientId
		});

		await desk.openTab('returns');
		await desk.chooseRecipientByScan(volunteer.passUrl);
		await expect(desk.selectedVolunteerCard(volunteer)).toBeVisible();
		await expect(desk.loanCard(vest.name)).toContainText('คงค้าง');
		await desk.returnPhysical(vest.name, '1');

		await expect
			.poll(
				async () =>
					(await findShelterDocuments((doc) => doc._id === log._id && doc.status === 'returned'))
						.length,
				{ message: 'Volunteer loan returned' }
			)
			.toBe(1);
	});
});
