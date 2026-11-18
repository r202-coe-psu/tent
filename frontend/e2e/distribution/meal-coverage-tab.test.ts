/**
 * Meal coverage tab (`/back-office/evacuee-management?tab=meals`, #1300).
 *
 * Seeds today's kitchen services (breakfast + lunch), two residents who were in the shelter
 * for days, and breakfast + lunch handovers for one of them — today and yesterday. Proves the
 * summary cards, the roster + status filter, the CSV export (phone-like distributors masked),
 * the past-day view, and that a role outside evacuee registration is redirected away.
 */

import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { ulid } from '../../src/lib/db/ulid';
import { putDocument } from '../helpers/couch';
import { selectActiveShelter } from '../helpers/staff-ui';
import { expect, test } from './fixtures';
import {
	roleSet,
	seedDistributionLog,
	seedRecipient,
	seedTicket,
	shelterCode,
	shelterDb,
	type DistributionScenario
} from './distribution';
import { consumable } from './distribution-desk-setup';

const MEALS_URL = '/back-office/evacuee-management?tab=meals';
const TAGS = ['@back-office', '@distribution'];
const PHONE_DISTRIBUTOR = '0812345678';
const DAY_MS = 24 * 3600_000;

/** The Thai calendar day (`YYYY-MM-DD`) the app treats as "today", `daysAgo` days back. */
function thaiDay(daysAgo = 0): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(
		new Date(Date.now() - daysAgo * DAY_MS)
	);
}

/** Minutes left in the Thai day; a seed that straddles midnight would land on the wrong day. */
function minutesToThaiMidnight(): number {
	const [h, m] = new Intl.DateTimeFormat('en-GB', {
		timeZone: 'Asia/Bangkok',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	})
		.format(new Date())
		.split(':')
		.map(Number);
	return 24 * 60 - (h * 60 + m);
}

async function seedMealService(
	scenario: DistributionScenario,
	meal: 'breakfast' | 'lunch',
	date: string
): Promise<void> {
	const now = new Date().toISOString();
	await putDocument(shelterDb(), {
		_id: `meal_service:${ulid()}`,
		type: 'meal_service',
		schema_v: 2,
		shelter_code: shelterCode(),
		created_at: now,
		updated_at: now,
		created_by: scenario.user.name,
		date,
		meal,
		meal_plan_id: null,
		actual_yield: 10,
		served: 10,
		waste: 0,
		external: { volunteers: 0, outside_evacuees: 0 }
	});
}

test.describe('Meal coverage tab (#1300)', { tag: TAGS }, () => {
	test('shows summary cards and the roster, filters it and exports CSV', async ({
		page,
		scenarioAs,
		shelter
	}) => {
		test.skip(minutesToThaiMidnight() < 5, 'too close to midnight (Thai time) to seed today');
		const today = thaiDay();
		const scenario = await scenarioAs('meal_coverage');
		const tag = scenario.namespace.slice(-6);
		const fed = `E2E อิ่ม${tag}`;
		const unfed = `E2E หิว${tag}`;
		const since = new Date(Date.now() - 3 * DAY_MS).toISOString();

		const fedPerson = await seedRecipient(scenario, fed, 'ทดสอบ', { staySince: since });
		await seedRecipient(scenario, unfed, 'ทดสอบ', { staySince: since });
		await seedMealService(scenario, 'breakfast', today);
		await seedMealService(scenario, 'lunch', today);

		const item = await consumable(scenario, 'meal coverage');
		const ticket = await seedTicket(scenario, {
			type: 'food',
			status: 'DISTRIBUTING',
			meal: 'breakfast',
			lines: [{ item, allocatedQty: '10' }]
		});
		await seedDistributionLog(scenario, {
			ticket,
			item,
			recipient: fedPerson,
			meal: 'breakfast',
			distributedBy: PHONE_DISTRIBUTOR
		});
		await seedDistributionLog(scenario, { ticket, item, recipient: fedPerson, meal: 'lunch' });

		await selectActiveShelter(page, shelter.code);
		await page.goto(MEALS_URL);

		await expect(page.getByRole('heading', { name: 'การรับอาหารประจำวัน' })).toBeVisible();
		await expect(page.getByText('วันนี้นับเฉพาะมื้อที่ให้บริการแล้ว:')).toBeVisible();

		const roster = page.getByRole('table', { name: 'รายชื่อผู้พักพิงและบันทึกรับอาหาร' });
		const fedRow = roster.getByRole('row').filter({ hasText: fed });
		const unfedRow = roster.getByRole('row').filter({ hasText: unfed });
		await expect(fedRow).toContainText('ครบ 2/2 มื้อ', { timeout: 30_000 });
		await expect(fedRow).toContainText(scenario.user.name);
		await expect(fedRow).toContainText('•••5678');
		await expect(unfedRow).toContainText('ยังไม่ถึง 2 มื้อ · 0/2');

		// Summary cards count both residents (the shelter holds only these two).
		const count = (label: string) =>
			page.getByRole('button', { name: new RegExp(`^${label}`) }).locator('.text-3xl');
		await expect(count('อยู่ในศูนย์ตั้งแต่ต้นวัน')).toHaveText('2');
		await expect(count('ได้รับครบ')).toHaveText('1');
		await expect(count('ยังไม่มีบันทึกเลย')).toHaveText('1');

		// Status filter narrows the roster to people without any record.
		await page.locator('#meal-coverage-status').click();
		await page.getByRole('option', { name: 'ยังไม่มีบันทึกเลย' }).click();
		await expect(unfedRow).toBeVisible();
		await expect(fedRow).toHaveCount(0);

		// CSV carries the filtered rows only; unfiltered it masks the phone-like distributor.
		const filtered = await exportCsv(page);
		expect(filtered.name).toBe(`meal-coverage-${shelter.code}-${today}.csv`);
		expect(filtered.csv).toContain('ชื่อ');
		expect(filtered.csv).toContain(unfed);
		expect(filtered.csv).not.toContain(fed);

		await page.locator('#meal-coverage-status').click();
		await page.getByRole('option', { name: 'ทุกสถานะ' }).click();
		const all = (await exportCsv(page)).csv;
		expect(all).toContain(fed);
		expect(all).toContain('•••5678');
		expect(all).not.toContain(PHONE_DISTRIBUTOR);
	});

	test('picking a past day counts that day, not today', async ({ page, scenarioAs, shelter }) => {
		test.skip(minutesToThaiMidnight() < 5, 'too close to midnight (Thai time) to pick a day');
		const yesterday = thaiDay(1);
		const scenario = await scenarioAs('meal_coverage_past');
		const tag = scenario.namespace.slice(-6);
		const fed = `E2E เมื่อวานอิ่ม${tag}`;
		const unfed = `E2E เมื่อวานหิว${tag}`;
		const since = new Date(Date.now() - 3 * DAY_MS).toISOString();

		const fedPerson = await seedRecipient(scenario, fed, 'ทดสอบ', { staySince: since });
		await seedRecipient(scenario, unfed, 'ทดสอบ', { staySince: since });
		const item = await consumable(scenario, 'meal coverage past');
		const ticket = await seedTicket(scenario, {
			type: 'food',
			status: 'DISTRIBUTING',
			meal: 'breakfast',
			lines: [{ item, allocatedQty: '10' }]
		});
		for (const meal of ['breakfast', 'lunch'] as const) {
			await seedDistributionLog(scenario, {
				ticket,
				item,
				recipient: fedPerson,
				meal,
				distributedAt: new Date(`${yesterday}T12:00:00+07:00`).toISOString()
			});
		}

		await selectActiveShelter(page, shelter.code);
		await page.goto(MEALS_URL);
		await expect(page.getByRole('heading', { name: 'การรับอาหารประจำวัน' })).toBeVisible();

		await page.locator('#meal-coverage-day').click();
		// On the 1st, yesterday is in the previous month: page the calendar back first.
		if (yesterday.slice(0, 7) !== thaiDay().slice(0, 7)) {
			await page.locator('[data-calendar-prev-button]').click();
		}
		await page
			.locator(`[data-bits-day][data-value="${yesterday}"]:not([data-outside-month])`)
			.click();

		await expect(page.getByText('วันนี้นับเฉพาะมื้อที่ให้บริการแล้ว')).toHaveCount(0);
		const roster = page.getByRole('table', { name: 'รายชื่อผู้พักพิงและบันทึกรับอาหาร' });
		await expect(roster.getByRole('row').filter({ hasText: fed })).toContainText('ครบ 2/2 มื้อ', {
			timeout: 30_000
		});
		await expect(roster.getByRole('row').filter({ hasText: unfed })).toContainText(
			'ยังไม่ถึง 2 มื้อ · 0/2'
		);
	});

	test('a role outside evacuee registration is redirected to the portal', async ({
		page,
		scenarioAs
	}) => {
		await scenarioAs('meal_coverage_denied', roleSet('kitchen_staff', 'flat'));
		await page.goto(MEALS_URL);
		await expect(page).toHaveURL(/\/portal(?:[/?#]|$)/);
		await expect(page.getByRole('heading', { name: 'การรับอาหารประจำวัน' })).toHaveCount(0);
	});
});

async function exportCsv(page: Page) {
	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('button', { name: 'ส่งออก CSV' }).click();
	const download = await downloadPromise;
	return {
		name: download.suggestedFilename(),
		csv: await readFile((await download.path())!, 'utf8')
	};
}
