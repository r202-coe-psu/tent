import { test, expect, type Page } from '@playwright/test';
import {
	createCouchUser,
	deleteCouchUser,
	couchLogin,
	couchReq,
	SA_ROLES,
	SM_SH001_ROLES,
	SM_SH002_ROLES,
	SM_SH003_ROLES
} from './helpers/couch';
import { injectSession, clearSession } from './helpers/login';

/**
 * CR-091 — read-only transfer ticket detail page (banner + timeline).
 *
 * Covers what unit tests cannot reach: the list link and the `_id` round-trip through the URL,
 * the side label per logged-in shelter, progressive fields on real documents, the 403 → "not
 * found" rendering and the timeline after a real dispute → resume. The ordering / reason / line
 * key rules themselves are unit-tested in `domain/transfer.view.test.ts`.
 */

const RUN_ID = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);

function user(key: string, roles: string[], display_name: string) {
	return { name: `td_${key}_${RUN_ID}`, password: 'Password1!', roles, display_name };
}

const SM1 = user('sm1', SM_SH001_ROLES, 'Source SM');
const SM2 = user('sm2', SM_SH002_ROLES, 'Dest SM');
const SM3 = user('sm3', SM_SH003_ROLES, 'Other SM');
const SA = user('sa', SA_ROLES, 'System Admin');
type TestUser = typeof SM1;

const sessions: Record<string, string> = {};

/**
 * Unique per SEEDED TRANSFER: the suite is `fullyParallel`, so every worker's list shows every
 * transfer this run has seeded, and a shared item id would make one row locator match many.
 */
function itemIdFor(suffix: string): string {
	return `item:td_${RUN_ID}${suffix.toLowerCase()}`;
}

const REQUESTED_AT = '2026-08-22T05:00:00.000Z';
const SHIPPED_AT = '2026-08-22T07:00:00.000Z';

interface TimelineEvent {
	at: string;
	by: string;
}

interface PersistedTransfer {
	_id: string;
	_rev?: string;
	type: 'stock_transfer';
	schema_v: number;
	shelter_code: string;
	created_at: string;
	updated_at: string;
	created_by: string;
	from_shelter: string;
	to_shelter: string;
	items: { item_id: string; qty: string; unit: string; received_qty?: string }[];
	status: string;
	timeline: Record<string, TimelineEvent>;
	driver_name?: string;
	vehicle_plate?: string;
	cancel_reason?: string;
	dispute_reason?: string;
}

const seededIds: string[] = [];

/** A transfer out of SH001 into SH002, written straight into `central_ops` like the app does. */
async function seedTransfer(
	suffix: string,
	overrides: Partial<PersistedTransfer> = {}
): Promise<PersistedTransfer> {
	const doc: PersistedTransfer = {
		_id: `stock_transfer:01TD${RUN_ID.toUpperCase()}${suffix}`.slice(0, 40),
		type: 'stock_transfer',
		schema_v: 3,
		shelter_code: 'SH001',
		created_at: REQUESTED_AT,
		updated_at: REQUESTED_AT,
		created_by: 'Seed Staff',
		from_shelter: 'SH001',
		to_shelter: 'SH002',
		items: [{ item_id: itemIdFor(suffix), qty: '100', unit: 'kg' }],
		status: 'requested',
		timeline: { requested: { at: REQUESTED_AT, by: 'Seed Staff' } },
		...overrides
	};

	const res = await couchReq('PUT', `/central_ops/${encodeURIComponent(doc._id)}`, doc);
	expect(res.status, 'seeding the transfer must succeed').toBeLessThan(300);
	seededIds.push(doc._id);
	return { ...doc, _rev: (res.data as { rev: string }).rev };
}

async function readTransfer(id: string): Promise<PersistedTransfer | null> {
	const res = await couchReq('GET', `/central_ops/${encodeURIComponent(id)}`);
	return res.status === 200 ? (res.data as PersistedTransfer) : null;
}

test.beforeAll(async () => {
	for (const db of ['central_ops', 'shelter_sh001', 'shelter_sh002', 'shelter_sh003', 'registry']) {
		await couchReq('PUT', `/${db}`);
	}
	for (const u of [SM1, SM2, SM3, SA]) {
		await createCouchUser(u);
		sessions[u.name] = await couchLogin(u.name, u.password);
	}
});

test.afterAll(async () => {
	for (const u of [SM1, SM2, SM3, SA]) await deleteCouchUser(u.name);

	for (const id of seededIds) {
		const doc = await readTransfer(id);
		if (doc?._rev) {
			await couchReq('DELETE', `/central_ops/${encodeURIComponent(id)}?rev=${doc._rev}`);
		}
	}
});

test.afterEach(async ({ page }) => {
	await clearSession(page);
});

function transferRow(page: Page, suffix: string) {
	return page.getByRole('row').filter({ hasText: itemIdFor(suffix) });
}

async function openSupplyTransfers(page: Page, u: TestUser) {
	await injectSession(page, u, sessions[u.name]);
	await page.goto('/back-office/supply?tab=transfer');
	await expect(page.getByRole('heading', { name: 'รายการโอนย้ายข้ามศูนย์' })).toBeVisible();
}

async function openDetail(page: Page, u: TestUser, id: string) {
	await injectSession(page, u, sessions[u.name]);
	await page.goto(`/back-office/supply/transfer/${encodeURIComponent(id)}`);
	await expect(page.getByRole('heading', { name: 'รายละเอียดคำร้องโอนย้าย' })).toBeVisible();
}

/** Keys of the rendered timeline steps, top to bottom. */
function timelineSteps(page: Page) {
	return page.getByTestId('transfer-timeline').locator('li');
}

test.describe('CR-091 — transfer ticket detail page', () => {
	test('the list link opens the ticket with the id intact and the source label (E1)', async ({
		page
	}) => {
		test.setTimeout(60000);
		const seeded = await seedTransfer('A');

		await openSupplyTransfers(page, SM1);
		await transferRow(page, 'A').getByRole('link', { name: 'ดูรายละเอียด' }).click();

		await expect(page.getByRole('heading', { name: 'รายละเอียดคำร้องโอนย้าย' })).toBeVisible();
		// The `:` in `stock_transfer:{ulid}` must survive the URL: the page fetched this exact doc.
		expect(decodeURIComponent(new URL(page.url()).pathname)).toBe(
			`/back-office/supply/transfer/${seeded._id}`
		);
		await expect(page.getByTestId('transfer-banner').getByText(seeded._id)).toBeVisible();
		await expect(page.getByTestId('transfer-route')).toHaveText(/SH001\s*SH002/);
		await expect(page.getByTestId('transfer-side')).toHaveText('ต้นทาง (ศูนย์ของคุณ)');
		await expect(page.getByTestId('transfer-items').getByText(itemIdFor('A'))).toBeVisible();

		// FR-05 — read-only: none of the list's actions exist on this page.
		for (const name of [
			'อนุมัติส่งมอบ',
			'คัดค้าน/ระงับ',
			'ยกเลิก',
			'กลับมาดำเนินการต่อ',
			'ยืนยันรับเข้า',
			'เลิกทำ',
			'ลบ'
		]) {
			await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
		}
	});

	test('the destination shelter sees the destination label (E2)', async ({ page }) => {
		test.setTimeout(60000);
		const seeded = await seedTransfer('B');

		await openDetail(page, SM2, seeded._id);
		await expect(page.getByTestId('transfer-side')).toHaveText('ปลายทาง (ศูนย์ของคุณ)');
	});

	test('a requested ticket shows one step; a shipped one adds shipped and delivery info (E3)', async ({
		page
	}) => {
		test.setTimeout(60000);
		const requested = await seedTransfer('C');
		const shipped = await seedTransfer('D', {
			status: 'shipped',
			updated_at: SHIPPED_AT,
			driver_name: 'สมชาย ใจดี',
			vehicle_plate: 'กท 1234',
			timeline: {
				requested: { at: REQUESTED_AT, by: 'Seed Staff' },
				shipped: { at: SHIPPED_AT, by: 'Dispatcher' }
			}
		});

		await openDetail(page, SM1, requested._id);
		await expect(timelineSteps(page)).toHaveCount(1);
		await expect(timelineSteps(page).first()).toHaveAttribute('data-step', 'requested');
		await expect(page.getByTestId('transfer-delivery')).toHaveCount(0);

		await page.goto(`/back-office/supply/transfer/${encodeURIComponent(shipped._id)}`);
		await expect(timelineSteps(page)).toHaveCount(2);
		await expect(timelineSteps(page).nth(1)).toHaveAttribute('data-step', 'shipped');
		await expect(timelineSteps(page).nth(1)).toContainText('Dispatcher');
		const delivery = page.getByTestId('transfer-delivery');
		await expect(delivery.getByText('สมชาย ใจดี')).toBeVisible();
		await expect(delivery.getByText('กท 1234')).toBeVisible();
	});

	test('a shipped ticket from before CR-089 renders without delivery info (E4)', async ({
		page
	}) => {
		test.setTimeout(60000);
		const legacy = await seedTransfer('E', {
			schema_v: 2,
			status: 'shipped',
			timeline: {
				requested: { at: REQUESTED_AT, by: 'Seed Staff' },
				shipped: { at: SHIPPED_AT, by: 'Dispatcher' }
			}
		});

		await openDetail(page, SM2, legacy._id);
		await expect(page.getByTestId('transfer-status')).toHaveText('ระหว่างขนส่ง');
		await expect(timelineSteps(page)).toHaveCount(2);
		await expect(page.getByTestId('transfer-delivery')).toHaveCount(0);
	});

	test('lines sharing an item_id render separately, never merged (FR-03)', async ({ page }) => {
		test.setTimeout(60000);
		const itemId = itemIdFor('F');
		// Kept off SH001/SH002 on purpose: the list still keys rows by item_id (CR-118 fixes that),
		// so a duplicate-line doc there would break the list pages the parallel tests are using.
		const split = await seedTransfer('F', {
			shelter_code: 'SH003',
			from_shelter: 'SH003',
			to_shelter: 'SH004',
			items: [
				{ item_id: itemId, qty: '60', unit: 'kg' },
				{ item_id: itemId, qty: '40', unit: 'kg' }
			]
		});

		await openDetail(page, SM3, split._id);
		const rows = page.getByTestId('transfer-items').getByRole('row').filter({ hasText: itemId });
		await expect(rows).toHaveCount(2);
		await expect(rows.nth(0)).toContainText('60 kg');
		await expect(rows.nth(1)).toContainText('40 kg');
	});

	test('an unrelated shelter opening the URL sees "not found" and no ticket data (E5)', async ({
		page
	}) => {
		test.setTimeout(60000);
		const seeded = await seedTransfer('G');

		const responses: number[] = [];
		page.on('response', (res) => {
			if (res.url().includes('/api/back-office/transfer/')) responses.push(res.status());
		});

		await openDetail(page, SM3, seeded._id);
		await expect(page.getByTestId('transfer-not-found')).toHaveText(
			'ไม่พบคำร้อง หรือไม่มีสิทธิ์เข้าถึง'
		);
		await expect(page.getByTestId('transfer-banner')).toHaveCount(0);
		await expect(page.getByText(itemIdFor('G'))).toHaveCount(0);
		// D4 — the server still answers 403, and the client does not retry it.
		expect(responses).toEqual([403]);
	});

	test('a disputed-then-resumed ticket keeps its disputed step (E6)', async ({ page }) => {
		test.setTimeout(60000);
		const seeded = await seedTransfer('H');

		await openSupplyTransfers(page, SM1);
		const row = transferRow(page, 'H');
		await row.getByRole('button', { name: 'คัดค้าน/ระงับ' }).click();
		await page.locator('#transfer-reason').fill('สต็อกต้นทางไม่พอ');
		await page.getByRole('button', { name: 'ยืนยันการระงับ', exact: true }).click();
		await expect(row.getByText('ระงับไว้')).toBeVisible();

		await row.getByRole('button', { name: 'กลับมาดำเนินการต่อ' }).click();
		await expect(row.getByText('รอส่งมอบ')).toBeVisible();

		const resumed = await readTransfer(seeded._id);
		expect(resumed?.status).toBe('requested');
		const disputed = resumed?.timeline.disputed;
		expect(disputed, 'CR-089 FR-11 — dispute writes timeline.disputed').toBeTruthy();

		await row.getByRole('link', { name: 'ดูรายละเอียด' }).click();
		await expect(timelineSteps(page)).toHaveCount(2);
		await expect(timelineSteps(page).nth(0)).toHaveAttribute('data-step', 'requested');
		await expect(timelineSteps(page).nth(1)).toHaveAttribute('data-step', 'disputed');
		await expect(timelineSteps(page).nth(1)).toContainText(disputed!.by);
		// FR-07 — back in `requested`, so no reason under the status.
		await expect(page.getByTestId('transfer-status')).toHaveText('รอส่งมอบ');
		await expect(page.getByTestId('transfer-reason')).toHaveCount(0);
	});

	test('a cancelled ticket opens from the filtered list with its reason and no cancel step (E6)', async ({
		page
	}) => {
		test.setTimeout(60000);
		await seedTransfer('I', { status: 'cancelled', cancel_reason: 'สั่งซ้ำ' });

		await openSupplyTransfers(page, SM1);
		await page.getByRole('button', { name: /แสดงที่ยกเลิกแล้ว/ }).click();
		await transferRow(page, 'I').getByRole('link', { name: 'ดูรายละเอียด' }).click();

		await expect(page.getByTestId('transfer-status')).toHaveText('ยกเลิกแล้ว');
		await expect(page.getByTestId('transfer-reason')).toHaveText('สั่งซ้ำ');
		await expect(timelineSteps(page)).toHaveCount(1);
		await expect(timelineSteps(page).first()).toHaveAttribute('data-step', 'requested');
	});

	test('a system admin on an unrelated shelter gets the third side label (E7)', async ({
		page
	}) => {
		test.setTimeout(60000);
		const seeded = await seedTransfer('J');

		await injectSession(page, SA, sessions[SA.name]);
		await page.evaluate(() => localStorage.setItem('tent.activeShelterCode', 'SH003'));
		await page.goto(`/back-office/supply/transfer/${encodeURIComponent(seeded._id)}`);

		await expect(page.getByTestId('transfer-route')).toHaveText(/SH001\s*SH002/);
		await expect(page.getByTestId('transfer-side')).toHaveText('ไม่ใช่ศูนย์ของคำร้องนี้');
	});
});
