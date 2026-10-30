import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { DEFAULT_SLOT_WINDOWS } from '../../src/lib/features/donations/domain/compute-slots';
import { couchReq, putDocument, type CouchDocument } from './couch';
import {
	openShelter,
	todayYmd,
	type Booking,
	type BookingResponse,
	type PublicNeed,
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

export type SplitLine = {
	need: Pick<PublicNeed, 'item_id' | 'name'>;
	unit: string;
	pointId: string;
};

/**
 * A self drop-off booking whose lines go to different points, posted to the BFF the way
 * the wizard does. The wizard books one campaign line at a time, so a campaign booking
 * split across points (approved by the campaign rule, no review) has to come from here.
 */
export async function bookSplitViaApi(
	request: APIRequestContext,
	opts: {
		shelter: Pick<PublicShelter, 'code'>;
		lines: readonly SplitLine[];
		donorName: string;
		phone: string;
		ledger: RunLedger;
	}
): Promise<Booking> {
	const res = await request.post('/api/public/v1/donations', {
		data: {
			shelter_code: opts.shelter.code,
			donor: { name: opts.donorName, phone: opts.phone },
			items: opts.lines.map((line) => ({
				item_id: line.need.item_id,
				free_text: line.need.name,
				qty: 1,
				unit: line.unit,
				drop_off_point_id: line.pointId
			})),
			logistics: {
				delivery_method: 'self_dropoff',
				vehicle: 'car',
				slot: { date: todayYmd(), ...DEFAULT_SLOT_WINDOWS[0] }
			}
		}
	});
	const body = (await res.json()) as BookingResponse;
	expect(body.success, `split booking POST failed: ${JSON.stringify(body)}`).toBe(true);
	const { bookingRef, trackingToken } = body as Booking;
	opts.ledger.add('bookings', {
		token: trackingToken,
		ref: bookingRef,
		shelter: opts.shelter.code
	});
	return { bookingRef, trackingToken };
}

/**
 * The public wizard with two typed-in lines, each sent to the point in `picks` through its
 * own picker. Typed lines wait for staff review, so the booking lands in `pending_review`.
 */
export async function bookSplitAsDonor(
	page: Page,
	opts: {
		shelter: Pick<PublicShelter, 'code' | 'name'>;
		lines: readonly [
			{ itemName: string; pointName: string },
			{ itemName: string; pointName: string }
		];
		donorName: string;
		phone: string;
		ledger: RunLedger;
	}
): Promise<Booking> {
	await openShelter(page, opts.shelter);
	await page.getByRole('button', { name: 'บริจาคสิ่งของอื่นๆ' }).click();
	await expect(page.getByRole('heading', { name: 'ส่วนที่ 1: ข้อมูลผู้บริจาค' })).toBeVisible();
	await page.locator('#donor-name').fill(opts.donorName);
	await page.locator('#donor-phone').fill(opts.phone);

	await page.getByRole('button', { name: 'เพิ่มรายการสิ่งของ' }).click();
	for (const [index, line] of opts.lines.entries()) {
		await page.getByRole('textbox', { name: 'ประเภทสิ่งของ' }).nth(index).fill(line.itemName);
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
	const section = page.getByTestId('drop-off-points-section');
	await expect(section).toBeVisible();
	for (const [index, line] of opts.lines.entries()) {
		const trigger = section
			.getByTestId(`drop-off-point-line-${index}`)
			.locator('[data-slot="select-trigger"]');
		await trigger.click();
		await page.getByRole('option', { name: line.pointName, exact: true }).click();
		await expect(trigger).toContainText(line.pointName);
	}
	await page.getByRole('button', { name: 'รถยนต์' }).click();
	const freeSlot = page.getByRole('button', { name: /^\d{2}:\d{2} - \d{2}:\d{2} ว่าง/ }).first();
	await expect(freeSlot, `${opts.shelter.code} has no free drop-off slot`).toBeVisible();
	await freeSlot.click();

	const posted = page.waitForResponse(
		(r) => r.url().endsWith('/api/public/v1/donations') && r.request().method() === 'POST'
	);
	await page.getByRole('button', { name: 'ยืนยันการจองคิวบริจาค' }).click();
	const body = (await (await posted).json()) as BookingResponse;
	expect(body.success, `booking POST failed: ${JSON.stringify(body)}`).toBe(true);
	const { bookingRef, trackingToken } = body as Booking;
	opts.ledger.add('bookings', {
		token: trackingToken,
		ref: bookingRef,
		shelter: opts.shelter.code
	});
	await expect(page.getByRole('heading', { name: 'ส่งรายการรอเจ้าหน้าที่ตรวจสอบ' })).toBeVisible();
	return { bookingRef, trackingToken };
}
