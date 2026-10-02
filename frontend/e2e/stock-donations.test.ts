import { test, expect } from '@playwright/test';
import {
	createCouchUser,
	deleteCouchUser,
	couchLogin,
	couchReq,
	STAFF_SH001_ROLES
} from './helpers/couch';
import { injectSession, clearSession } from './helpers/login';

/**
 * Back-office donation campaigns.
 *
 * The unit a campaign announces is NOT a field staff fill in: `qty_target` is compared
 * against `stock_ledger.qty`, which schema.md §2.1 pins to `item_master.base_unit`.
 * Letting a campaign name its own unit is what put a 500 "ถุง" target against a 540 kg
 * shelf and closed intake before a single donation arrived, and what made the public
 * board and this page disagree about the same number.
 *
 * `ปลากระป๋อง` is deliberate: it exists only as `item_master:canned-fish` with no
 * legacy `supply_item` twin, so it exercises the `base_unit` path where the resolver
 * used to come back empty ("หน่วยของ ปลากระป๋อง ต้องเป็น  ตาม Item Master").
 */
const RUN_ID = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);

const WS = {
	name: `donation_ws_${RUN_ID}`,
	password: 'Password1!',
	// Flat form, matching how `pnpm seed` provisions staff today. The compound form
	// (`SH001:warehouse_staff`) that role-permission-matrix.md §1.2 calls correct gets
	// past the route guard but NOT past `catalog._security`, whose members list holds
	// the bare capability only — the item picker then comes back empty. Left flat so
	// this test exercises the campaign form rather than that provisioning gap.
	roles: ['shelter:SH001', 'warehouse_staff'],
	display_name: 'Donation Warehouse Staff'
};
const REG = {
	name: `donation_reg_${RUN_ID}`,
	password: 'Password1!',
	roles: STAFF_SH001_ROLES,
	display_name: 'Donation Registration Staff'
};

const sessions: Record<string, string> = {};

/**
 * A freshly minted user has no `security_question`, and the post-login gate sends
 * anyone in that state to `/force-setup` before any back-office route renders. Seed
 * one so these tests exercise the donation page and not the onboarding wizard.
 */
async function seedSecurityQuestion(name: string): Promise<void> {
	const path = `/_users/org.couchdb.user:${encodeURIComponent(name)}`;
	const got = await couchReq('GET', path);
	const doc = got.data as Record<string, unknown>;
	const res = await couchReq('PUT', path, {
		...doc,
		security_question: {
			question_id: 'high_school',
			answer_hash: 'e2e'.padEnd(64, '0'),
			salt: 'e2e'.padEnd(32, '0'),
			set_at: new Date().toISOString()
		},
		must_change_password: false
	});
	if (res.status >= 400) {
		throw new Error(`Could not seed security question for "${name}" (HTTP ${res.status})`);
	}
}

test.beforeAll(async () => {
	await createCouchUser(WS);
	await createCouchUser(REG);
	await seedSecurityQuestion(WS.name);
	await seedSecurityQuestion(REG.name);
	sessions[WS.name] = await couchLogin(WS.name, WS.password);
	sessions[REG.name] = await couchLogin(REG.name, REG.password);
});

test.afterAll(async () => {
	await deleteCouchUser(WS.name);
	await deleteCouchUser(REG.name);
});

test.afterEach(async ({ page }) => {
	await clearSession(page);
});

test.describe('Stock donations — access', () => {
	test('warehouse staff can open the page', async ({ page }) => {
		await injectSession(page, WS, sessions[WS.name]);
		await page.goto('/back-office/stock-donations');
		await expect(page.getByRole('tab', { name: /จัดการความต้องการ/ })).toBeVisible({
			timeout: 10_000
		});
	});

	test('registration staff is turned away', async ({ page }) => {
		await injectSession(page, REG, sessions[REG.name]);
		await page.goto('/back-office/stock-donations');
		// requireWarehouseAccess redirects to the landing route rather than rendering.
		await expect(page).not.toHaveURL(/back-office\/stock-donations/, { timeout: 10_000 });
	});
});

test.describe("Create campaign — the unit is the catalog's", () => {
	test.beforeEach(async ({ page }) => {
		await injectSession(page, WS, sessions[WS.name]);
		await page.goto('/back-office/stock-donations');
		await page.getByRole('tab', { name: /จัดการความต้องการ/ }).click();
		await page.getByRole('button', { name: /สร้างประกาศแบบกำหนดเอง/ }).click({ timeout: 10_000 });
	});

	test('resolves base_unit into its Thai label and offers no way to override it', async ({
		page
	}) => {
		const unitBox = page.getByText('เลือกรายการพัสดุก่อน');
		await expect(unitBox).toBeVisible();

		// Pick the item from the catalog — the campaign binds to the id, never to the
		// typed text (a title substring used to bind "มาม่าน้ำข้น" to `item:water`).
		const picker = page.locator('#campaign-item-title');
		await picker.fill('ปลากระป๋อง');
		await picker.press('Enter');

		// `base_unit` is the canonical code `can`; the screen shows the UOM master's
		// Thai label for it (CR-125), never the raw code.
		await expect(page.getByText('กระป๋อง', { exact: true }).first()).toBeVisible();
		await expect(page.getByText('เลือกรายการพัสดุก่อน')).toHaveCount(0);

		// No editable unit control exists — the box is display-only.
		await expect(page.getByRole('textbox', { name: /หน่วยนับ/ })).toHaveCount(0);
		await expect(page.getByRole('combobox', { name: /หน่วยนับ/ })).toHaveCount(0);
	});
});
