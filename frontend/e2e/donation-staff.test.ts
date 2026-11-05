import { test, expect } from '@playwright/test';
import { CAN_WRITE, READ_ONLY_REASON } from './helpers/e2e-env';
import { COUCH_BASE } from './helpers/couch';
import { clearSession } from './helpers/login';
import {
	RUN_ID,
	RunLedger,
	bookAsDonor,
	createCampaignViaUi,
	createDonationStaff,
	createWarehouseStaff,
	expectReadyForDropoff,
	expectRunGone,
	findDonation,
	ledgerRowsFor,
	openBackOffice,
	openInScanStation,
	provisionShelter,
	shelterDb,
	suspendRecaptcha,
	teardownRun,
	type PublicNeed,
	type PublicShelter,
	type Staff
} from './helpers/donation-fullstack';

/**
 * `donation_staff` (CR-227, #1121) against the REAL stack, on this run's own `E2E Donation don …`
 * shelter (README §4): it does the whole donation job but cannot touch stock by hand.
 *
 *   1. receives a booking at the scan station → `stock_ledger` reason `donation` exists;
 *   2. opens the supply page read-only — no receive / adjust / count / issue / transfer controls;
 *   3. the shelter DB's validate_doc_update lets it write a `donation` ledger row and refuses an
 *      `adjust` row (the server says no, not just the missing button).
 *
 * Needs `docker compose up -d` and a seeded catalog (`pnpm seed`); locally use the dev server:
 *   PLAYWRIGHT_TEST_BASE_URL=http://localhost:5173 pnpm exec playwright test e2e/donation-staff.test.ts
 * Setup mirrors donation-fullstack.test.ts (own shelter via system-management, a warehouse staff
 * who posts the campaign, the donation_staff user via CouchDB admin). Teardown removes exactly the
 * ids in the per-run ledger; the last test (Z) asserts nothing is left.
 */

// No `shelf_life_days`, so the scan station receives it without an expiry.
const NEED_ITEM = 'แปรงสีฟัน';
const ADJUST_ID = 'stock_ledger:01J8Z9K5N7QXR3T6V8W0Y2A4B6';
const DONATION_ID = 'stock_ledger:01J8Z9K5N7QXR3T6V8W0Y2A4B7';

const ledger = new RunLedger('donation-staff');

let shelter: PublicShelter;
let need: PublicNeed;
let don: Staff;
let restoreRecaptcha: (() => Promise<void>) | undefined;

test.afterEach(async ({ page }) => {
	await clearSession(page);
});

/** A write to the shelter DB with `don`'s own session, so its validate_doc_update decides. */
async function writeAsDonationStaff(doc: Record<string, unknown>) {
	const res = await fetch(
		`${COUCH_BASE}/${shelterDb(shelter.code)}/${encodeURIComponent(String(doc._id))}`,
		{
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json',
				Cookie: `AuthSession=${don.session}`
			},
			body: JSON.stringify(doc)
		}
	);
	return { status: res.status, body: (await res.json().catch(() => null)) as { reason?: string } };
}

const ledgerDoc = (id: string, over: Record<string, unknown>) => {
	const now = new Date().toISOString();
	return {
		_id: id,
		type: 'stock_ledger',
		schema_v: 6,
		shelter_code: shelter.code,
		item_id: need.item_id,
		qty: '1',
		unit: 'piece',
		created_at: now,
		updated_at: now,
		created_by: don.name,
		...over
	};
};

test.describe(
	'Donation staff: donation work yes, stock changes no',
	{ tag: ['@critical', '@donation'] },
	() => {
		test.describe.configure({ mode: 'serial', timeout: 240_000 });

		test.beforeAll(async ({ request, browser }) => {
			test.skip(!CAN_WRITE, READ_ONLY_REASON);
			test.setTimeout(360_000);
			restoreRecaptcha = await suspendRecaptcha(browser);
			const created = await provisionShelter(browser, ledger, 'don');
			const ws = await createWarehouseStaff(ledger, created.code, 'ws');
			don = await createDonationStaff(ledger, created.code, 'don');

			const context = await browser.newContext();
			try {
				need = await createCampaignViaUi(await context.newPage(), request, ws, created.code, {
					item: NEED_ITEM,
					target: 20,
					notes: `e2e donation staff ${RUN_ID}`
				});
			} finally {
				await context.close();
			}
			shelter = { ...created, needs: [need] };
		});

		test.afterAll(async ({ request }) => {
			if (!CAN_WRITE) return;
			test.setTimeout(240_000);
			await restoreRecaptcha?.();
			await teardownRun(request, ledger);
		});

		test('receives a booking at the scan station → a donation stock_ledger row exists', async ({
			page
		}) => {
			const { bookingRef } = await bookAsDonor(page, {
				shelter,
				need,
				ledger,
				donorName: `E2E เจ้าหน้าที่รับบริจาค ${RUN_ID}`,
				phone: '0867770021'
			});
			await expectReadyForDropoff(shelter.code, bookingRef);

			await openBackOffice(page, don);
			await openInScanStation(page, bookingRef);
			await page.getByRole('button', { name: /^ผ่านการตรวจสอบแล้ว/ }).click();
			const confirm = page.getByRole('button', { name: 'ยืนยันรับเข้าคลัง' });
			await expect(confirm).toBeEnabled();
			const received = page.waitForResponse(
				(r) =>
					r.url().endsWith(`/api/back-office/donations/${bookingRef}`) &&
					r.request().method() === 'POST'
			);
			await confirm.click();
			expect((await received).ok()).toBe(true);

			const donation = await findDonation(shelter.code, bookingRef);
			expect(donation.status).toBe('received');
			expect(await ledgerRowsFor(shelter.code, donation._id as string)).toEqual([
				expect.objectContaining({ item_id: need.item_id, qty: '1' })
			]);
		});

		test('sees the supply page read-only: no receive, adjust, count, issue or transfer control', async ({
			page
		}) => {
			await openBackOffice(page, don);
			await page.goto('/back-office/supply');
			await expect(page.getByRole('heading', { name: 'คลังของศูนย์' })).toBeVisible();
			// The stock list shows what the receipt put on the shelf — so the checks below are not vacuous.
			await expect(page.getByText(NEED_ITEM).first()).toBeVisible({ timeout: 15_000 });

			await expect(
				page.getByRole('button', { name: /^(รับเข้า|เบิก|ปรับยอด|ตรวจนับ)/ })
			).toHaveCount(0);
			await expect(page.getByRole('button', { name: /โอนย้าย/ })).toHaveCount(0);

			// The distribution and ticket pages stay closed to the role.
			await page.goto('/back-office/distribution');
			await expect(page).not.toHaveURL(/back-office\/distribution/, { timeout: 10_000 });
		});

		test('the shelter database takes a donation ledger row from it and refuses an adjust', async () => {
			const refused = await writeAsDonationStaff(
				ledgerDoc(ADJUST_ID, { qty: '-1', reason: 'adjust', adjust_reason: 'count_mismatch' })
			);
			expect(refused.status).toBe(403);
			expect(refused.body.reason).toMatch(
				/Only warehouse staff or managers can write stock ledger/
			);

			const accepted = await writeAsDonationStaff(ledgerDoc(DONATION_ID, { reason: 'donation' }));
			expect(accepted.status).toBe(201);
		});

		test('Z teardown leaves nothing of this run behind', async ({ request }) => {
			test.setTimeout(240_000);
			const run = await teardownRun(request, ledger);
			expect(run.shelters).toContain(shelter.code);
			await expectRunGone(request, run);
		});
	}
);
