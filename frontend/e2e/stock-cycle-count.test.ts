import process from 'node:process';
import { expect, test, type Page } from '@playwright/test';
import { couchLogin, couchReq, routeBrowserCouchThroughApp, SM_SH001_ROLES } from './helpers/couch';
import { clearSession, injectSession } from './helpers/login';

/**
 * #347 — cycle count: walk one storage point, key every lot, save once.
 * Runs against the seeded SH001 stock. Every ledger row it writes carries a unique note,
 * and `afterAll` deletes exactly those rows, so the shelter's stock is left as found.
 * Set `E2E_SHOTS_DIR` to also save a screenshot of each step.
 */

const SHELTER_DB = 'shelter_sh001';
const SHOTS_DIR = process.env.E2E_SHOTS_DIR;
const RUN_NOTE = `e2e-cycle-count-${Date.now()}`;

const user = { name: 'staff03', password: '!Q2w3e4r5t', roles: SM_SH001_ROLES };

async function shot(page: Page, name: string): Promise<void> {
	if (SHOTS_DIR) await page.screenshot({ path: `${SHOTS_DIR}/${name}.png`, fullPage: false });
}

type LedgerRow = {
	_id: string;
	_rev: string;
	item_id: string;
	qty: string;
	reason: string;
	adjust_reason?: string;
	note?: string;
};

async function rowsWrittenByThisRun(): Promise<LedgerRow[]> {
	const res = await couchReq('POST', `/${SHELTER_DB}/_find`, {
		selector: { note: RUN_NOTE },
		limit: 100
	});
	return ((res.data as { docs?: LedgerRow[] } | null)?.docs ?? []) as LedgerRow[];
}

/** The "ในระบบ" quantity printed on one lot row. */
async function systemQty(row: ReturnType<Page['locator']>): Promise<number> {
	const text = (await row.innerText()).replace(/\s+/g, ' ');
	const match = text.match(/ในระบบ\s+(-?[\d.]+)/);
	if (!match) throw new Error(`No system qty in row: ${text}`);
	return Number(match[1]);
}

test.describe('Stock cycle count (#347)', () => {
	test.describe.configure({ mode: 'serial' });
	let session = '';

	test.beforeAll(async () => {
		session = await couchLogin(user.name, user.password);
	});

	test.beforeEach(async ({ page }) => {
		await routeBrowserCouchThroughApp(page);
		await injectSession(page, user, session);
	});

	test.afterEach(async ({ page }) => {
		await clearSession(page);
		await page.unrouteAll({ behavior: 'ignoreErrors' });
	});

	test.afterAll(async () => {
		for (const row of await rowsWrittenByThisRun()) {
			await couchReq(
				'DELETE',
				`/${SHELTER_DB}/${encodeURIComponent(row._id)}?rev=${encodeURIComponent(row._rev)}`
			);
		}
	});

	test('count the main store: only the lots that differ are written, as count_mismatch', async ({
		page
	}) => {
		await page.setViewportSize({ width: 1280, height: 860 });
		await page.goto('/back-office/supply');
		await page.getByRole('button', { name: 'ตรวจนับ', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'ตรวจนับตามจุดเก็บ' })).toBeVisible();
		await shot(page, '01-desktop-pick-storage-point');

		await page.getByRole('button', { name: /คลังหลัก/ }).click();
		const lots = page.locator('form li');
		await expect(lots.first()).toBeVisible();
		await shot(page, '02-desktop-walk-before-counting');

		// One lot short by 1, one lot over by 2; every other lot "ตรงตามระบบ".
		// Named catalogue items only: legacy merged items in the dev data carry rows without a lot,
		// which the aggregate write-off guard (same rule as the single-lot adjust form) rejects.
		const named = lots.filter({ hasText: /QA331-/ });
		const shortRow = named.nth(0);
		const overRow = named.nth(1);
		const shortSystem = await systemQty(shortRow);
		const overSystem = await systemQty(overRow);
		await shortRow.locator('input').fill(String(Math.max(0, shortSystem - 1)));
		await overRow.locator('input').fill(String(Math.round((overSystem + 2) * 10000) / 10000));
		await page.getByRole('button', { name: 'ที่เหลือตรงตามระบบ' }).click();
		await page.getByLabel(/หมายเหตุ/).fill(RUN_NOTE);

		await expect(page.getByText('ไม่ตรง 2')).toBeVisible();
		const save = page.getByRole('button', { name: /บันทึกผลตรวจนับ \(2 รายการที่ไม่ตรง\)/ });
		await expect(save).toBeEnabled();
		await shot(page, '03-desktop-counted-two-mismatches');

		// A malformed entry blocks saving until it is fixed.
		await shortRow.locator('input').fill('abc');
		await expect(page.getByText('ตัวเลขไม่ถูกต้อง')).toBeVisible();
		await expect(
			page.getByRole('button', { name: /บันทึกผลตรวจนับ|ยังไม่มีรายการ/ })
		).toBeDisabled();
		await shot(page, '04-desktop-invalid-entry-blocks-save');
		await shortRow.locator('input').fill(String(Math.max(0, shortSystem - 1)));
		await expect(save).toBeEnabled();

		await save.click();
		await expect(page.getByText(/บันทึกผลตรวจนับ .* แล้ว \(2 รายการไม่ตรง\)/)).toBeVisible();
		// Back at the storage-point list, ready for the next walk.
		await expect(page.getByRole('button', { name: /คลังหลัก/ })).toBeVisible();
		await shot(page, '05-desktop-saved');

		const rows = await rowsWrittenByThisRun();
		expect(rows).toHaveLength(2);
		expect(rows.every((r) => r.reason === 'adjust' && r.adjust_reason === 'count_mismatch')).toBe(
			true
		);
		expect(rows.map((r) => Number(r.qty)).sort((a, b) => a - b)).toEqual([
			shortSystem === 0 ? 0 : -1,
			2
		]);
	});

	test('phone width: the count list fits the screen and shows the variance', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/back-office/supply');
		await page.getByRole('button', { name: 'ตรวจนับ', exact: true }).click();
		await shot(page, '06-mobile-pick-storage-point');
		await page.getByRole('button', { name: /คลังหลัก/ }).click();

		const first = page.locator('form li').first();
		const system = await systemQty(first);
		await first.locator('input').fill(String(system + 3));
		await expect(first).toContainText('เกิน +3');
		await expect(
			page.getByRole('button', { name: /บันทึกผลตรวจนับ \(1 รายการที่ไม่ตรง\)/ })
		).toBeEnabled();
		await shot(page, '07-mobile-walk-with-variance');

		const overflow = await page.evaluate(() => ({
			scroll: document.documentElement.scrollWidth,
			client: document.documentElement.clientWidth
		}));
		expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
		// Nothing was saved in this test.
		expect(await rowsWrittenByThisRun()).toHaveLength(2);
	});
});
