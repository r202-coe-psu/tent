import type { Locator, Page } from '@playwright/test';
import { appBaseUrl, CAN_WRITE, READ_ONLY_REASON } from './helpers/e2e-env';
import { couchReq } from './helpers/couch';
import { expect, test } from './distribution/fixtures';
import { roleSet, shelterDb, type DistributionScenario } from './distribution/distribution';

/**
 * CR-195 (#824): a bare `lot.expiry` date is usable through the whole Bangkok day and expires at
 * 00:00 Asia/Bangkok of the next day. Runs on the run's own `E2E Distribution …` shelter (the
 * `shelter` worker fixture creates it through system management and tears it down by code, then
 * asserts nothing leaked). The lots are received through the stock receive form, the write-off
 * and the issue go through the adjust and distribute forms, and every balance is read from the
 * UI. Catalog items are the seeded central ones, read only. The browser clock is pinned to 14:00
 * Bangkok, so the pre-CR-195 behaviour (expired from 07:00) is inside the window whenever it runs.
 */

const DAY_MS = 86_400_000;
const bangkokDate = (ms: number) =>
	new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date(ms));
const NOON_MS = Date.parse(`${bangkokDate(Date.now())}T12:00:00+07:00`);
const TODAY = bangkokDate(NOON_MS);
const YESTERDAY = bangkokDate(NOON_MS - DAY_MS);
const TOMORROW = bangkokDate(NOON_MS + DAY_MS);
/**
 * Pinned instants (Bangkok, today). A pinned clock stamps every row it writes with the same
 * `occurred_at`, and the ledger replays rows by `occurred_at` then id; ids of rows written in
 * different page loads tie-break randomly. So each phase that writes gets a later pin than the
 * one before it: receive, then write-off, then issue.
 */
const RECEIVE_AT = new Date(`${TODAY}T12:00:00+07:00`);
const AFTERNOON = new Date(`${TODAY}T14:00:00+07:00`);
const ISSUE_AT = new Date(`${TODAY}T14:30:00+07:00`);

/** `YYYY-MM-DD` → the short Buddhist-era date the UI prints (`27/10/2569`), built by hand. */
function thaiShort(ymd: string): string {
	const [y, m, d] = ymd.split('-').map(Number);
	return `${d}/${m}/${y + 543}`;
}
const dateRe = (ymd: string) => new RegExp(`(?<!\\d)${thaiShort(ymd).replaceAll('/', '\\/')}`);

/** `YYYY-MM-DD` → `DD/MM/YYYY`, what the receive form's date picker accepts as typed text. */
function typedDate(ymd: string): string {
	const [y, m, d] = ymd.split('-');
	return `${d}/${m}/${y}`;
}

const MIX = 'น้ำปลา';
const TODAY_ONLY = 'เกลือ';
const PAST_ONLY = 'น้ำตาลทราย';

interface Lot {
	item: string;
	qty: string;
	expiry: string;
}
const LOTS: Lot[] = [
	{ item: MIX, qty: '10', expiry: TODAY },
	{ item: MIX, qty: '8', expiry: YESTERDAY },
	{ item: TODAY_ONLY, qty: '5', expiry: TODAY },
	{ item: PAST_ONLY, qty: '4', expiry: YESTERDAY }
];

const INTAKE_MESSAGE = 'วันหมดอายุต้องเป็นวันที่จริงในรูปแบบ YYYY-MM-DD';

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toast(page: Page, text: string | RegExp): Locator {
	return page.locator('[data-sonner-toast]').filter({ hasText: text });
}

function stockRow(page: Page, name: string): Locator {
	return page.getByRole('row').filter({ has: page.getByRole('button', { name, exact: true }) });
}

/** The exact "หมดอายุ" status badge (not "ใกล้หมดอายุ", not the date caption). */
const expiredBadge = (scope: Locator) =>
	scope.getByText('หมดอายุ', { exact: true }).filter({ visible: true });

/**
 * The item combobox opens on key input, not on `fill()`, and keys sent while it re-renders on
 * open can be dropped, so check the value and type again if needed.
 */
async function typeInCombobox(input: Locator, text: string): Promise<void> {
	await expect(async () => {
		await input.click();
		await input.clear();
		await input.pressSequentially(text);
		await expect(input).toHaveValue(text, { timeout: 1_000 });
	}).toPass({ timeout: 15_000 });
}

async function pickItem(page: Page, input: Locator, name: string): Promise<void> {
	await typeInCombobox(input, name);
	await page
		.getByRole('option', { name: new RegExp(`^${escapeRegExp(name)}`) })
		.first()
		.click();
}

async function openMovement(
	page: Page,
	button: 'รับเข้า' | 'ตรวจนับ',
	title: string
): Promise<Locator> {
	await page.getByRole('button', { name: button, exact: true }).click();
	const sheet = page.getByRole('dialog', { name: title });
	await expect(sheet).toBeVisible();
	return sheet;
}

async function openSupply(page: Page, at: Date = AFTERNOON): Promise<void> {
	await page.clock.setFixedTime(at);
	await page.goto('/back-office/supply');
	await expect(page.getByRole('heading', { name: 'คลังของศูนย์' })).toBeVisible({
		timeout: 20_000
	});
}

async function openItemSheet(page: Page, item: string): Promise<Locator> {
	await stockRow(page, item).getByRole('button', { name: item, exact: true }).click();
	const sheet = page.getByRole('dialog', { name: item });
	await expect(sheet).toBeVisible();
	return sheet;
}

/** On-hand quantity printed in the stock row. */
async function expectOnHand(page: Page, item: string, qty: number): Promise<void> {
	await expect(stockRow(page, item).getByRole('cell').nth(1)).toContainText(
		new RegExp(`^\\s*${qty}\\b`)
	);
}

type LedgerRow = {
	_id?: string;
	qty: string;
	reason: string;
	adjust_reason?: string;
	lot?: { expiry?: string };
};

async function findLedger(selector: Record<string, unknown>): Promise<LedgerRow[]> {
	const res = await couchReq('POST', `/${shelterDb()}/_find`, {
		selector: { type: 'stock_ledger', ...selector },
		limit: 1000
	});
	return ((res.data as { docs?: LedgerRow[] } | null)?.docs ?? []) as LedgerRow[];
}

/**
 * The `shelter` fixture is worker-scoped, so earlier specs on this worker leave ledger rows in the
 * same shelter DB. `ledgerBaseline` holds the ids present before this suite writes anything;
 * `ledgerRows` skips them so assertions only see rows this suite wrote.
 */
let ledgerBaseline = new Set<string>();

async function snapshotLedger(): Promise<void> {
	ledgerBaseline = new Set((await findLedger({})).map((r) => r._id ?? ''));
}

async function ledgerRows(selector: Record<string, unknown>): Promise<LedgerRow[]> {
	return (await findLedger(selector)).filter((r) => !ledgerBaseline.has(r._id ?? ''));
}

async function countDocs(type: string): Promise<number> {
	const res = await couchReq('POST', `/${shelterDb()}/_find`, {
		selector: { type },
		fields: ['_id'],
		limit: 1000
	});
	return ((res.data as { docs?: unknown[] } | null)?.docs ?? []).length;
}

async function warehouseStaff(
	scenarioAs: (label: string, roles?: string[]) => Promise<DistributionScenario>,
	code: string
): Promise<DistributionScenario> {
	return scenarioAs('expiry', roleSet('warehouse_staff', 'flat', code));
}

test.describe(
	'CR-195 lot expiry is end-of-day Bangkok (#824)',
	{ tag: ['@critical', '@supply'] },
	() => {
		test.skip(!CAN_WRITE, READ_ONLY_REASON);
		test.describe.configure({ mode: 'serial' });
		test.use({ actionTimeout: 15_000 });

		test('setup: the receive form stores bare expiry dates as typed, today and yesterday', async ({
			page,
			shelter,
			scenarioAs
		}) => {
			test.setTimeout(180_000);
			await warehouseStaff(scenarioAs, shelter.code);
			await snapshotLedger();
			await openSupply(page, RECEIVE_AT);

			const sheet = await openMovement(page, 'รับเข้า', 'รับเข้า');
			for (const [index, lot] of LOTS.entries()) {
				await pickItem(page, sheet.getByPlaceholder('ค้นหา…'), lot.item);
				await sheet.getByRole('spinbutton', { name: /จำนวน/ }).fill(lot.qty);
				const date = sheet.getByPlaceholder('วว/ดด/ปปปป');
				await date.fill(typedDate(lot.expiry));
				await date.blur();
				await expect(date).toHaveValue(typedDate(lot.expiry));
				await sheet.getByRole('button', { name: 'บันทึกแล้วรับชิ้นถัดไป' }).click();
				await expect(
					toast(page, 'รับเข้าแล้ว'),
					`receive ${lot.qty} ${lot.item} expiring ${lot.expiry}`
				).toHaveCount(index + 1);
			}
			await page.keyboard.press('Escape');
			await expect(sheet).toBeHidden();

			await expectOnHand(page, MIX, 18);
			await expectOnHand(page, TODAY_ONLY, 5);
			await expectOnHand(page, PAST_ONLY, 4);

			const stored = (await ledgerRows({})).map((r) => [r.qty, r.lot?.expiry]).sort();
			expect(stored, 'expiry dates persisted unshifted').toEqual(
				LOTS.map((l) => [l.qty, l.expiry]).sort()
			);
		});

		test('read: stock page shows a lot expiring today as usable and yesterday as expired', async ({
			page,
			shelter,
			scenarioAs
		}) => {
			await warehouseStaff(scenarioAs, shelter.code);
			await openSupply(page);

			const todayRow = stockRow(page, TODAY_ONLY);
			await expect(expiredBadge(todayRow), 'today lot is not expired').toHaveCount(0);
			await expect(todayRow.getByText('ใกล้หมดอายุ').filter({ visible: true })).toBeVisible();
			await expect(todayRow).toContainText(dateRe(TODAY));
			await expect(todayRow).not.toContainText(dateRe(TOMORROW));

			const pastRow = stockRow(page, PAST_ONLY);
			await expect(expiredBadge(pastRow), 'yesterday lot is expired').toBeVisible();
			await expect(pastRow).toContainText(dateRe(YESTERDAY));

			const attention = page.getByRole('region', { name: 'สรุปสิ่งที่ต้องจัดการ' });
			const expiredCard = attention.getByRole('button', { name: /^หมดอายุ/ });
			await expect(
				expiredCard.getByText('2', { exact: true }),
				'expired card counts the yesterday-only and the mixed item'
			).toBeVisible({ timeout: 10_000 });
			await expiredCard.click();
			await expect(page).toHaveURL(/status=expired/);
			await expect(stockRow(page, PAST_ONLY)).toBeVisible();
			await expect(stockRow(page, MIX)).toBeVisible();
			await expect(
				stockRow(page, TODAY_ONLY),
				'today-only item is not in the expired filter'
			).toHaveCount(0);
		});

		test('read: item sheet marks the yesterday lot expired and offers the today lot next', async ({
			page,
			shelter,
			scenarioAs
		}) => {
			await warehouseStaff(scenarioAs, shelter.code);
			await openSupply(page);
			const sheet = await openItemSheet(page, MIX);

			const lots = sheet.locator('ul > li').filter({ hasText: /หมดอายุ/ });
			await expect(lots).toHaveCount(2);
			const today = lots.filter({ hasText: dateRe(TODAY) });
			const past = lots.filter({ hasText: dateRe(YESTERDAY) });

			await expect(today).toContainText('เบิกถัดไป');
			await expect(today).not.toContainText('หมดอายุ — ปรับยอดออก');
			await expect(today).not.toContainText('หมดอายุแล้ว');
			await expect(today).toContainText('10');

			await expect(past).toContainText('หมดอายุ — ปรับยอดออก');
			await expect(past).toContainText('หมดอายุแล้ว — ปรับยอดออก');
			await expect(past).not.toContainText('เบิกถัดไป');
			await expect(past).toContainText('8');
		});

		test('read: cycle count labels today "หมดอายุ <date>" and yesterday "หมดอายุแล้ว <date>"', async ({
			page,
			shelter,
			scenarioAs
		}) => {
			await warehouseStaff(scenarioAs, shelter.code);
			await openSupply(page);
			const sheet = await openMovement(page, 'ตรวจนับ', 'ตรวจนับตามจุดเก็บ');
			await sheet.getByRole('button', { name: /^คลังหลัก/ }).click();

			const rowsOf = (item: string) => sheet.locator('form li').filter({ hasText: item });
			const mixRows = rowsOf(MIX);
			await expect(mixRows).toHaveCount(2);
			const todayRow = mixRows.filter({ hasText: dateRe(TODAY) });
			const pastRow = mixRows.filter({ hasText: dateRe(YESTERDAY) });

			await expect(
				todayRow.getByText(new RegExp(`^หมดอายุ ${dateRe(TODAY).source}`))
			).toBeVisible();
			await expect(todayRow).not.toContainText('หมดอายุแล้ว');
			await expect(todayRow).not.toContainText(dateRe(TOMORROW));
			await expect(
				pastRow.getByText(new RegExp(`^หมดอายุแล้ว ${dateRe(YESTERDAY).source}`))
			).toBeVisible();

			await expect(
				rowsOf(TODAY_ONLY).getByText(new RegExp(`^หมดอายุ ${dateRe(TODAY).source}`))
			).toBeVisible();
			await expect(
				rowsOf(PAST_ONLY).getByText(new RegExp(`^หมดอายุแล้ว ${dateRe(YESTERDAY).source}`))
			).toBeVisible();
		});

		test('update: adjust form flags only the yesterday lot, then writes part of it off as expired', async ({
			page,
			shelter,
			scenarioAs
		}) => {
			await warehouseStaff(scenarioAs, shelter.code);
			await openSupply(page);
			const sheet = await openItemSheet(page, MIX);
			await sheet.getByRole('button', { name: `ปรับยอด ${MIX}` }).click();

			const lotTrigger = page.locator('#lot-select');
			await expect(lotTrigger).toBeVisible({ timeout: 10_000 });
			await lotTrigger.click();
			const todayOption = page.getByRole('option', { name: /\(หมดอายุ: / });
			const pastOption = page.getByRole('option', { name: /\(หมดอายุแล้ว: / });
			await expect(todayOption).toContainText(`(หมดอายุ: ${thaiShort(TODAY)})`);
			await expect(todayOption).not.toContainText('หมดอายุแล้ว');
			await expect(pastOption).toContainText(`(หมดอายุแล้ว: ${thaiShort(YESTERDAY)})`);

			await todayOption.click();
			await expect(
				page.getByText('ล็อตนี้หมดอายุแล้ว'),
				'today lot carries no expired marker'
			).toHaveCount(0);

			await lotTrigger.click();
			await pastOption.click();
			await expect(page.getByText('ล็อตนี้หมดอายุแล้ว')).toBeVisible();

			await page.locator('#new-qty').fill('3');
			await page
				.getByRole('group', { name: /เหตุผล/ })
				.getByRole('button', { name: 'หมดอายุ', exact: true })
				.click();
			await page.getByRole('button', { name: /^ตัดออก 5/ }).click();
			await expect(toast(page, 'ปรับยอดแล้ว')).toBeVisible({ timeout: 10_000 });

			await page.keyboard.press('Escape');
			await expectOnHand(page, MIX, 13);
			expect(
				(await ledgerRows({ reason: 'adjust', adjust_reason: 'expired' })).map((r) => [
					r.qty,
					r.lot?.expiry
				]),
				'one expired write-off of 5 against the yesterday lot'
			).toEqual([['-5', YESTERDAY]]);
		});

		test('issue: direct distribute plans only the today lot, skips the expired one and issues from it', async ({
			page,
			shelter,
			scenarioAs
		}) => {
			await warehouseStaff(scenarioAs, shelter.code);
			await openSupply(page, ISSUE_AT);
			const sheet = await openItemSheet(page, MIX);
			await sheet.getByRole('button', { name: `เบิกจ่าย ${MIX}` }).click();

			const qty = page.getByPlaceholder('0', { exact: true });
			await expect(qty).toBeVisible({ timeout: 10_000 });
			await qty.fill('3');

			const plan = page.getByText('แผนการตัดล็อต').locator('xpath=..');
			await expect(plan, 'auto plan draws from the 10-unit today lot').toContainText(
				'จากคงเหลือ 10'
			);
			await expect(plan, 'auto plan leaves the 3-unit expired lot out').not.toContainText(
				'จากคงเหลือ 3'
			);
			await expect(plan).toContainText('ข้าม 1 ล็อตที่หมดอายุแล้ว');

			await page.getByRole('button', { name: 'เลือกล็อตเอง' }).click();
			const lotTrigger = page.getByRole('button', { name: /^ล็อต \*/ });
			await expect(lotTrigger, 'manual mode preselects the today lot').toContainText('คงเหลือ 10');

			await page.getByRole('button', { name: 'อื่นๆ...' }).click();
			await page.getByPlaceholder('ปลายทาง / ผู้รับ').fill(`E2E ${shelter.code}`);
			await page.getByRole('button', { name: /^เบิก 3/ }).click();
			await expect(toast(page, 'เบิกแล้ว')).toBeVisible({ timeout: 15_000 });

			await page.keyboard.press('Escape');
			await expectOnHand(page, MIX, 10);
			expect(
				(await ledgerRows({ reason: 'distribute' })).map((r) => r.qty),
				'one issue of 3'
			).toEqual(['-3']);
		});

		test('read: after the write-off and the issue the sheet shows today at 7 and yesterday at 3', async ({
			page,
			shelter,
			scenarioAs
		}) => {
			await warehouseStaff(scenarioAs, shelter.code);
			await openSupply(page);
			const sheet = await openItemSheet(page, MIX);
			const lots = sheet.locator('ul > li').filter({ hasText: /หมดอายุ/ });
			const today = lots.filter({ hasText: dateRe(TODAY) });
			await expect(today).toContainText('7');
			await expect(lots.filter({ hasText: dateRe(YESTERDAY) })).toContainText('3');
			await expect(today).not.toContainText('หมดอายุ — ปรับยอดออก');
		});

		test('boundary: 23:59 today is still usable, 00:00:30 tomorrow is expired', async ({
			page,
			shelter,
			scenarioAs
		}) => {
			await warehouseStaff(scenarioAs, shelter.code);

			await openSupply(page, new Date(`${TODAY}T23:59:00+07:00`));
			const lateRow = stockRow(page, TODAY_ONLY);
			await expect(lateRow).toBeVisible();
			await expect(expiredBadge(lateRow), '23:59 today: not expired').toHaveCount(0);
			await expect(lateRow.getByText('ใกล้หมดอายุ').filter({ visible: true })).toBeVisible();

			await openSupply(page, new Date(`${TOMORROW}T00:00:30+07:00`));
			await expect(
				expiredBadge(stockRow(page, TODAY_ONLY)),
				'00:00:30 tomorrow: expired'
			).toBeVisible();
		});

		test('walk-in intake rejects a malformed lot.expiry and writes nothing', async ({
			shelter,
			scenarioAs
		}) => {
			const staff = await warehouseStaff(scenarioAs, shelter.code);
			const before = {
				donations: await countDocs('donation'),
				ledger: await countDocs('stock_ledger')
			};

			const post = async (expiry: string) => {
				const res = await fetch(`${appBaseUrl()}/api/back-office/donations`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Cookie: `AuthSession=${staff.session}` },
					body: JSON.stringify({
						shelter_code: shelter.code,
						donor: { name: `E2E ${shelter.code}` },
						items: [
							{
								item_id: `item_master:${shelter.code}-absent`,
								qty: '1',
								unit: 'box',
								lot: { expiry }
							}
						]
					})
				});
				return { status: res.status, body: (await res.json()) as Record<string, unknown> };
			};

			for (const bad of ['23/10/2026', '2026-02-30']) {
				const res = await post(bad);
				expect(res.status, `status for ${bad}`).toBe(422);
				expect(res.body.error_code, `error_code for ${bad}`).toBe('INVALID_INPUT');
				expect(JSON.stringify(res.body)).toContain(INTAKE_MESSAGE);
			}

			for (const good of ['2026-10-23', '']) {
				const res = await post(good);
				expect(res.body.error_code, `error_code for "${good}"`).toBe('CATALOG_MISMATCH');
				expect(JSON.stringify(res.body)).not.toContain(INTAKE_MESSAGE);
			}

			expect(
				{ donations: await countDocs('donation'), ledger: await countDocs('stock_ledger') },
				'no donation or ledger row was written'
			).toEqual(before);
		});
	}
);
