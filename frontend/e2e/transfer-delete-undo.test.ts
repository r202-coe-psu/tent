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
 * CR-090 — delete a transfer request + undo it within 5 seconds.
 *
 * The three acceptance criteria that unit tests cannot reach live here: the row leaving the
 * table, the undo putting the SAME document back, and the window actually closing on time.
 * Everything else about the feature (status/shelter guards, the rev-less restore PUT) is
 * covered by `transfer.server-repository.test.ts` and the route tests.
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

test.describe('CR-090 — delete a transfer request with a 5-second undo', () => {
	/** The row for our seeded transfer, identified by the per-run item id it lists. */
	function transferRow(page: import('@playwright/test').Page) {
		return page.getByRole('row').filter({ hasText: ITEM_ID });
	}

	function deleteButton(page: import('@playwright/test').Page) {
		return transferRow(page).getByRole('button', { name: 'ลบ', exact: true });
	}

	test('source shelter deletes a `requested` transfer and the row leaves the table', async ({
		page
	}) => {
		test.setTimeout(60000);
		const seeded = await seedTransfer('A');

		await injectSession(page, SM1, sessions[SM1.name]);
		await page.goto('/back-office/supply?tab=transfer');
		await expect(page.getByRole('heading', { name: 'รายการโอนย้ายข้ามศูนย์' })).toBeVisible();

		await expect(transferRow(page)).toBeVisible();
		await deleteButton(page).click();

		await expect(page.getByText('ลบคำร้องโอนย้ายแล้ว')).toBeVisible();
		await expect(transferRow(page)).toBeHidden();

		const after = await getTransfer(seeded._id);
		expect(after.status, 'the document is really gone, not soft-marked').toBe(404);
	});

	test('undo within the window restores the same document, envelope untouched', async ({
		page
	}) => {
		test.setTimeout(60000);
		const seeded = await seedTransfer('B');

		await injectSession(page, SM1, sessions[SM1.name]);
		await page.goto('/back-office/supply?tab=transfer');
		await expect(page.getByRole('heading', { name: 'รายการโอนย้ายข้ามศูนย์' })).toBeVisible();

		await expect(transferRow(page)).toBeVisible();
		await deleteButton(page).click();

		const undo = page.getByRole('button', { name: 'เลิกทำ' });
		await expect(undo).toBeVisible();
		await undo.click();

		await expect(page.getByText('กู้คืนคำร้องแล้ว')).toBeVisible();
		await expect(transferRow(page)).toBeVisible();

		const restored = await getTransfer(seeded._id);
		expect(restored.status).toBe(200);
		// FR-05/FR-08 — the restored document must carry its ORIGINAL history, not the time of
		// the undo. A restore that went through `createTransfer()` would fail every line here.
		expect(restored.doc?._id).toBe(seeded._id);
		expect(restored.doc?.created_at).toBe(CREATED_AT);
		expect(restored.doc?.created_by).toBe('Seed Staff');
		expect(restored.doc?.updated_at).toBe(CREATED_AT);
		expect(restored.doc?.timeline.requested).toEqual({ at: CREATED_AT, by: 'Seed Staff' });
		expect(restored.doc?.status).toBe('requested');
	});

	test('past the window the undo is gone and the transfer stays deleted', async ({ page }) => {
		test.setTimeout(60000);
		const seeded = await seedTransfer('C');

		await injectSession(page, SM1, sessions[SM1.name]);
		await page.goto('/back-office/supply?tab=transfer');
		await expect(page.getByRole('heading', { name: 'รายการโอนย้ายข้ามศูนย์' })).toBeVisible();

		await expect(transferRow(page)).toBeVisible();
		await deleteButton(page).click();

		const undo = page.getByRole('button', { name: 'เลิกทำ' });
		await expect(undo).toBeVisible();

		// FR-06 — the toast is set to the same 5s window; give it a margin and it must be gone.
		await expect(undo).toBeHidden({ timeout: 15000 });

		await expect(transferRow(page)).toBeHidden();
		const after = await getTransfer(seeded._id);
		expect(after.status, 'nothing put it back after the window closed').toBe(404);
	});

	test('the destination shelter gets no delete button', async ({ page }) => {
		test.setTimeout(60000);
		await seedTransfer('D');

		await injectSession(page, SM2, sessions[SM2.name]);
		await page.goto('/back-office/supply?tab=transfer');
		await expect(page.getByRole('heading', { name: 'รายการโอนย้ายข้ามศูนย์' })).toBeVisible();

		// FR-01 — SH002 sees the incoming request but may not delete it.
		await expect(transferRow(page)).toBeVisible();
		await expect(deleteButton(page)).toHaveCount(0);
	});
});
