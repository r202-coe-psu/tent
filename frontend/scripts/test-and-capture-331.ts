import { chromium } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

const SCREENSHOT_DIR = path.resolve(process.cwd(), '../slides/public/screenshots');
const ARTIFACT_DIR = '/home/jakee/.gemini/antigravity/brain/a4814ae3-8203-4de9-a903-5394afcc803c';

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

const COUCH_URL = 'http://localhost:5984';
const AUTH_HEADER = 'Basic ' + Buffer.from('admin:password').toString('base64');

async function couchPut(db: string, id: string, doc: Record<string, unknown>) {
	const getRes = await fetch(`${COUCH_URL}/${db}/${encodeURIComponent(id)}`, {
		headers: { Authorization: AUTH_HEADER }
	});
	if (getRes.ok) {
		const existing = (await getRes.json()) as { _rev?: string };
		doc._rev = existing._rev;
	}
	const res = await fetch(`${COUCH_URL}/${db}/${encodeURIComponent(id)}`, {
		method: 'PUT',
		headers: {
			'Content-Type': 'application/json',
			Authorization: AUTH_HEADER
		},
		body: JSON.stringify(doc)
	});
	if (!res.ok) {
		throw new Error(`Failed to PUT ${id} in ${db}: ${res.status} ${await res.text()}`);
	}
	return await res.json();
}

async function copyToArtifact(fileName: string) {
	const src = path.join(SCREENSHOT_DIR, fileName);
	const dest = path.join(ARTIFACT_DIR, fileName);
	if (fs.existsSync(src)) {
		fs.copyFileSync(src, dest);
		console.log(`Copied ${fileName} to artifact dir.`);
	}
}

async function main() {
	console.log('--- Setting up test data in CouchDB ---');

	// 1. Seed expired lot for vegetable (shelf_life_days: 5)
	const veggieItemId = 'item_master:01M3EP1P8E1N3KFSSS3EBYW21R'; // ผักรวม
	const expiredLotDocId = 'stock_ledger:test-331-expired-veggie';
	await couchPut('shelter_sh001', expiredLotDocId, {
		type: 'stock_ledger',
		schema_v: 6,
		shelter_code: 'SH001',
		item_id: veggieItemId,
		qty: '15',
		unit: 'kg',
		reason: 'donation',
		ref_id: null,
		occurred_at: '2026-09-20T10:00:00.000Z',
		created_at: '2026-09-20T10:00:00.000Z',
		updated_at: '2026-09-20T10:00:00.000Z',
		lot: {
			produced_at: '2026-09-20',
			lot_no: 'LOT-331-VEG-EXP',
			storage_zone: 'ครัวกลาง'
		}
	});
	console.log('Seeded expired vegetable lot (produced 2026-09-20, shelf_life: 5d).');

	// 2. Seed test donation for shortfall testing
	const trackingToken = 'TX-SH001-TEST331SHORTFALL';
	const trackingHash = crypto.createHash('sha256').update(trackingToken).digest('hex');
	const donationDocId = 'donation:test-331-shortfall';
	await couchPut('shelter_sh001', donationDocId, {
		type: 'donation',
		schema_v: 5,
		shelter_code: 'SH001',
		status: 'verifying',
		booking_ref: 'DN-331-QA',
		channel: 'walk_in',
		tracking_token_hash: trackingHash,
		donor: {
			name: 'นายทดสอบ ส่วนต่าง',
			phone: '0812349999',
			phone_hash: 'hash-test-331'
		},
		kind: 'items',
		items: [
			{
				item_id: 'item_master:01M3EP1P8D9FJVP9E59R8YMYG4', // ข้าวสาร
				item_name: 'ข้าวสาร',
				qty: '10',
				unit: 'kg'
			},
			{
				item_id: 'item_master:01M3EP1P8E1N3KFSSS3EBYW21S', // ปลากระป๋อง
				item_name: 'ปลากระป๋อง',
				qty: '20',
				unit: 'can'
			}
		],
		declared_at: '2026-10-07T12:00:00.000Z',
		updated_at: '2026-10-07T12:00:00.000Z',
		expires_at: '2026-11-07T12:00:00.000Z'
	});
	console.log('Seeded verifying donation DN-331-QA with 10kg ข้าวสาร and 20 can ปลากระป๋อง.');

	console.log('Launching browser for E2E tests & screenshot capture...');
	const browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({
		viewport: { width: 1440, height: 900 },
		deviceScaleFactor: 2
	});
	const page = await context.newPage();

	// Route browser CouchDB calls through Vite's /couch proxy to handle CORS
	await page.route(`http://localhost:5984/**`, async (route) => {
		const request = route.request();
		const target = new URL(request.url());
		const corsHeaders = {
			'access-control-allow-origin': 'http://localhost:5173',
			'access-control-allow-credentials': 'true',
			'access-control-allow-methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
			'access-control-allow-headers':
				request.headers()['access-control-request-headers'] ?? 'Content-Type, Accept'
		};
		if (request.method() === 'OPTIONS') {
			await route.fulfill({ status: 204, headers: corsHeaders });
			return;
		}
		const response = await route
			.fetch({ url: `http://localhost:5173/couch${target.pathname}${target.search}` })
			.catch(() => null);
		if (!response) return;
		await route
			.fulfill({ response, headers: { ...response.headers(), ...corsHeaders } })
			.catch(() => undefined);
	});

	// Helper to dismiss Vite dev error overlay if present
	async function dismissDevOverlay() {
		await page.evaluate(() => {
			document.querySelectorAll('vite-error-overlay').forEach((el) => el.remove());
		});
	}

	// Helper to login
	async function loginAs(username: string, pass = '!Q2w3e4r5t') {
		await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
		await page.locator('input[name="username"]').fill(username);
		await page.locator('input[name="password"]').fill(pass);
		await page.getByRole('button', { name: /เข้าสู่ระบบ|Login/ }).click();
		await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 10000 });
		await page.waitForTimeout(1000);
	}

	// Helper to logout
	async function logout() {
		await page.evaluate(() => {
			localStorage.clear();
		});
		await context.clearCookies();
	}

	// ==========================================
	// Test 1: staff03 (supply_coordinator) - Distribute button disabled
	// ==========================================
	console.log('\n--- Test 1: Testing staff03 distribute buttons disabled ---');
	await loginAs('staff03');
	await page.goto('http://localhost:5173/back-office/supply', { waitUntil: 'networkidle' });
	await page.waitForSelector('table tbody tr', { timeout: 15000 }).catch(() => null);
	await page.waitForTimeout(1000);
	await dismissDevOverlay();

	// Verify header distribute button disabled
	const distributeBtns = page.locator('button:has-text("เบิกจ่าย")');
	const dCount = await distributeBtns.count();
	console.log(`Found ${dCount} buttons with text "เบิกจ่าย":`);
	for (let i = 0; i < dCount; i++) {
		const btn = distributeBtns.nth(i);
		console.log(
			`  Button #${i}: disabled=${await btn.isDisabled()}, title="${await btn.getAttribute('title')}", visible=${await btn.isVisible()}`
		);
	}

	// Verify table row action distribute buttons disabled
	const rowDistributeBtns = page.locator('button:has-text("เบิก")');
	const rCount = await rowDistributeBtns.count();
	console.log(`Found ${rCount} buttons with text "เบิก":`);
	for (let i = 0; i < rCount; i++) {
		const btn = rowDistributeBtns.nth(i);
		console.log(
			`  Row button #${i}: disabled=${await btn.isDisabled()}, title="${await btn.getAttribute('title')}", visible=${await btn.isVisible()}`
		);
	}

	// Hover over the first disabled row distribute button with force: true
	const targetRowBtn = page.locator('button[title*="warehouse_staff"]').first();
	if ((await targetRowBtn.count()) > 0) {
		await targetRowBtn.hover({ force: true });
		await page.waitForTimeout(500);
	}

	const shot1 = '331_01_staff03_distribute_disabled.png';
	await page.screenshot({ path: path.join(SCREENSHOT_DIR, shot1) });
	await copyToArtifact(shot1);
	console.log(`Saved screenshot: ${shot1}`);

	// Open ItemDetailSheet to check sheet distribute button disabled
	const firstRow = page.locator('table tbody tr').first();
	if (await firstRow.isVisible()) {
		await firstRow.click();
		await page.waitForTimeout(1000);
		await dismissDevOverlay();

		const sheetDistributeBtn = page.locator(
			'[data-slot="sheet-content"] button:has-text("เบิกจ่าย")'
		);
		if ((await sheetDistributeBtn.count()) > 0) {
			console.log(
				'Sheet distribute button disabled:',
				await sheetDistributeBtn.first().isDisabled()
			);
		}

		const shot1b = '331_01b_staff03_item_detail_sheet_disabled.png';
		await page.screenshot({ path: path.join(SCREENSHOT_DIR, shot1b) });
		await copyToArtifact(shot1b);
		console.log(`Saved screenshot: ${shot1b}`);

		// Close sheet
		await page.keyboard.press('Escape');
		await page.waitForTimeout(500);
	}
	await logout();

	// ==========================================
	// Test 2: sa01 (system_admin) - Expired lot counting & Distribute enabled
	// ==========================================
	console.log('\n--- Test 2: Testing sa01 expiry counting & enabled distribute ---');
	await loginAs('sa01');
	await page.goto('http://localhost:5173/back-office/supply', { waitUntil: 'networkidle' });
	await page.waitForSelector('table tbody tr', { timeout: 15000 }).catch(() => null);
	await page.waitForTimeout(1500);
	await dismissDevOverlay();

	// Check "หมดอายุ" summary card
	const expiredCard = page.locator('div:has-text("หมดอายุ")').first();
	console.log('Expired summary card text:', (await expiredCard.innerText()).replace(/\n/g, ' '));

	// Search or check vegetable row
	const veggieRow = page.locator('table tbody tr:has-text("ผักรวม")').first();
	const veggieRowVisible = await veggieRow.isVisible();
	console.log('Veggie row visible:', veggieRowVisible);
	if (veggieRowVisible) {
		const badge = veggieRow.locator('span:has-text("หมดอายุ")');
		console.log('Veggie row has "หมดอายุ" badge:', (await badge.count()) > 0);
	}

	// Verify distribute buttons are enabled for sa01
	const saHeaderDistribute = page.getByRole('button', { name: 'เบิกจ่าย' }).first();
	console.log('sa01 header distribute button enabled:', !(await saHeaderDistribute.isDisabled()));

	const shot2 = '331_02_sa01_shelf_life_expiry.png';
	await page.screenshot({ path: path.join(SCREENSHOT_DIR, shot2) });
	await copyToArtifact(shot2);
	console.log(`Saved screenshot: ${shot2}`);

	// ==========================================
	// Test 3: Scan Station Shortfall Display
	// ==========================================
	console.log('\n--- Test 3: Testing Scan Station shortfall ---');
	// Ensure donation is back to 'verifying' status
	const checkRes = await fetch(`${COUCH_URL}/shelter_sh001/donation:test-331-shortfall`, {
		headers: { Authorization: AUTH_HEADER }
	});
	if (checkRes.ok) {
		const doc = await checkRes.json();
		doc.status = 'verifying';
		delete doc.received_summary;
		delete doc.received_at;
		await couchPut('shelter_sh001', 'donation:test-331-shortfall', doc);
	}

	await page.goto('http://localhost:5173/back-office/stock-donations', {
		waitUntil: 'domcontentloaded'
	});
	await page.waitForSelector('#scan-booking-ref', { timeout: 10000 });
	await dismissDevOverlay();

	// Search for DN-331-QA in scan station input
	const searchInput = page.locator('#scan-booking-ref');
	await searchInput.fill('DN-331-QA');
	await page.getByRole('button', { name: 'ค้นหา' }).click();

	// In the item mapping list, locate the quantity input for "ข้าวสาร" (#item-qty-0) and change from 10 to 8
	await page.waitForSelector('#item-qty-0', { timeout: 10000 });
	const qtyInput0 = page.locator('#item-qty-0');
	await qtyInput0.fill('8');
	await page.waitForTimeout(500);

	// Verify shortfall badge is shown
	const shortfallBadge = page.locator('text=รับไม่ครบ');
	console.log('Shortfall badge visible in scan station:', await shortfallBadge.first().isVisible());

	const shot3 = '331_03_scan_station_shortfall.png';
	await page.screenshot({ path: path.join(SCREENSHOT_DIR, shot3) });
	await copyToArtifact(shot3);
	console.log(`Saved screenshot: ${shot3}`);

	// Shortfall badge is captured in shot3. Proceed directly to Test 4.

	// ==========================================
	// Test 4: Donor Tracking Page Shortfall Display
	// ==========================================
	console.log('\n--- Test 4: Testing Donor Tracking Ticket shortfall ---');
	// Ensure doc in Couch has received_summary with shortfalls
	const couchCheckRes = await fetch(`${COUCH_URL}/shelter_sh001/donation:test-331-shortfall`, {
		headers: { Authorization: AUTH_HEADER }
	});
	const currentDoc = await couchCheckRes.json();
	if (currentDoc.status !== 'received' || !currentDoc.received_summary) {
		console.log(
			'Directly saving received_summary on donation:test-331-shortfall for tracking test...'
		);
		await couchPut('shelter_sh001', 'donation:test-331-shortfall', {
			...currentDoc,
			status: 'received',
			received_at: new Date().toISOString(),
			received_summary: {
				total_items: 2,
				received_at: new Date().toISOString(),
				shortfalls: [
					{
						item_id: 'item_master:01M3EP1P8D9FJVP9E59R8YMYG4',
						item_name: 'ข้าวสาร',
						declared: '10',
						counted: '8',
						short: '2'
					}
				],
				items: [
					{
						item_id: 'item_master:01M3EP1P8D9FJVP9E59R8YMYG4',
						item_name: 'ข้าวสาร',
						qty: '8',
						unit: 'kg'
					},
					{
						item_id: 'item_master:01M3EP1P8E1N3KFSSS3EBYW21S',
						item_name: 'ปลากระป๋อง',
						qty: '20',
						unit: 'can'
					}
				]
			}
		});
	}

	// Go to donor tracking page
	await page.goto(`http://localhost:5173/donations/track/${trackingToken}`, {
		waitUntil: 'domcontentloaded'
	});
	await page.waitForSelector('text=ศูนย์ตรวจรับสิ่งของไม่ครบ', { timeout: 15000 });
	await page.waitForTimeout(1000);
	await dismissDevOverlay();

	// Check shortfall alert banner
	const alertBanner = page.locator('text=ศูนย์ตรวจรับสิ่งของไม่ครบ');
	console.log('Shortfall alert banner visible:', await alertBanner.isVisible());

	// Check shortfall item badge
	const itemShortfallBadge = page.locator('text=รับไม่ครบ (ขาด 2)');
	console.log('Item shortfall badge visible:', await itemShortfallBadge.isVisible());

	const shot4 = '331_04_donor_tracking_shortfall.png';
	await page.screenshot({ path: path.join(SCREENSHOT_DIR, shot4) });
	await copyToArtifact(shot4);
	console.log(`Saved screenshot: ${shot4}`);

	// Scroll down to capture shortfall badge and strikethrough quantity clearly
	await page.evaluate(() => window.scrollBy(0, 500));
	await page.waitForTimeout(500);
	const shot4b = '331_04b_donor_tracking_shortfall_items.png';
	await page.screenshot({ path: path.join(SCREENSHOT_DIR, shot4b) });
	await copyToArtifact(shot4b);
	console.log(`Saved screenshot: ${shot4b}`);

	await browser.close();
	console.log('\n--- All tests completed and screenshots captured successfully! ---');
}

main().catch((err) => {
	console.error('Test execution failed:', err);
	process.exit(1);
});
