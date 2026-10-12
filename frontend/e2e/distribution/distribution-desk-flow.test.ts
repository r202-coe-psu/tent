/**
 * Distribution Desk — behaviour across tabs and a full shift (plan §4.8–§4.9):
 * point filter, badges, live updates between desks, the scan-first recipient flow,
 * and a compound-role distribution staff working every tab end to end.
 */

import type { Page } from '@playwright/test';
import { routeBrowserCouchThroughApp } from '../helpers/couch';
import { injectSession } from '../helpers/login';
import { expect, test } from './fixtures';
import { deskTicketCount, expectTicketLogs, expectTicketStatus } from './checks';
import {
	getShelterDocument,
	roleSet,
	scenarioPoint,
	seedItemWithStock,
	seedRecipient,
	seedTicket,
	shelterDb,
	type DistributionScenario
} from './distribution';
import { DeskPage, escapeRegExp } from './pages/desk.page';
import { consumable, DESK_TAGS, tabBadge } from './distribution-desk-setup';

async function scanUnknownCode(
	page: Page,
	scenario: DistributionScenario,
	code: string
): Promise<void> {
	const desk = new DeskPage(page);
	const item = await consumable(scenario, 'scan miss');
	await seedTicket(scenario, {
		type: 'supplies',
		status: 'DISTRIBUTING',
		lines: [{ item, allocatedQty: '5' }]
	});

	await desk.goto();
	await desk.openTab('supplies');
	await desk.selectPoint(scenarioPoint(scenario));
	await desk.itemButton(item.name).click();
	await desk.chooseRecipientByScan(code);
	await expect(page.getByText(`ไม่พบผู้ประสบภัยจากรหัส "${code}"`).first()).toBeVisible();
	await expect(page.getByRole('button', { name: 'เปลี่ยนผู้รับ' })).toHaveCount(0);
}

test.describe(
	'Across tabs — point filter, badges, live updates, scan-first (plan §4.8)',
	{ tag: DESK_TAGS },
	() => {
		test('X-1/X-2 the point filter narrows tickets while tab badges keep counting every point', async ({
			page,
			scenarioAs
		}) => {
			const scenario = await scenarioAs('cross_point_filter');
			const desk = new DeskPage(page);
			const north = scenarioPoint(scenario);
			const south = `${north} B`;
			const northItem = await consumable(scenario, 'north');
			const southItem = await consumable(scenario, 'south');
			await seedTicket(scenario, {
				type: 'supplies',
				status: 'DISTRIBUTING',
				lines: [{ item: northItem, allocatedQty: '5' }]
			});
			await seedTicket(scenario, {
				type: 'supplies',
				status: 'DISTRIBUTING',
				destination: south,
				lines: [{ item: southItem, allocatedQty: '5' }]
			});

			await desk.goto();
			await desk.openTab('supplies');
			// The badge counts every DISTRIBUTING supplies ticket in the shelter, at any point.
			const openCount = await deskTicketCount('DISTRIBUTING', 'supplies');
			await expect.poll(() => tabBadge(desk, 'supplies', /เปิดแจก (\d+)/)).toBe(openCount);

			await desk.selectPoint(north);
			await expect(desk.itemButton(northItem.name)).toBeVisible();
			await expect(desk.itemButton(southItem.name)).toHaveCount(0);
			expect(await tabBadge(desk, 'supplies', /เปิดแจก (\d+)/)).toBe(openCount);

			await desk.selectPoint(south);
			await expect(desk.itemButton(southItem.name)).toBeVisible();
			await expect(desk.itemButton(northItem.name)).toHaveCount(0);
			expect(await tabBadge(desk, 'supplies', /เปิดแจก (\d+)/)).toBe(openCount);

			await desk.selectPoint('ทุกจุด');
			await page.getByLabel('เลือกตั๋วพัสดุที่ใช้งาน').click();
			// Option label: "{ticket_no} · {point} ({items})" — anchor on " · {point} (" because the
			// south point's name extends the north one.
			const option = (point: string) =>
				page.getByRole('option', { name: new RegExp(` · ${escapeRegExp(point)} \\(`) });
			await expect(option(north)).toBeVisible();
			await expect(option(south)).toBeVisible();
			await page.keyboard.press('Escape');
		});

		test('X-3 receiving a ticket resets the point filter', async ({ page, scenarioAs }) => {
			const scenario = await scenarioAs('cross_point_reset');
			const desk = new DeskPage(page);
			const item = await consumable(scenario, 'reset');
			await seedTicket(scenario, {
				type: 'supplies',
				status: 'DISTRIBUTING',
				lines: [{ item, allocatedQty: '5' }]
			});
			const incoming = await seedTicket(scenario, {
				type: 'supplies',
				status: 'IN_TRANSIT',
				destination: `${scenarioPoint(scenario)} B`,
				lines: [{ item, allocatedQty: '5' }]
			});

			await desk.goto();
			await desk.openTab('supplies');
			await desk.selectPoint(scenarioPoint(scenario));
			await desk.receive(incoming);
			await expectTicketStatus(incoming, 'DISTRIBUTING', 'Receive checkpoint');
			await expect(page.getByLabel('เลือกจุดแจก')).toContainText('ทุกจุด');
		});

		test('X-4 a handover on one desk updates the balance on another without reload', async ({
			page,
			browser,
			scenarioAs
		}) => {
			const scenario = await scenarioAs('cross_live_update');
			const item = await consumable(scenario, 'live');
			const ticket = await seedTicket(scenario, {
				type: 'supplies',
				status: 'DISTRIBUTING',
				lines: [{ item, allocatedQty: '10' }]
			});

			const otherContext = await browser.newContext();
			try {
				const otherPage = await otherContext.newPage();
				await routeBrowserCouchThroughApp(otherPage);
				await injectSession(otherPage, scenario.user, scenario.session);
				// The desk subscribes to `_changes` with since=now ~1.5 s after load; a write before that
				// first poll is not replayed. Start writing only once the watcher is listening.
				const listening = otherPage.waitForRequest((req) =>
					req.url().includes(`/${shelterDb()}/_changes`)
				);
				const watcher = new DeskPage(otherPage);
				await watcher.goto();
				await watcher.openTab('supplies');
				await watcher.selectPoint(scenarioPoint(scenario));
				await expect(watcher.itemButton(item.name)).toContainText('เหลือ 10');
				await listening;

				const desk = new DeskPage(page);
				await desk.goto();
				await desk.openTab('supplies');
				await desk.selectPoint(scenarioPoint(scenario));
				await desk.itemButton(item.name).click();
				await desk.chooseOutsideRecipient();
				await desk.fillSuppliesQty('3');
				await desk.suppliesSubmit('consumable').click();
				await expectTicketLogs(ticket, item, 1, 'Live-update handover');

				await expect(watcher.itemButton(item.name)).toContainText('เหลือ 7', { timeout: 15_000 });
			} finally {
				await otherContext.close();
			}
		});

		test('X-5/X-7/X-8 a scanned recipient is selected, the scanner reopens after the handover, and the recipient can be changed', async ({
			page,
			scenarioAs
		}) => {
			const scenario = await scenarioAs('cross_scan');
			const desk = new DeskPage(page);
			const item = await consumable(scenario, 'scan');
			const ticket = await seedTicket(scenario, {
				type: 'supplies',
				status: 'DISTRIBUTING',
				lines: [{ item, allocatedQty: '5' }]
			});
			const recipient = await seedRecipient(
				scenario,
				`Scan${scenario.namespace.slice(-6)}`,
				'Person'
			);

			await desk.goto();
			await desk.openTab('supplies');
			await desk.selectPoint(scenarioPoint(scenario));
			await desk.itemButton(item.name).click();
			await desk.chooseRecipientByScan(recipient.recipientId);
			await expect(desk.selectedRecipientCard(recipient)).toBeVisible();

			await desk.fillSuppliesQty('1');
			await desk.suppliesSubmit('consumable').click();
			await expect(desk.toast(/บันทึกแจกจ่ายพัสดุสำเร็จ/)).toBeVisible();
			const [log] = await expectTicketLogs(ticket, item, 1, 'Scanned handover');
			expect(log).toMatchObject({ recipient_id: recipient.recipientId });
			// Scan-first: the scanner opens again for the next person.
			await expect(desk.scannerDialog()).toBeVisible();
			await desk.scannerDialog().getByRole('button', { name: 'ยกเลิก' }).click();

			await desk.chooseRecipientBySearch(recipient);
			await page.getByRole('button', { name: 'เปลี่ยนผู้รับ' }).click();
			await expect(page.locator('#recipient-search-input')).toBeVisible();
			await expect(desk.selectedRecipientCard(recipient)).toHaveCount(0);
		});

		test('X-6a an unknown scan code is reported and selects nobody', async ({
			page,
			scenarioAs
		}) => {
			const scenario = await scenarioAs('cross_scan_miss');
			await scanUnknownCode(page, scenario, 'NOSUCHEVACUEE');
		});

		// README §5: known app bug, kept as `test.fixme` with a GAP: title until the fix flips it.
		// After an `_id` miss, lookupEvacueeByScanCode falls back to searchEvacuees(), whose matcher
		// compares the code's digits with phone numbers — "NOSUCH-3" selects the first evacuee whose
		// phone contains "3", so a mistyped barcode hands out to the wrong person.
		test.fixme('GAP: X-6b an unknown scan code containing digits selects nobody', async ({
			page,
			scenarioAs
		}) => {
			const scenario = await scenarioAs('cross_scan_miss_digits');
			await seedRecipient(scenario, `Phone${scenario.namespace.slice(-6)}`, 'Holder', {
				phone: '0830000003'
			});
			await scanUnknownCode(page, scenario, 'NOSUCH-3');
		});
	}
);

test.describe('Distribution staff end to end (plan §4.9)', { tag: DESK_TAGS }, () => {
	// A compound-role DST (the form the user form writes) works a shift on every tab;
	// tickets arrive IN_TRANSIT because DST cannot create or dispatch them (CR-161 R4).
	test('a compound-role DST receives, hands out, lends, clears a loan and closes the shift', async ({
		page,
		scenarioAs
	}) => {
		const scenario = await scenarioAs('dst_journey', roleSet('distribution_staff', 'compound'));
		const dst = scenario.user.name;
		const desk = new DeskPage(page);
		const meal = await seedItemWithStock(scenario, {
			name: `E2E DST meal ${scenario.namespace}`,
			stockQty: '10',
			returnable: false,
			typeClass: 'CONSUMABLE'
		});
		const blanket = await seedItemWithStock(scenario, {
			name: `E2E DST blanket ${scenario.namespace}`,
			stockQty: '4',
			returnable: true,
			typeClass: 'DURABLE'
		});
		const food = await seedTicket(scenario, {
			type: 'food',
			status: 'IN_TRANSIT',
			meal: 'dinner',
			lines: [{ item: meal, allocatedQty: '10' }]
		});
		const supplies = await seedTicket(scenario, {
			type: 'supplies',
			status: 'IN_TRANSIT',
			lines: [{ item: blanket, allocatedQty: '4' }]
		});
		const recipient = await seedRecipient(
			scenario,
			`Dst${scenario.namespace.slice(-6)}`,
			'Recipient'
		);

		await test.step('Tab 1 — receive both tickets', async () => {
			await desk.goto();
			await desk.receive(food);
			await desk.receive(supplies);
			await expectTicketStatus(food, 'DISTRIBUTING', 'Food receive');
			await expectTicketStatus(supplies, 'DISTRIBUTING', 'Supplies receive');
			for (const ticket of [food, supplies]) {
				expect((await getShelterDocument(ticket.ticketId))?.received_by).toBe(dst);
			}
		});

		await test.step('Tab 2 — hand out a meal', async () => {
			await desk.openTab('food');
			await desk.selectPoint(scenarioPoint(scenario));
			await desk.itemButton(meal.name).click();
			await desk.chooseRecipientBySearch(recipient);
			await desk.foodSubmit().click();
			await expect(desk.toast(/บันทึกแจกอาหารสำเร็จ/)).toBeVisible();
			const [log] = await expectTicketLogs(food, meal, 1, 'DST meal');
			expect(log).toMatchObject({ distributed_by: dst, created_by: dst, status: 'fulfilled' });
		});

		let loanId = '';
		await test.step('Tab 3 — lend two blankets', async () => {
			await desk.openTab('supplies');
			await desk.itemButton(blanket.name).click();
			await desk.chooseRecipientBySearch(recipient);
			await desk.fillSuppliesQty('2');
			await desk.suppliesSubmit('loan').click();
			await expect(desk.toast(/บันทึกยืมสิ่งของสำเร็จ/)).toBeVisible();
			const [log] = await expectTicketLogs(supplies, blanket, 1, 'DST loan');
			expect(log).toMatchObject({ distributed_by: dst, status: 'active' });
			loanId = log._id;
		});

		await test.step('Tab 4 — close the loan as lost', async () => {
			await desk.openTab('returns');
			await desk.chooseRecipientBySearch(recipient);
			await desk
				.loanCard(blanket.name)
				.getByRole('button', { name: /ปิดรายการโดยไม่มีของคืน/ })
				.click();
			const dialog = desk.nonPhysicalDialog();
			await dialog.getByLabel('สูญหาย').first().check();
			await dialog.locator('#clear-notes-input').fill('ผู้ยืมแจ้งสูญหาย');
			await dialog.getByRole('button', { name: 'ยืนยันตัดจำหน่ายรายการ' }).click();
			await expect(dialog).toBeHidden();
			await expect.poll(async () => (await getShelterDocument(loanId))?.status).toBe('lost');
			expect((await getShelterDocument(loanId))?.returned_by).toBe(dst);
		});

		await test.step('Tab 5 — close the supplies shift and send returns to the warehouse', async () => {
			await desk.openTab('reconciliation');
			await desk.selectTicket('reconciliation', supplies);
			await desk.closeShift({ [blanket.name]: '2' });
			await expectTicketStatus(supplies, 'SHIFT_CLOSED', 'DST close');
			await page.getByRole('button', { name: /ส่งคืนพัสดุกลับคลังกลาง/ }).click();
			await expectTicketStatus(supplies, 'RETURN_PENDING_RECEIPT', 'DST submit');
		});

		await test.step('Back-office stays closed to DST', async () => {
			await page.goto('/back-office/distribution');
			await expect(page).toHaveURL(/\/portal/);
		});
	});
});
