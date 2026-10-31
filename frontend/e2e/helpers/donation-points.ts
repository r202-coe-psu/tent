import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { DEFAULT_SLOT_WINDOWS } from '../../src/lib/features/donations/domain/compute-slots';
import { couchReq, putDocument, type CouchDocument } from './couch';
import {
	openPendingRow,
	openShelter,
	todayYmd,
	type BookedLine,
	type Booking,
	type BookingResponse,
	type PublicShelter,
	type RunLedger
} from './donation-fullstack';
import { appBaseUrl } from './e2e-env';
import { waitForProjection } from './public-cleanup';

/** A drop-off point (CR-205): a storage point ticked `accepts_donations`, with a pin. */
export type DonationPointSeed = {
	id: string;
	name: string;
	lat: number;
	lng: number;
	note?: string;
};

/** Only a run's own `E2E Donation …` shelter may be edited — never SH001–SH004. */
const DONATION_SHELTER_PREFIX = 'E2E Donation';

async function findShelterMaster(code: string): Promise<CouchDocument | undefined> {
	const byCode = await couchReq(
		'GET',
		`/registry/_design/app/_view/by_code?key=${encodeURIComponent(JSON.stringify(code))}&include_docs=true`
	);
	return (byCode.data as { rows?: { doc?: CouchDocument }[] } | null)?.rows?.[0]?.doc;
}

/**
 * Give the run's shelter its drop-off points (`common_areas.sub_storage[]`, CR-205) on the
 * registry master — what the shelter form writes — and wait until the public detail serves
 * them, since the donor form reads the projection.
 */
export async function setDonationPoints(
	code: string,
	points: readonly DonationPointSeed[]
): Promise<void> {
	const master = await findShelterMaster(code);
	if (!master) throw new Error(`registry has no shelter ${code}`);
	if (!String(master.name ?? '').startsWith(DONATION_SHELTER_PREFIX)) {
		throw new Error(`Refusing to edit non-E2E shelter ${code} ("${String(master.name)}")`);
	}
	const commonAreas = (master.common_areas ?? {}) as Record<string, unknown>;
	await putDocument('registry', {
		...master,
		common_areas: {
			...commonAreas,
			sub_storage: points.map((point) => ({
				id: point.id,
				name: point.name,
				types: ['general'],
				accepts_donations: true,
				lat: point.lat,
				lng: point.lng,
				location_note: point.note ?? null
			}))
		},
		updated_at: new Date().toISOString()
	});
	const ids = points.map((point) => point.id).join(',');
	await waitForProjection(
		`${code} serves drop-off points ${ids}`,
		async () => {
			const res = await fetch(`${appBaseUrl()}/api/public/v1/shelters/${code}`);
			if (!res.ok) return false;
			const body = (await res.json()) as {
				shelter?: { donation_points?: { id: string }[] };
				donation_points?: { id: string }[];
			};
			const served = body.shelter?.donation_points ?? body.donation_points ?? [];
			return served.map((point) => point.id).join(',') === ids;
		},
		{ timeoutMs: 60_000, intervalMs: 2_000 }
	);
}

/** A line as the BFF takes it: a catalog item (`item_id`) or one the donor typed in. */
export type BookingLine = { item_id?: string; name: string; unit: string };

export type PointBooking = Booking & { items: BookedLine[] };

function recordBooking(
	body: BookingResponse,
	shelterCode: string,
	ledger: RunLedger,
	what: string
): PointBooking {
	expect(body.success, `${what} POST failed: ${JSON.stringify(body)}`).toBe(true);
	const { bookingRef, trackingToken } = body as Booking;
	ledger.add('bookings', { token: trackingToken, ref: bookingRef, shelter: shelterCode });
	return { bookingRef, trackingToken, items: body.items ?? [] };
}

/**
 * A self drop-off booking posted to the BFF the way the wizard does. The wizard books
 * either one campaign line or typed-in lines, so a booking that mixes a campaign line with
 * a line of the donor's own (staff-assigned drop-off AC-AP-13) has to come from here. It
 * sends no `drop_off_point_id`: the BFF sets each line's point (FR-AP-7, FR-AP-8).
 */
export async function bookSelfDropoffViaApi(
	request: APIRequestContext,
	opts: {
		shelter: Pick<PublicShelter, 'code'>;
		lines: readonly BookingLine[];
		donorName: string;
		phone: string;
		ledger: RunLedger;
	}
): Promise<PointBooking> {
	const res = await request.post('/api/public/v1/donations', {
		data: {
			shelter_code: opts.shelter.code,
			donor: { name: opts.donorName, phone: opts.phone },
			items: opts.lines.map((line) => ({
				...(line.item_id ? { item_id: line.item_id } : { category: 'other', condition: 'new' }),
				free_text: line.name,
				qty: 1,
				unit: line.unit
			})),
			logistics: {
				delivery_method: 'self_dropoff',
				vehicle: 'car',
				slot: { date: todayYmd(), ...DEFAULT_SLOT_WINDOWS[0] }
			}
		}
	});
	return recordBooking(
		(await res.json()) as BookingResponse,
		opts.shelter.code,
		opts.ledger,
		'self drop-off booking'
	);
}

/**
 * The public wizard with two typed-in lines, brought to a shelter with drop-off points.
 * Step 3 offers no point to pick; it shows each typed line, read-only, in the group waiting
 * for staff (FR-AP-11, FR-AP-12). Typed lines wait for staff review (`pending_review`).
 */
export async function bookTypedAsDonor(
	page: Page,
	opts: {
		shelter: Pick<PublicShelter, 'code' | 'name'>;
		itemNames: readonly string[];
		donorName: string;
		phone: string;
		ledger: RunLedger;
	}
): Promise<PointBooking> {
	await openShelter(page, opts.shelter);
	await page.getByRole('button', { name: 'บริจาคสิ่งของอื่นๆ' }).click();
	await expect(page.getByRole('heading', { name: 'ส่วนที่ 1: ข้อมูลผู้บริจาค' })).toBeVisible();
	await page.locator('#donor-name').fill(opts.donorName);
	await page.locator('#donor-phone').fill(opts.phone);

	for (const [index, itemName] of opts.itemNames.entries()) {
		if (index > 0) await page.getByRole('button', { name: 'เพิ่มรายการสิ่งของ' }).click();
		await page.getByRole('textbox', { name: 'ประเภทสิ่งของ' }).nth(index).fill(itemName);
		await page
			.getByRole('button', { name: /^หน่วย/ })
			.nth(index)
			.click();
		await page.getByRole('option', { name: 'กล่อง', exact: true }).click();
		await page.getByRole('spinbutton', { name: 'ปริมาณ' }).nth(index).fill('1');
	}
	await page.getByRole('button', { name: 'ถัดไป: เลือกจุดส่งมอบ' }).click();

	await expect(
		page.getByRole('heading', { name: 'ส่วนที่ 3: ข้อมูลการจัดส่ง โลจิสติกส์' })
	).toBeVisible();
	await page.getByRole('button', { name: 'นำมาส่งด้วยตนเอง' }).click();
	// Typed lines wait for staff, read-only, before booking (FR-AP-12).
	const awaiting = page.locator('[data-testid="drop-off-group"][data-point-id="?staff"]');
	await expect(awaiting).toHaveText(/รอเจ้าหน้าที่กำหนดจุดส่ง/);
	for (const itemName of opts.itemNames) await expect(awaiting).toContainText(itemName);
	await expect(page.locator('[data-slot="select-trigger"]')).toHaveCount(0);
	await page.getByRole('button', { name: 'รถยนต์' }).click();
	const freeSlot = page.getByRole('button', { name: /^\d{2}:\d{2} - \d{2}:\d{2} ว่าง/ }).first();
	await expect(freeSlot, `${opts.shelter.code} has no free drop-off slot`).toBeVisible();
	await freeSlot.click();

	const posted = page.waitForResponse(
		(r) => r.url().endsWith('/api/public/v1/donations') && r.request().method() === 'POST'
	);
	await page.getByRole('button', { name: 'ยืนยันการจองคิวบริจาค' }).click();
	const booking = recordBooking(
		(await (await posted).json()) as BookingResponse,
		opts.shelter.code,
		opts.ledger,
		'typed booking'
	);
	await expect(page.getByRole('heading', { name: 'ส่งรายการรอเจ้าหน้าที่ตรวจสอบ' })).toBeVisible();
	return booking;
}

/** The review card of the line named `name` (its decision group is labelled by it). */
export function reviewLine(page: Page, name: string) {
	return page
		.getByRole('listitem')
		.filter({ has: page.getByRole('group', { name: `ผลการประเมิน ${name}` }) });
}

/**
 * Staff accept each pending line in `picks` and send it to the point named there
 * (FR-AP-20), then save. Confirm stays disabled while an accepted line has no point
 * (AC-AP-11). Resolves once the approve POST answers OK.
 */
export async function approveWithPoints(
	page: Page,
	bookingRef: string,
	picks: readonly { line: string; pointName: string }[]
): Promise<void> {
	await openPendingRow(page, bookingRef);
	const save = page.getByRole('button', { name: 'บันทึกผลการประเมิน' });
	for (const pick of picks) {
		const line = reviewLine(page, pick.line);
		await line.getByRole('button', { name: /^รับรายการนี้/ }).click();
		await expect(save).toBeDisabled();
		const trigger = line.getByRole('button', { name: /^จุดรับบริจาคที่ให้ผู้บริจาคนำของไปส่ง/ });
		await expect(trigger).toContainText('เลือกจุดรับบริจาค');
		await trigger.click();
		await page.getByRole('option', { name: pick.pointName, exact: true }).click();
		await expect(trigger).toContainText(pick.pointName);
	}
	await expect(save).toBeEnabled();
	const approved = page.waitForResponse(
		(r) =>
			r.url().endsWith(`/api/back-office/donations/${bookingRef}/approve`) &&
			r.request().method() === 'POST'
	);
	await save.click();
	const res = await approved;
	expect(res.ok(), `approve failed: ${await res.text()}`).toBe(true);
}
