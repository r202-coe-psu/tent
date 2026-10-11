/**
 * Station 1 / 2 / 3 + scan helpers for the live onsite `@release` suite.
 * Locators mirror `registration-evacuee.test.ts` (UI-driven, no DB seeds).
 */
import { createRequire } from 'node:module';
import { expect, type Browser, type Locator, type Page } from '@playwright/test';
import QRCode from 'qrcode';
import { type TestUser } from './couch';
import { injectSession, routeBrowserCouchThroughApp } from './login';
import { pinActiveShelter } from './staff-ui';

const nodeRequire = createRequire(import.meta.url);

export const INTAKE_SEARCH_LABEL = 'เลขบัตรประชาชน / หนังสือเดินทาง / ชื่อ-นามสกุล / เบอร์โทร';

export const STAY_STATUS = {
	arriving: 'รอเข้าพัก',
	active: 'เข้าพักแล้ว',
	roomConfirmed: 'ยืนยันถึงโซนแล้ว',
	checkedOut: 'เช็คเอาต์'
} as const;

export interface OnsitePerson {
	firstName: string;
	lastName: string;
	gender: 'male' | 'female';
	nationalId: string;
	phone?: string;
	age?: string;
}

export const fullName = (p: Pick<OnsitePerson, 'firstName' | 'lastName'>) =>
	`${p.firstName} ${p.lastName}`;

/** Open a fresh context signed in as `user`, pinned to `shelterCode`. */
export async function openAsShelterStaff(
	browser: Browser,
	user: Pick<TestUser, 'name' | 'roles'>,
	authSession: string,
	shelterCode: string
): Promise<Page> {
	const context = await browser.newContext();
	const page = await context.newPage();
	await routeBrowserCouchThroughApp(page);
	await injectSession(page, user, authSession);
	await pinActiveShelter(page, shelterCode);
	return page;
}

export async function openStation1(page: Page): Promise<Locator> {
	await page.goto('/onsite/people');
	await expect(page.getByRole('heading', { name: 'ทะเบียนผู้ประสบภัย' })).toBeVisible({
		timeout: 20_000
	});
	return page.getByLabel(INTAKE_SEARCH_LABEL);
}

export async function searchStation1(page: Page, query: string): Promise<void> {
	await (await openStation1(page)).fill(query);
}

export async function fillMemberCard(page: Page, index: number, m: OnsitePerson): Promise<void> {
	const card = page.locator(`#unified-member-${index}`);
	await expect(card).toBeVisible();
	await card.locator(`#member-${index}-card-number`).fill(m.nationalId);
	await card.locator(`#member-${index}-first-name`).fill(m.firstName);
	await card.locator(`#member-${index}-last-name`).fill(m.lastName);
	await card.locator(`#member-${index}-gender-${m.gender}`).click({ force: true });
	if (m.age) await card.locator(`#member-${index}-age`).fill(m.age);
	const noPhone = card.locator(`#member-${index}-no-phone`);
	const noPhoneTicked = async () =>
		(await noPhone.count()) > 0 && (await noPhone.getAttribute('aria-checked')) === 'true';
	if (m.phone) {
		if (await noPhoneTicked()) await noPhone.click();
		await card.locator(`#member-${index}-phone`).fill(m.phone);
	} else if ((await noPhone.count()) > 0 && !(await noPhoneTicked())) {
		// The phone field opens ready to type; a member without one must tick "no phone".
		await noPhone.click();
	}
}

const ADDRESS_PICKS = [
	['province', 'สงขลา'],
	['district', 'หาดใหญ่'],
	['subdistrict', 'คอหงส์']
] as const;

export async function fillWalkInAddress(
	page: Page,
	addressNo: string,
	villageNo?: string
): Promise<void> {
	await page.locator('#address-no').fill(addressNo);
	if (villageNo) await page.locator('#village-no').fill(villageNo);
	for (const [id, option] of ADDRESS_PICKS) {
		await page.locator(`#${id}`).click();
		await page.getByRole('button', { name: option, exact: true }).click();
	}
}

/** Quiet zone the Person QR is rendered with (`evacuee-qr-modal.svelte`, `margin: 1`). */
const PERSON_QR_MARGIN = 1;

/**
 * Read a Person QR `<img>` (evacuee id payload). Decodes with the app's html5-qrcode first; its
 * ZXing build cannot be given PURE_BARCODE/TRY_HARDER and misses ~8% of these synthetic
 * images outright (random ULIDs — measured 34/400), so a miss falls back to an exact check: the
 * enclosing card's `qr-identity-card-<ulid>` id names the candidate, and the image must match
 * the `qrcode` matrix for `evacuee:<ulid>` module for module.
 */
export async function decodeQrImage(page: Page, img: Locator): Promise<string> {
	const src = await img.getAttribute('src');
	if (!src?.startsWith('data:image')) throw new Error('QR <img> has no data-URL source');
	if (!(await page.evaluate(() => 'Html5Qrcode' in window))) {
		await page.addScriptTag({ path: nodeRequire.resolve('html5-qrcode/html5-qrcode.min.js') });
	}
	const decoded = await page.evaluate(async (dataUrl) => {
		type QrScanner = { scanFile(file: File, showImage: boolean): Promise<string> };
		const { Html5Qrcode } = window as unknown as { Html5Qrcode: new (id: string) => QrScanner };
		const source = await (await fetch(dataUrl)).blob();
		// a rescaled copy rescues most images the decoder misses at their native size
		for (const scale of [1, 0.5, 0.75]) {
			let blob = source;
			if (scale !== 1) {
				const bitmap = await createImageBitmap(source);
				const canvas = document.createElement('canvas');
				canvas.width = Math.round(bitmap.width * scale);
				canvas.height = Math.round(bitmap.height * scale);
				canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
				blob = await new Promise<Blob>((resolve, reject) =>
					canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
				);
			}
			const holder = document.createElement('div');
			holder.id = 'e2e-qr-decode';
			holder.style.display = 'none';
			document.body.appendChild(holder);
			try {
				return await new Html5Qrcode(holder.id).scanFile(new File([blob], 'qr.png'), false);
			} catch {
				// try the next scale
			} finally {
				holder.remove();
			}
		}
		return null;
	}, src);
	if (decoded) return decoded;

	const cardId = await img
		.locator('xpath=ancestor::*[starts-with(@id, "qr-identity-card-")][1]')
		.getAttribute('id');
	if (!cardId) throw new Error('QR could not be decoded and has no qr-identity-card ancestor');
	const candidate = `evacuee:${cardId.slice('qr-identity-card-'.length)}`;
	const { modules } = QRCode.create(candidate);
	const span = modules.size + PERSON_QR_MARGIN * 2;
	const dark = await page.evaluate(
		async ({ dataUrl, span, margin, size }) => {
			const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
			const canvas = document.createElement('canvas');
			canvas.width = bitmap.width;
			canvas.height = bitmap.height;
			const ctx = canvas.getContext('2d')!;
			ctx.drawImage(bitmap, 0, 0);
			const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
			const step = bitmap.width / span;
			const cells: boolean[] = [];
			for (let row = 0; row < size; row++) {
				for (let col = 0; col < size; col++) {
					const x = Math.floor((col + margin + 0.5) * step);
					const y = Math.floor((row + margin + 0.5) * step);
					const i = (y * bitmap.width + x) * 4;
					cells.push((data[i] + data[i + 1] + data[i + 2]) / 3 < 128);
				}
			}
			return cells;
		},
		{ dataUrl: src, span, margin: PERSON_QR_MARGIN, size: modules.size }
	);
	const expected = Array.from(modules.data, (bit) => bit === 1);
	if (dark.length !== expected.length || dark.some((d, i) => d !== expected[i])) {
		throw new Error(`QR could not be decoded and does not encode ${candidate}`);
	}
	return candidate;
}

/** On the print screen, read each member's evacuee id from their Person QR. */
export async function idsFromPrintScreen(
	page: Page,
	people: OnsitePerson[]
): Promise<Record<string, string>> {
	await expect(page.getByRole('heading', { name: 'ลงทะเบียนสำเร็จ' })).toBeVisible({
		timeout: 30_000
	});
	await expect(page.getByText(`${people.length} คน`, { exact: true })).toBeVisible();
	const ids: Record<string, string> = {};
	for (const p of people) {
		const qr = page.getByAltText(`QR Code สำหรับ ${fullName(p)}`);
		await expect(qr).toBeVisible({ timeout: 15_000 });
		ids[p.firstName] = await decodeQrImage(page, qr);
		expect(ids[p.firstName]).toMatch(/^evacuee:/);
	}
	return ids;
}

export async function finishPrintScreen(page: Page): Promise<void> {
	await page.getByRole('button', { name: 'กลับคิวทะเบียน' }).first().click();
	await expect(page).toHaveURL(/\/onsite\/people$/);
}

export async function expectStay(
	desk: Page,
	p: OnsitePerson,
	status: string,
	zoneName?: string
): Promise<void> {
	await searchStation1(desk, p.nationalId);
	const hit = desk
		.getByRole('listitem')
		.filter({ hasText: fullName(p) })
		.first();
	await expect(hit).toBeVisible({ timeout: 20_000 });
	await expect(hit).toContainText(`สถานะ: ${status}`);
	if (zoneName) await expect(hit).toContainText(`โซน ${zoneName}`);
}

export interface ScreeningFill {
	conditions: string;
	medications?: string;
	allergies?: string;
	notes?: string;
	careTrack?: 'normal' | 'fast_track';
}

export async function screenEvacuee(
	page: Page,
	evacueeId: string,
	fill: ScreeningFill
): Promise<void> {
	await page.goto(`/onsite/medical-screening/${evacueeId}`);
	await expect(page.getByText('Station 2', { exact: true })).toBeVisible({ timeout: 20_000 });
	await page.locator('#med-conditions').fill(fill.conditions);
	if (fill.medications) await page.locator('#med-medications').fill(fill.medications);
	if (fill.allergies) await page.locator('#med-allergies').fill(fill.allergies);
	if (fill.notes) await page.locator('#med-general-symptoms').fill(fill.notes);
	if (fill.careTrack) await page.locator(`label[for="med-care-track-${fill.careTrack}"]`).click();
	await page.getByRole('button', { name: 'บันทึกผลคัดกรอง' }).click();
	await expect(page.getByRole('heading', { name: 'บันทึกผลคัดกรองแล้ว' })).toBeVisible({
		timeout: 20_000
	});
}

export async function assignZone(page: Page, evacueeId: string, zoneName: string): Promise<void> {
	await page.goto(`/onsite/zoning/${evacueeId}`);
	await expect(page.getByText('Station 3', { exact: true })).toBeVisible({ timeout: 20_000 });
	await page.locator('div.grid button', { hasText: zoneName }).first().click();
	await page.getByRole('button', { name: 'จัดเข้าโซน (รอยืนยันถึงโซน)' }).click();
	await expect(page).toHaveURL(/\/onsite\/zoning$/, { timeout: 20_000 });
}

export async function confirmArrivalInZone(page: Page, evacueeId: string): Promise<void> {
	await page.goto(`/onsite/zoning/${evacueeId}`);
	await expect(page.getByText('Station 3', { exact: true })).toBeVisible({ timeout: 20_000 });
	await page.getByRole('button', { name: 'ยืนยันถึงโซน', exact: true }).click();
	await expect(page).toHaveURL(/\/onsite\/zoning$/, { timeout: 20_000 });
}

async function scanAndSelectOnly(page: Page, payload: string, others: string[]): Promise<void> {
	await page.goto('/onsite/scan-check-in-out');
	await expect(page.getByRole('heading', { name: /สแกนเข้า-ออกศูนย์/ })).toBeVisible({
		timeout: 20_000
	});
	await page.getByPlaceholder('กรอกรหัส หรือ สแกน QR...').fill(payload);
	await page.getByRole('button', { name: 'ตกลง' }).click();
	if (others.length > 0) {
		await expect(page.getByText('จัดการเช็คอิน/เช็คเอาท์พร้อมกับครอบครัว')).toBeVisible({
			timeout: 15_000
		});
	}
	for (const other of others) {
		const box = page.locator('label', { hasText: other }).locator('input[type=checkbox]');
		if (await box.isEnabled()) await box.uncheck();
	}
}

/** Check out through the scan page; the reason goes in the check-out dialog. */
export async function checkOutByScan(
	page: Page,
	id: string,
	others: string[],
	reason: string
): Promise<void> {
	await scanAndSelectOnly(page, id, others);
	await page.getByRole('button', { name: 'เช็คเอาท์', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'เหตุผลการเช็คเอาท์' });
	await dialog.getByLabel('เหตุผลการเช็คเอาท์').fill(reason);
	await dialog.getByRole('button', { name: 'ยืนยันเช็คเอาท์' }).click();
	await expect(page.getByText('เช็คเอาท์สำเร็จ 1 คน')).toBeVisible({ timeout: 15_000 });
}

/** Check in through the scan page; someone with no zone to return to gets the zone dialog. */
export async function checkInByScan(
	page: Page,
	id: string,
	others: string[],
	zoneCode: string
): Promise<void> {
	await scanAndSelectOnly(page, id, others);
	await page.getByRole('button', { name: 'เช็คอิน', exact: true }).click();
	const success = page.getByText('เช็คอินสำเร็จ 1 คน');
	const zoneDialog = page.getByRole('dialog', { name: 'เลือกโซนสำหรับเช็คอิน' });
	await expect(success.or(zoneDialog)).toBeVisible({ timeout: 15_000 });
	if (await zoneDialog.isVisible()) {
		const picker = zoneDialog.locator('[aria-label="โซนสำหรับเช็คอิน"]');
		if ((await picker.count()) > 0) {
			await picker.click();
			await page.getByRole('option', { name: new RegExp(`\\(${zoneCode}\\)$`) }).click();
		} else {
			await zoneDialog.getByLabel('รหัสโซน').fill(zoneCode);
		}
		await zoneDialog.getByRole('button', { name: 'ยืนยันเช็คอิน' }).click();
	}
	await expect(success).toBeVisible({ timeout: 15_000 });
}
