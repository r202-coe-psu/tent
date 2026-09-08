import { test, expect } from '@playwright/test';
import {
	createCouchUser,
	deleteCouchUser,
	couchLogin,
	couchReq,
	SM_SH001_ROLES,
	SM_SH002_ROLES
} from './helpers/couch';
import { injectSession, clearSession } from './helpers/login';

/**
 * CR-090 — cancel a transfer request + undo the cancellation within 5 seconds.
 *
 * The acceptance criteria that unit tests cannot reach live here: the row leaving the default
 * view, the undo bringing back the SAME document with `cancel_reason` dropped, and the filter
 * that keeps cancelled rows out of the way (FR-07). Guards and reason-clearing at the domain and
 * repository level are covered by `transfer.server-repository.test.ts` and the domain tests.
 */

const RUN_ID = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);

const SM1 = {
	name: `tr_sm1_${RUN_ID}`,
	password: 'Password1!',
	roles: SM_SH001_ROLES,
	display_name: 'Source SM'
};
const SM2 = {
	name: `tr_sm2_${RUN_ID}`,
	password: 'Password1!',
	roles: SM_SH002_ROLES,
	display_name: 'Dest SM'
};

const sessions: Record<string, string> = {};

/** Unique per run so the row is findable no matter what else the shelter already has. */
const ITEM_ID = `item:rice_${RUN_ID}`;
const CREATED_AT = '2026-08-22T05:00:00.000Z';

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
	items: { item_id: string; qty: string; unit: string }[];
	status: string;
	timeline: { requested: { at: string; by: string } };
	cancel_reason?: string;
}

const seededIds: string[] = [];

/** One `requested` transfer out of SH001, already in `central_ops` the way the app writes it. */
async function seedTransfer(suffix: string): Promise<PersistedTransfer> {
	const doc: PersistedTransfer = {
		_id: `stock_transfer:01E2E${RUN_ID.toUpperCase()}${suffix}`.slice(0, 40),
		type: 'stock_transfer',
		schema_v: 3,
		shelter_code: 'SH001',
		created_at: CREATED_AT,
		updated_at: CREATED_AT,
		created_by: 'Seed Staff',
		from_shelter: 'SH001',
		to_shelter: 'SH002',
		items: [{ item_id: ITEM_ID, qty: '100', unit: 'kg' }],
		status: 'requested',
		timeline: { requested: { at: CREATED_AT, by: 'Seed Staff' } }
	};

	const res = await couchReq('PUT', `/central_ops/${encodeURIComponent(doc._id)}`, doc);
	expect(res.status, 'seeding the transfer must succeed').toBeLessThan(300);
	seededIds.push(doc._id);
	return { ...doc, _rev: (res.data as { rev: string }).rev };
}

async function getTransfer(id: string): Promise<{ status: number; doc: PersistedTransfer | null }> {
	const res = await couchReq('GET', `/central_ops/${encodeURIComponent(id)}`);
	return { status: res.status, doc: res.status === 200 ? (res.data as PersistedTransfer) : null };
}

test.beforeAll(async () => {
	await couchReq('PUT', '/central_ops');
	await couchReq('PUT', '/shelter_sh001');
	await couchReq('PUT', '/shelter_sh002');
	await couchReq('PUT', '/registry');

	await createCouchUser(SM1);
	await createCouchUser(SM2);
	sessions[SM1.name] = await couchLogin(SM1.name, SM1.password);
	sessions[SM2.name] = await couchLogin(SM2.name, SM2.password);
});

test.afterAll(async () => {
	await deleteCouchUser(SM1.name);
	await deleteCouchUser(SM2.name);

	for (const id of seededIds) {
		const { status, doc } = await getTransfer(id);
		if (status === 200 && doc?._rev) {
			await couchReq('DELETE', `/central_ops/${encodeURIComponent(id)}?rev=${doc._rev}`);
		}
	}
});

test.afterEach(async ({ page }) => {
	await clearSession(page);
});

test.describe('CR-090 — cancel a transfer request with a 5-second undo', () => {
	/** The row for our seeded transfer, identified by the per-run item id it lists. */
	function transferRow(page: import('@playwright/test').Page) {
		return page.getByRole('row').filter({ hasText: ITEM_ID });
	}

	function cancelButton(page: import('@playwright/test').Page) {
		return transferRow(page).getByRole('button', { name: 'ยกเลิก', exact: true });
	}

	/** Cancel needs a reason (CR-089 FR-03), so every cancel here goes through the dialog. */
	async function cancelWithReason(page: import('@playwright/test').Page, reason: string) {
		await cancelButton(page).click();
		await page.getByRole('textbox').fill(reason);
		await page.getByRole('button', { name: 'ยืนยันการยกเลิก', exact: true }).click();
	}

	async function openSupplyTransfers(
		page: import('@playwright/test').Page,
		user: typeof SM1 | typeof SM2
	) {
		await injectSession(page, user, sessions[user.name]);
		await page.goto('/back-office/supply?tab=transfer');
		await expect(page.getByRole('heading', { name: 'รายการโอนย้ายข้ามศูนย์' })).toBeVisible();
	}

	test('cancelling drops the row out of the default view and keeps the document', async ({
		page
	}) => {
		test.setTimeout(60000);
		const seeded = await seedTransfer('A');

		await openSupplyTransfers(page, SM1);
		await expect(transferRow(page)).toBeVisible();
		await cancelWithReason(page, 'กรอกจำนวนผิด');

		await expect(page.getByText('ยกเลิกคำร้องแล้ว')).toBeVisible();
		// FR-07 — hidden from the default view, not deleted.
		await expect(transferRow(page)).toBeHidden();

		const after = await getTransfer(seeded._id);
		expect(after.status, 'the document survives — this is a soft transition').toBe(200);
		expect(after.doc?.status).toBe('cancelled');
	});

	test('undo within the window returns the same document with the reason dropped', async ({
		page
	}) => {
		test.setTimeout(60000);
		const seeded = await seedTransfer('B');

		await openSupplyTransfers(page, SM1);
		await expect(transferRow(page)).toBeVisible();
		await cancelWithReason(page, 'กดผิดปุ่ม');

		const undo = page.getByRole('button', { name: 'เลิกทำ' });
		await expect(undo).toBeVisible();
		await undo.click();

		await expect(page.getByText('คำร้องกลับมารอส่งมอบแล้ว')).toBeVisible();
		await expect(transferRow(page)).toBeVisible();

		const restored = await getTransfer(seeded._id);
		expect(restored.status).toBe(200);
		// FR-08 — a transition, so the envelope and the original timeline are untouched.
		expect(restored.doc?._id).toBe(seeded._id);
		expect(restored.doc?.created_at).toBe(CREATED_AT);
		expect(restored.doc?.created_by).toBe('Seed Staff');
		expect(restored.doc?.timeline.requested).toEqual({ at: CREATED_AT, by: 'Seed Staff' });
		expect(restored.doc?.status).toBe('requested');
		// FR-04 — the reason belongs to `cancelled` and leaves with it.
		expect(restored.doc?.cancel_reason).toBeUndefined();
	});

	test('past the window the undo button is gone but the record is not', async ({ page }) => {
		test.setTimeout(60000);
		const seeded = await seedTransfer('C');

		await openSupplyTransfers(page, SM1);
		await expect(transferRow(page)).toBeVisible();
		await cancelWithReason(page, 'ปลายทางแจ้งว่าไม่ต้องการแล้ว');

		const undo = page.getByRole('button', { name: 'เลิกทำ' });
		await expect(undo).toBeVisible();

		// FR-05/FR-06 — the toast closes on time, but missing it costs a click, not the record.
		await expect(undo).toBeHidden({ timeout: 15000 });

		const after = await getTransfer(seeded._id);
		expect(after.status).toBe(200);
		expect(after.doc?.status).toBe('cancelled');
		expect(after.doc?.cancel_reason).toBe('ปลายทางแจ้งว่าไม่ต้องการแล้ว');
	});

	test('the cancelled row comes back through the filter (FR-07)', async ({ page }) => {
		test.setTimeout(60000);
		await seedTransfer('D');

		await openSupplyTransfers(page, SM1);
		await cancelWithReason(page, 'ซ้ำกับคำร้องอื่น');
		await expect(transferRow(page)).toBeHidden();

		await page.getByRole('button', { name: /แสดงที่ยกเลิกแล้ว/ }).click();
		await expect(transferRow(page)).toBeVisible();
		await expect(transferRow(page).getByText('ยกเลิกแล้ว')).toBeVisible();
		// FR-10 — the filter is the only way to reach these rows, so the reason has to be on them.
		await expect(transferRow(page).getByText('ซ้ำกับคำร้องอื่น')).toBeVisible();
	});

	test('the destination shelter gets no cancel button', async ({ page }) => {
		test.setTimeout(60000);
		await seedTransfer('E');

		await openSupplyTransfers(page, SM2);
		// CR-089 FR-03 / CR-090 FR-02 — cancel and its undo are both source-only.
		await expect(transferRow(page)).toBeVisible();
		await expect(cancelButton(page)).toHaveCount(0);
	});
});
