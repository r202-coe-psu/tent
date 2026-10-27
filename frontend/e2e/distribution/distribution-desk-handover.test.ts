/**
 * Distribution Desk — handing things out (plan §4.3–§4.5):
 * tab 1 receive cargo, tab 2 ready meals, tab 3 supplies and loans.
 *
 * Each test seeds its own tickets at its own distribution point inside the run's
 * E2E shelter; every step is asserted on screen and on the persisted documents.
 */

import type { Page } from '@playwright/test';
import { putDocument } from '../helpers/couch';
import { expect, test } from './fixtures';
import { deskTicketCount, expectTicketLogs, expectTicketStatus } from './checks';
import {
	getShelterDocument,
	scenarioPoint,
	seedDistributionLog,
	seedItemWithStock,
	seedRecipient,
	seedTicket,
	shelterDb,
	type DistributionScenario,
	type MealPeriod,
	type SeedItemOptions,
	type SeededItem,
	type SeededRecipient,
	type SeededTicket
} from './distribution';
import { DeskPage } from './pages/desk.page';
import { consumable, DESK_TAGS, tabBadge } from './distribution-desk-setup';

const HOUR_MS = 3_600_000;

interface FoodSetup {
	desk: DeskPage;
	item: SeededItem;
	ticket: SeededTicket;
	recipient: SeededRecipient;
}

async function foodSetup(
	page: Page,
	scenario: DistributionScenario,
	options: {
		allocatedQty?: string;
		meal?: MealPeriod;
		item?: Partial<SeedItemOptions>;
		religion?: string;
	} = {}
): Promise<FoodSetup> {
	const item = await seedItemWithStock(scenario, {
		name: `E2E meal ${scenario.namespace}`,
		stockQty: '50',
		returnable: false,
		typeClass: 'CONSUMABLE',
		...options.item
	});
	const ticket = await seedTicket(scenario, {
		type: 'food',
		status: 'DISTRIBUTING',
		meal: options.meal ?? 'lunch',
		lines: [{ item, allocatedQty: options.allocatedQty ?? '10' }]
	});
	const recipient = await seedRecipient(
		scenario,
		`Food${scenario.namespace.slice(-6)}`,
		'Recipient',
		{ religion: options.religion }
	);
	const desk = new DeskPage(page);
	await desk.goto();
	await desk.openTab('food');
	await desk.selectPoint(scenarioPoint(scenario));
	await desk.selectTicket('food', ticket);
	return { desk, item, ticket, recipient };
}

interface SuppliesSetup {
	desk: DeskPage;
	kit: SeededItem;
	blanket: SeededItem;
	ticket: SeededTicket;
	recipient: SeededRecipient;
}

async function suppliesSetup(page: Page, scenario: DistributionScenario): Promise<SuppliesSetup> {
	const kit = await seedItemWithStock(scenario, {
		name: `E2E kit ${scenario.namespace}`,
		stockQty: '20',
		returnable: false,
		typeClass: 'CONSUMABLE'
	});
	const blanket = await seedItemWithStock(scenario, {
		name: `E2E blanket ${scenario.namespace}`,
		stockQty: '20',
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
	const recipient = await seedRecipient(
		scenario,
		`Sup${scenario.namespace.slice(-6)}`,
		'Recipient'
	);
	const desk = new DeskPage(page);
	await desk.goto();
	await desk.openTab('supplies');
	await desk.selectPoint(scenarioPoint(scenario));
	await desk.selectTicket('supplies', ticket);
	return { desk, kit, blanket, ticket, recipient };
}

test.describe('Tab 1 — confirm cargo arrival (plan §4.3)', { tag: DESK_TAGS }, () => {
	test('T1-1 receiving a supplies ticket moves it to DISTRIBUTING and opens the supplies tab', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('desk_receive_supplies');
		const desk = new DeskPage(page);
		const item = await consumable(scenario, 'receive supplies');
		const ticket = await seedTicket(scenario, {
			type: 'supplies',
			status: 'IN_TRANSIT',
			lines: [{ item, allocatedQty: '10' }]
		});

		await desk.goto();
		await desk.openTab('receive', 'supplies');
		const card = desk.receiveCard(ticket);
		await expect(card).toContainText(item.name);
		await expect(card).toContainText('กำลังนำส่ง');
		await expect(card).toContainText(scenarioPoint(scenario));

		await desk.receive(ticket);
		await expectTicketStatus(ticket, 'DISTRIBUTING', 'Receive checkpoint');
		expect(await getShelterDocument(ticket.ticketId)).toMatchObject({
			received_by: scenario.user.name
		});
		// Landed on tab 3: the supplies card lists the ticket's items.
		await expect(desk.itemButton(item.name)).toBeVisible();
	});

	test('T1-2 receiving a food ticket opens the food tab with its meal badge', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('desk_receive_food');
		const desk = new DeskPage(page);
		const item = await consumable(scenario, 'receive meal');
		const ticket = await seedTicket(scenario, {
			type: 'food',
			status: 'IN_TRANSIT',
			meal: 'lunch',
			lines: [{ item, allocatedQty: '10' }]
		});

		await desk.goto();
		await desk.receive(ticket);
		await expectTicketStatus(ticket, 'DISTRIBUTING', 'Receive checkpoint');
		await expect(
			page.getByRole('heading', {
				name: `สถานีแจกจ่ายอาหาร · จุดบริการ ${scenarioPoint(scenario)}`
			})
		).toBeVisible();
		await expect(page.getByText('มื้อ: กลางวัน').first()).toBeVisible();
	});

	test('T1-3/T1-4 the received card leaves the list and the "รอรับ" badge counts down', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('desk_receive_badge');
		const desk = new DeskPage(page);
		const item = await consumable(scenario, 'receive badge');

		const first = await seedTicket(scenario, {
			type: 'supplies',
			status: 'IN_TRANSIT',
			lines: [{ item, allocatedQty: '5' }]
		});
		const second = await seedTicket(scenario, {
			type: 'supplies',
			status: 'IN_TRANSIT',
			lines: [{ item, allocatedQty: '5' }]
		});

		// The badge counts every IN_TRANSIT desk ticket of the current mode in the shelter.
		const waiting = await deskTicketCount('IN_TRANSIT', 'supplies');
		await desk.goto();
		await desk.switchMode('supplies');
		await expect.poll(() => tabBadge(desk, 'receive', /รอรับ (\d+)/)).toBe(waiting);
		await desk.receive(first);
		await expect.poll(() => tabBadge(desk, 'receive', /รอรับ (\d+)/)).toBe(waiting - 1);

		await desk.openTab('receive', 'supplies');
		await expect(page.getByText(first.ticketNo, { exact: true })).toHaveCount(0);
		await expect(desk.receiveCard(second)).toBeVisible();
	});

	test('T1-5 a ticket received elsewhere first is not received twice', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('desk_receive_race');
		const desk = new DeskPage(page);
		const item = await consumable(scenario, 'receive race');
		const ticket = await seedTicket(scenario, {
			type: 'supplies',
			status: 'IN_TRANSIT',
			lines: [{ item, allocatedQty: '5' }]
		});
		const otherDesk = `${scenario.namespace}_other_desk`;

		await desk.goto();
		await desk.openTab('receive', 'supplies');
		const card = desk.receiveCard(ticket);
		await expect(card).toBeVisible();

		// Another desk receives the ticket between our render and our write.
		let raced = false;
		await page.route(
			(url) => url.pathname.includes(encodeURIComponent(ticket.ticketId)),
			async (route) => {
				if (route.request().method() === 'PUT' && !raced) {
					raced = true;
					const current = await getShelterDocument(ticket.ticketId);
					if (!current) throw new Error('race fixture lost the ticket');
					await putDocument(shelterDb(), {
						...current,
						status: 'DISTRIBUTING',
						received_by: otherDesk,
						updated_at: new Date().toISOString()
					});
				}
				await route.fallback();
			}
		);
		await card.getByRole('button', { name: /ตรวจรับเข้าจุดแจก/ }).click();

		await expect(page.locator('[data-sonner-toast][data-type="error"]')).toBeVisible();
		await expect(desk.toast(/ตรวจรับสินค้าเข้าจุดแจกจ่ายเรียบร้อยแล้ว/)).toHaveCount(0);
		expect(raced).toBe(true);
		expect(await getShelterDocument(ticket.ticketId)).toMatchObject({
			status: 'DISTRIBUTING',
			received_by: otherDesk
		});
	});
});

test.describe('Tab 2 — ready-meal handover (plan §4.4)', { tag: DESK_TAGS }, () => {
	// Each test runs on its own DISTRIBUTING food ticket at its own point.

	test('T2-1/T2-11 a meal handover writes a fulfilled log and lowers the in-hand count', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('food_handover');
		const { desk, item, ticket, recipient } = await foodSetup(page, scenario);

		await expect(page.getByText('มื้อ: กลางวัน').first()).toBeVisible();
		await expect(desk.itemButton(item.name)).toContainText('เหลือ 10');
		await desk.itemButton(item.name).click();
		await expect(desk.itemButton(item.name)).toHaveAttribute('aria-pressed', 'true');
		await desk.chooseRecipientBySearch(recipient);
		await desk.fillFoodQty('2');
		await expect(desk.foodSubmit()).toHaveText(new RegExp(`ยืนยันแจก ${item.name} 2 ชุด`));
		await desk.foodSubmit().click();
		await expect(desk.toast(`บันทึกแจกอาหารสำเร็จ: ${item.name} จำนวน 2 ชุด`)).toBeVisible();

		const [log] = await expectTicketLogs(ticket, item, 1, 'Meal handover');
		expect(log).toMatchObject({
			qty: '2',
			status: 'fulfilled',
			is_returnable: false,
			is_override: false,
			meal: 'lunch',
			recipient_type: 'evacuee',
			recipient_id: recipient.recipientId,
			distributed_by: scenario.user.name
		});
		await expect(desk.itemButton(item.name)).toContainText('เหลือ 8');
		await expectTicketStatus(ticket, 'DISTRIBUTING', 'Food handover never moves the ticket');
	});

	test('T2-2/T2-3 the confirm needs a recipient and a quantity within the in-hand balance', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('food_validation');
		const { desk, item, ticket, recipient } = await foodSetup(page, scenario, {
			allocatedQty: '3'
		});

		await desk.itemButton(item.name).click();
		// The quantity and confirm only render once a recipient is chosen.
		await expect(desk.foodSubmit()).toHaveCount(0);
		await desk.chooseRecipientBySearch(recipient);
		await desk.fillFoodQty('4');
		await expect(desk.foodSubmit()).toBeDisabled();
		await desk.fillFoodQty('3');
		await expect(desk.foodSubmit()).toBeEnabled();
		expect(await expectTicketLogs(ticket, item, 0, 'No log before confirm')).toHaveLength(0);
	});

	test('T2-4 a second meal the same day needs a confirmed override with a reason', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('food_duplicate');
		const { desk, item, ticket, recipient } = await foodSetup(page, scenario);
		await seedDistributionLog(scenario, { ticket, item, recipient, meal: 'lunch' });

		await desk.itemButton(item.name).click();
		await desk.chooseRecipientBySearch(recipient);
		await expect(desk.alert(/รับมื้อนี้ไปแล้ว 1 ครั้ง รวม 1 กล่อง/)).toBeVisible();
		await desk.foodSubmit().click();
		await expect(desk.overrideDialog()).toHaveAccessibleName('แจ้งเตือน: ได้รับอาหารมื้อนี้แล้ว');
		await desk.confirmOverride('รับแทนผู้ป่วยติดเตียง');
		await expect(desk.toast(/บันทึกแจกอาหารสำเร็จ/)).toBeVisible();

		const logs = await expectTicketLogs(ticket, item, 2, 'Override handover');
		expect(logs.find((log) => log.is_override === true)).toMatchObject({
			override_reason: 'รับแทนผู้ป่วยติดเตียง',
			status: 'fulfilled'
		});

		await page.getByRole('button', { name: /ประวัติการแจกของตั๋วนี้/ }).click();
		await expect(page.getByText('กรณีพิเศษ', { exact: true })).toBeVisible();
	});

	test('T2-5 a menu outside the recipient group needs an override; a matching recipient does not', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('food_menu_match');
		const { desk, item, ticket, recipient } = await foodSetup(page, scenario, {
			item: { dietary: ['HALAL'] }
		});
		const muslim = await seedRecipient(scenario, `Halal${scenario.namespace.slice(-6)}`, 'Match', {
			religion: 'muslim'
		});

		await desk.itemButton(item.name).click();
		await desk.chooseRecipientBySearch(muslim);
		await expect(desk.alert('เมนูนี้ไม่ตรงกลุ่มผู้รับ')).toHaveCount(0);
		await desk.foodSubmit().click();
		await expect(desk.overrideDialog()).toHaveCount(0);
		await expect(desk.toast(/บันทึกแจกอาหารสำเร็จ/)).toBeVisible();

		await desk.chooseRecipientBySearch(recipient);
		await expect(desk.alert('เมนูนี้ไม่ตรงกลุ่มผู้รับ')).toBeVisible();
		await desk.foodSubmit().click();
		await expect(desk.overrideDialog()).toHaveAccessibleName('แจ้งเตือน: เมนูไม่ตรงกลุ่มผู้รับ');
		await desk.confirmOverride('ผู้รับยืนยันรับเมนูฮาลาล');

		const logs = await expectTicketLogs(ticket, item, 2, 'Menu-match handovers');
		expect(logs.find((l) => l.recipient_id === muslim.recipientId)).toMatchObject({
			is_override: false
		});
		expect(logs.find((l) => l.recipient_id === recipient.recipientId)).toMatchObject({
			is_override: true,
			override_reason: 'ผู้รับยืนยันรับเมนูฮาลาล'
		});
	});

	// D-E3: an expired lot is advisory only today — the handover goes out and the log is stamped.
	test('T2-6 an expired lot warns but still hands out, stamping the log', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('food_expired');
		const { desk, item, ticket, recipient } = await foodSetup(page, scenario, {
			item: { lotExpiry: new Date(Date.now() - HOUR_MS).toISOString() }
		});

		await desk.itemButton(item.name).click();
		await expect(desk.alert('อาหารล็อตนี้เกินเวลาปลอดภัยแล้ว')).toBeVisible();
		await desk.chooseRecipientBySearch(recipient);
		await desk.foodSubmit().click();
		await expect(desk.toast(/บันทึกแจกอาหารสำเร็จ/)).toBeVisible();

		const [log] = await expectTicketLogs(ticket, item, 1, 'Expired-lot handover');
		expect(log).toMatchObject({ is_expired_warning: true });
		await page.getByRole('button', { name: /ประวัติการแจกของตั๋วนี้/ }).click();
		await expect(page.getByText('เกินเวลาปลอดภัย', { exact: true })).toBeVisible();
	});

	test('T2-7 a lot within its safety window shows the remaining time and logs no warning', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('food_fresh');
		const { desk, item, ticket, recipient } = await foodSetup(page, scenario, {
			item: { lotExpiry: new Date(Date.now() + 2 * HOUR_MS).toISOString() }
		});

		await desk.itemButton(item.name).click();
		await expect(page.getByText(/ปลอดภัยอีก/)).toBeVisible();
		await expect(desk.alert('อาหารล็อตนี้เกินเวลาปลอดภัยแล้ว')).toHaveCount(0);
		await desk.chooseRecipientBySearch(recipient);
		await desk.foodSubmit().click();
		await expect(desk.toast(/บันทึกแจกอาหารสำเร็จ/)).toBeVisible();
		const [log] = await expectTicketLogs(ticket, item, 1, 'Fresh-lot handover');
		expect(log.is_expired_warning).toBe(false);
	});

	test('T2-8/T2-9 service-day and ticket selectors narrow the food tickets', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('food_service_day');
		const desk = new DeskPage(page);
		const item = await seedItemWithStock(scenario, {
			name: `E2E day meal ${scenario.namespace}`,
			stockQty: '30',
			returnable: false,
			typeClass: 'CONSUMABLE'
		});
		const day = (offset: number) => new Date(Date.now() - offset * 24 * HOUR_MS).toISOString();
		const today = await seedTicket(scenario, {
			type: 'food',
			status: 'DISTRIBUTING',
			meal: 'breakfast',
			lines: [{ item, allocatedQty: '5' }],
			createdAt: day(0)
		});
		const todayDinner = await seedTicket(scenario, {
			type: 'food',
			status: 'DISTRIBUTING',
			meal: 'dinner',
			lines: [{ item, allocatedQty: '5' }],
			createdAt: day(0)
		});
		const older = await seedTicket(scenario, {
			type: 'food',
			status: 'DISTRIBUTING',
			meal: 'lunch',
			lines: [{ item, allocatedQty: '5' }],
			createdAt: day(2)
		});
		await seedTicket(scenario, {
			type: 'food',
			status: 'DISTRIBUTING',
			meal: 'snack',
			lines: [{ item, allocatedQty: '5' }],
			createdAt: day(1)
		});

		await desk.goto();
		await desk.openTab('food');
		await desk.selectPoint(scenarioPoint(scenario));
		const daySelect = page.getByLabel('เลือกวันที่ให้บริการ');
		await expect(daySelect).toBeVisible();

		// Today is the default day: both of today's tickets are offered, the older one is not.
		const ticketSelect = page.getByLabel('เลือกตั๋วอาหารที่ใช้งาน');
		await ticketSelect.click();
		await expect(page.getByRole('option', { name: new RegExp(today.ticketNo) })).toBeVisible();
		await expect(
			page.getByRole('option', { name: new RegExp(todayDinner.ticketNo) })
		).toBeVisible();
		await expect(page.getByRole('option', { name: new RegExp(older.ticketNo) })).toHaveCount(0);
		await page.keyboard.press('Escape');

		await desk.selectTicket('food', todayDinner);
		await expect(page.getByText('มื้อ: เย็น').first()).toBeVisible();
	});

	test('T2-10/T2-12 an exhausted item is shown as such; history pages past 20 rows', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('food_history');
		const { desk, item, ticket } = await foodSetup(page, scenario, { allocatedQty: '21' });
		for (let i = 0; i < 21; i += 1) {
			const person = await seedRecipient(
				scenario,
				`Hist${i}${scenario.namespace.slice(-4)}`,
				'Row'
			);
			await seedDistributionLog(scenario, { ticket, item, recipient: person, meal: 'lunch' });
		}

		await page.reload();
		await desk.openTab('food');
		await desk.selectPoint(scenarioPoint(scenario));
		await expect(desk.itemButton(item.name)).toContainText('หมดแล้ว');

		await page.getByRole('button', { name: /ประวัติการแจกของตั๋วนี้/ }).click();
		const showAll = page.getByRole('button', { name: 'แสดงทั้งหมด (21)' });
		await expect(showAll).toBeVisible();
		await showAll.click();
		await expect(page.getByRole('button', { name: 'แสดงน้อยลง' })).toBeVisible();
	});

	test('T2-13 a failed duplicate/menu preflight blocks the confirm until a retry succeeds', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('food_preflight');
		const { desk, item, ticket, recipient } = await foodSetup(page, scenario);

		await desk.itemButton(item.name).click();
		await expect(desk.itemButton(item.name)).toContainText('เหลือ 10');

		// Logs are read by `_all_docs` over the `distribution_log:` prefix and filtered client-side;
		// failing that read once the ticket's balance is loaded fails only the recipient preflight.
		let failing = true;
		await page.route(
			(url) =>
				url.pathname.endsWith('/_all_docs') &&
				decodeURIComponent(url.search).includes('distribution_log'),
			async (route) => {
				if (failing) {
					await route.fulfill({ status: 500, body: '{"error":"e2e"}' });
					return;
				}
				await route.fallback();
			}
		);
		await desk.chooseRecipientBySearch(recipient);
		const banner = desk.alert('ตรวจเมนู ประวัติการรับอาหาร และการแพ้ไม่สำเร็จ');
		await expect(banner).toBeVisible({ timeout: 20_000 });
		await expect(desk.foodSubmit()).toBeDisabled();

		failing = false;
		await banner.getByRole('button', { name: 'ลองใหม่' }).click();
		await expect(banner).toBeHidden();
		await desk.foodSubmit().click();
		await expect(desk.toast(/บันทึกแจกอาหารสำเร็จ/)).toBeVisible();
		await expectTicketLogs(ticket, item, 1, 'Handover after preflight retry');
	});

	// CR-200 FR-DFS-05: a mode switch drops the step's form, so typed input asks first.
	test('T2-14 switching mode with a typed quantity asks first; cancelling keeps the input', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('food_mode_draft');
		const { desk, item, recipient } = await foodSetup(page, scenario);
		const qty = page.locator('#food-qty-input');

		await desk.itemButton(item.name).click();
		await desk.chooseRecipientBySearch(recipient);
		await desk.fillFoodQty('2');
		await desk.modeButton('supplies').click();
		const confirm = page.getByRole('alertdialog', { name: /สลับไปโหมดสิ่งของ/ });
		await expect(confirm).toBeVisible();
		await confirm.getByRole('button', { name: 'อยู่โหมดเดิม' }).click();
		await expect(confirm).toBeHidden();
		await expect(desk.modeButton('food')).toHaveAttribute('aria-pressed', 'true');
		await expect(qty).toHaveValue('2');

		await desk.modeButton('supplies').click();
		await confirm.getByRole('button', { name: 'สลับโหมด' }).click();
		await expect(desk.modeButton('supplies')).toHaveAttribute('aria-pressed', 'true');

		// Back at the defaults there is nothing to lose, so the switch is immediate.
		await desk.modeButton('food').click();
		await expect(desk.modeButton('food')).toHaveAttribute('aria-pressed', 'true');
		await expect(confirm).toHaveCount(0);
	});
});

test.describe('Tab 3 — supplies and loans (plan §4.5)', { tag: DESK_TAGS }, () => {
	test('T3-1 a consumable handed to an evacuee is logged fulfilled', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('supplies_consumable');
		const { desk, kit, ticket, recipient } = await suppliesSetup(page, scenario);

		await desk.itemButton(kit.name).click();
		await desk.chooseRecipientBySearch(recipient);
		await desk.fillSuppliesQty('3');
		await desk.suppliesSubmit('consumable').click();
		await expect(desk.toast(/บันทึกแจกจ่ายพัสดุสำเร็จ/)).toBeVisible();

		const [log] = await expectTicketLogs(ticket, kit, 1, 'Consumable handover');
		expect(log).toMatchObject({
			qty: '3',
			status: 'fulfilled',
			is_returnable: false,
			recipient_type: 'evacuee',
			recipient_id: recipient.recipientId
		});
	});

	test('T3-2/T3-6 a consumable can go to an outside recipient, who stays selected for the next handover', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('supplies_outside');
		const { desk, kit, ticket } = await suppliesSetup(page, scenario);

		await desk.itemButton(kit.name).click();
		await desk.chooseOutsideRecipient('ญาติผู้ประสบภัย');
		await desk.fillSuppliesQty('2');
		await desk.suppliesSubmit('consumable').click();
		await expect(desk.toast(/บันทึกแจกจ่ายพัสดุสำเร็จ/)).toBeVisible();

		const [log] = await expectTicketLogs(ticket, kit, 1, 'Outside handover');
		expect(log).toMatchObject({ recipient_type: 'outside', status: 'fulfilled' });
		expect(log.recipient_id ?? null).toBeNull();
		await expect(page.locator('#outside-notes')).toBeVisible();
	});

	test('T3-3 a returnable item is issued as an active loan', async ({ page, scenarioAs }) => {
		const scenario = await scenarioAs('supplies_loan');
		const { desk, blanket, ticket, recipient } = await suppliesSetup(page, scenario);

		await desk.itemButton(blanket.name).click();
		await desk.chooseRecipientBySearch(recipient);
		await desk.fillSuppliesQty('2');
		await expect(desk.suppliesSubmit('consumable')).toHaveCount(0);
		await desk.suppliesSubmit('loan').click();
		await expect(desk.toast(/บันทึกยืมสิ่งของสำเร็จ/)).toBeVisible();

		const [log] = await expectTicketLogs(ticket, blanket, 1, 'Loan issuance');
		expect(log).toMatchObject({
			qty: '2',
			status: 'active',
			is_returnable: true,
			recipient_id: recipient.recipientId
		});

		await desk.openTab('returns');
		await desk.chooseRecipientBySearch(recipient);
		await expect(desk.loanCard(blanket.name)).toContainText('คงค้าง');
	});

	test('T3-4 a returnable item cannot be lent to an outside recipient', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('supplies_outside_loan');
		const { desk, blanket, ticket } = await suppliesSetup(page, scenario);

		await desk.itemButton(blanket.name).click();
		await desk.chooseOutsideRecipient();
		await expect(page.getByText('ของประเภท "ต้องคืน" ให้บุคคลภายนอกยืมไม่ได้')).toBeVisible();
		await expect(desk.suppliesSubmit('loan')).toBeDisabled();
		expect(await expectTicketLogs(ticket, blanket, 0, 'No outside loan')).toHaveLength(0);
	});

	test('T3-5 a quantity above the in-hand balance cannot be confirmed', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('supplies_capacity');
		const { desk, kit, recipient } = await suppliesSetup(page, scenario);

		await desk.itemButton(kit.name).click();
		await desk.chooseRecipientBySearch(recipient);
		await desk.fillSuppliesQty('11');
		await expect(desk.suppliesSubmit('consumable')).toBeDisabled();
		await desk.fillSuppliesQty('10');
		await expect(desk.suppliesSubmit('consumable')).toBeEnabled();
	});
});
