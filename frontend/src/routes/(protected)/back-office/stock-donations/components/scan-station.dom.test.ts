// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { THAI_MOBILE_PHONE_MESSAGE } from '$lib/db/model';
import ScanStation from './scan-station.svelte';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
const empty = { data: [] as unknown[], isLoading: false };

vi.mock('$lib/features/supply', () => ({ useSupplyItems: () => empty }));
// The shelter doc the station reads its drop-off points from (CR-206 FR-MP-18).
const shelterDoc = vi.hoisted(() => ({ current: undefined as unknown, ready: true }));
vi.mock('$lib/features/shelters', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/shelters')>()),
	useShelters: () => empty,
	useShelter: () => ({
		get data() {
			return shelterDoc.current;
		},
		get isSuccess() {
			return shelterDoc.ready;
		},
		isLoading: false
	})
}));
vi.mock('$lib/features/catalog', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/catalog')>()),
	useItemMasters: () => empty,
	useUnitsOfMeasure: () => empty
}));
const storagePointList = vi.hoisted(() => ({ current: [] as { id: string; name: string }[] }));
vi.mock('$lib/features/operations', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/operations')>()),
	useStoragePoints: () => ({
		get points() {
			return storagePointList.current;
		},
		isLoading: false
	})
}));
vi.mock('$lib/db/shelter', () => ({ getShelterCode: () => 'SH001' }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('svelte-sonner', () => ({ toast: toastMock }));

let instance: ReturnType<typeof mount> | null = null;

async function settle() {
	for (let i = 0; i < 3; i++) {
		flushSync();
		await tick();
	}
}

async function render() {
	instance = mount(ScanStation, { target: document.body, props: { initialView: 'walkin' } });
	await settle();
}

async function type(id: string, value: string) {
	const input = document.getElementById(id) as HTMLInputElement;
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	await settle();
	return input;
}

const save = () =>
	[...document.querySelectorAll<HTMLButtonElement>('[data-testid="walkin-footer"] button')].find(
		(b) => b.textContent?.includes('บันทึก')
	)!;

afterEach(async () => {
	vi.unstubAllGlobals();
	toastMock.error.mockReset();
	toastMock.success.mockReset();
	shelterDoc.current = undefined;
	shelterDoc.ready = true;
	storagePointList.current = [];
	localStorage.clear();
	if (instance) unmount(instance);
	instance = null;
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
});

describe('scan-station walk-in', () => {
	it('stacks the footer buttons full-width on mobile', async () => {
		await render();
		const footer = document.querySelector('[data-testid="walkin-footer"]')!;
		expect(footer.className).toContain('flex-col-reverse');
		expect(footer.className).toContain('sm:flex-row');
		expect(footer.className).toContain('sm:justify-end');
		for (const button of footer.querySelectorAll('button')) {
			expect(button.className).toContain('w-full');
			expect(button.className).toContain('sm:w-auto');
		}
	});

	it('starts the received quantity of a walk-in line at 0', async () => {
		await render();
		const qty = document.querySelector<HTMLInputElement>('[id^="walkin-qty-"]')!;
		expect(qty.value).toBe('0');
	});

	it('clears letters typed into an empty phone field instead of leaving them on screen', async () => {
		await render();

		const phone = await type('donor-phone-input', 'ฟกหดน่หกด่');
		expect(phone.value).toBe('');

		await type('donor-phone-input', '08');
		const after = await type('donor-phone-input', '08abc');
		expect(after.value).toBe('08');
	});

	it('filters phone typing, shows the inline error and never calls fetch when invalid', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		await render();
		const phone = await type('donor-phone-input', '089-abc');
		expect(phone.value).toBe('089');
		expect(phone.getAttribute('inputmode')).toBe('numeric');
		expect(phone.placeholder).toBe('เช่น 0891234567');

		await type('donor-name-input', 'สมชาย');
		// Not shown while typing — only once the field is left or a save is tried.
		expect(document.querySelector('[data-testid="walkin-phone-error"]')).toBeNull();
		save().click();
		await settle();

		const message = THAI_MOBILE_PHONE_MESSAGE;
		expect(document.querySelector('[data-testid="walkin-phone-error"]')?.textContent?.trim()).toBe(
			message
		);
		expect(fetchMock).not.toHaveBeenCalled();
		// A blocked save says why and takes the user to the field, which may be off-screen.
		expect(toastMock.error).toHaveBeenCalledWith(message);
		expect(document.activeElement?.id).toBe('donor-phone-input');
		expect(phone.getAttribute('aria-describedby')).toBe('donor-phone-error');
		toastMock.error.mockReset();
		await type('donor-phone-input', '0891234567');
		expect(document.querySelector('[data-testid="walkin-phone-error"]')).toBeNull();
		save().click();
		await settle();
		expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining('รายการสิ่งของ'));
	});
});

// ── CR-206: receiving one booking point by point ────────────────────────────────────────

const GYM = { id: 'pt-gym', name: 'โรงยิม' };
const MED = { id: 'pt-med', name: 'ห้องพยาบาล' };
const STORE3 = { id: 'pt-store3', name: 'ห้องเก็บของ 3' };

/** A drop-off point as the shelter doc carries it: ticked, with a pin (CR-205). */
const dropOffPoint = (point: { id: string; name: string }) => ({
	...point,
	types: ['general'],
	accepts_donations: true,
	lat: 7.0,
	lng: 100.5
});

/** AC-1: water to the gym, medicine to the infirmary. */
function splitBooking(extra: Record<string, unknown> = {}) {
	return {
		rev: '3-abc',
		booking_ref: 'DN-206',
		shelter_code: 'SH001',
		status: 'verifying',
		donor: { name: 'สมชาย', phone: null },
		items: [
			{ item_id: 'item:water', qty: '24', unit: 'bottle', drop_off_point_id: GYM.id },
			{ item_id: 'item:paracetamol', qty: '10', unit: 'pack', drop_off_point_id: MED.id }
		],
		...extra
	};
}

type FetchCall = [string, RequestInit | undefined];

function stubApi(
	donation: unknown,
	post: unknown = { success: true, donation: { status: 'verifying' } }
) {
	const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
		const body = init?.method === 'POST' ? post : { success: true, donation };
		return new Response(JSON.stringify(body), { status: 200 });
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

async function openBooking() {
	instance = mount(ScanStation, { target: document.body, props: { initialQuery: 'DN-206' } });
	for (let i = 0; i < 5; i++) {
		await settle();
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}

const line = (idx: number) =>
	document.querySelector<HTMLElement>(`[data-testid="scan-line-${idx}"]`)!;
const buttonIn = (root: ParentNode, text: string) =>
	[...root.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
		b.textContent?.includes(text)
	)!;
const submit = () =>
	document.querySelector<HTMLButtonElement>('[data-testid="scan-receive-submit"]')!;
const postBody = (fetchMock: ReturnType<typeof stubApi>) => {
	const call = (fetchMock.mock.calls as FetchCall[]).find(([, init]) => init?.method === 'POST');
	return call ? { url: call[0], body: JSON.parse(String(call[1]?.body)) } : null;
};

describe('scan-station point by point (CR-206)', () => {
	it('shows the bookings lines but keeps save off until a point is picked (FR-MP-18a)', async () => {
		shelterDoc.current = { common_areas: { sub_storage: [dropOffPoint(GYM), dropOffPoint(MED)] } };
		storagePointList.current = [GYM, MED];
		stubApi(splitBooking());
		await openBooking();

		expect(document.querySelector('[data-testid="receiving-point"]')).not.toBeNull();
		expect(line(0).dataset.lineState).toBe('needs_point');
		expect(line(1).dataset.lineState).toBe('needs_point');
		expect(submit().disabled).toBe(true);
		expect(submit().textContent).toContain('เลือกจุดที่ประจำก่อน');
	});

	it('locks every row and hides 0 / 0 until a point is chosen (#1059)', async () => {
		shelterDoc.current = { common_areas: { sub_storage: [dropOffPoint(GYM), dropOffPoint(MED)] } };
		storagePointList.current = [GYM, MED];
		stubApi(splitBooking());
		await openBooking();

		expect(document.querySelector('[data-testid="choose-point-warning"]')).not.toBeNull();
		expect(document.querySelector('[data-testid="other-point-warning"]')).toBeNull();
		expect(document.body.textContent).toContain('เลือกจุดที่ประจำก่อนจึงจะตรวจรับได้');
		expect(document.body.textContent).not.toContain('0 / 0');
		expect(
			document.querySelector('[data-testid="scan-line-0-needs-point"]')?.textContent
		).toContain('เลือกจุดที่ประจำก่อนจึงจะตรวจรับรายการนี้ได้');
		expect(buttonIn(line(0), 'ผ่านการตรวจสอบแล้ว')).toBeUndefined();
	});

	it('locks a whole booking too until a point is chosen (Q4)', async () => {
		shelterDoc.current = { common_areas: { sub_storage: [dropOffPoint(GYM), dropOffPoint(MED)] } };
		storagePointList.current = [GYM, MED];
		stubApi(splitBooking({ items: [{ item_id: 'item:water', qty: '24', unit: 'bottle' }] }));
		await openBooking();

		expect(line(0).dataset.lineState).toBe('needs_point');
		expect(buttonIn(line(0), 'ผ่านการตรวจสอบแล้ว')).toBeUndefined();
		expect(submit().disabled).toBe(true);
	});

	it('warns that a line is another points, and counts it (#1059)', async () => {
		shelterDoc.current = { common_areas: { sub_storage: [dropOffPoint(GYM), dropOffPoint(MED)] } };
		storagePointList.current = [GYM, MED];
		localStorage.setItem('stock-donations:receiving-point:SH001', GYM.id);
		stubApi(splitBooking());
		await openBooking();

		const warning = document.querySelector('[data-testid="other-point-warning"]')!;
		expect(warning.textContent).toContain('1 รายการเป็นของจุดอื่น');
		expect(warning.querySelector('[data-testid="unlock-other-points"]')).not.toBeNull();
		expect(document.querySelector('[data-testid="choose-point-warning"]')).toBeNull();
		const row = document.querySelector('[data-testid="scan-line-1-other-point"]')!;
		expect(row.className).toContain('border-amber-200');
		expect(row.textContent).toContain('ของจุดอื่น');
		expect(line(1).className).toContain('border-amber-200');
		expect(document.body.textContent).toContain('ตรวจแล้ว 0 / 1 รายการ · อีก 1 รายการอยู่จุดอื่น');
	});

	it('says so when the chosen point has no line of its own (#1059)', async () => {
		shelterDoc.current = { common_areas: { sub_storage: [dropOffPoint(GYM), dropOffPoint(MED)] } };
		storagePointList.current = [GYM, MED];
		localStorage.setItem('stock-donations:receiving-point:SH001', MED.id);
		stubApi(
			splitBooking({
				items: [
					{ item_id: 'item:water', qty: '24', unit: 'bottle', drop_off_point_id: GYM.id },
					{ item_id: 'item:rice', qty: '5', unit: 'bag', drop_off_point_id: GYM.id }
				]
			})
		);
		await openBooking();

		expect(document.body.textContent).toContain('ตรวจแล้ว 0 / 0 รายการ · อีก 2 รายการอยู่จุดอื่น');
		expect(submit().disabled).toBe(true);
		expect(submit().textContent).toContain('ไม่มีรายการของจุดนี้ให้รับ');

		document.querySelector<HTMLButtonElement>('[data-testid="unlock-other-points"]')!.click();
		await settle();
		expect(document.querySelector('[data-testid="other-point-warning"]')).toBeNull();
		expect(document.body.textContent).toContain('รับรายการของจุดอื่นได้แล้ว');
		expect(document.body.textContent).toContain('ตรวจแล้ว 0 / 2 รายการ');
		expect(document.body.textContent).not.toContain('อีก 2 รายการอยู่จุดอื่น');
		expect(document.querySelector('[data-testid="scan-line-0-borrowed"]')).not.toBeNull();
	});

	it('records only the gyms line and sends point_id + line_nos (AC-5)', async () => {
		shelterDoc.current = { common_areas: { sub_storage: [dropOffPoint(GYM), dropOffPoint(MED)] } };
		storagePointList.current = [GYM, MED];
		localStorage.setItem('stock-donations:receiving-point:SH001', GYM.id);
		const fetchMock = stubApi(splitBooking());
		await openBooking();

		expect(line(0).dataset.lineState).toBe('receivable');
		expect(line(1).dataset.lineState).toBe('other_point');
		expect(
			document.querySelector('[data-testid="scan-line-1-other-point"]')?.textContent
		).toContain('ส่งที่ ห้องพยาบาล');
		expect(document.querySelector('[data-testid="scan-line-1-point"]')?.textContent).toContain(
			'ห้องพยาบาล'
		);
		expect(buttonIn(line(1), 'ผ่านการตรวจสอบแล้ว')).toBeUndefined();

		buttonIn(line(0), 'ผ่านการตรวจสอบแล้ว').click();
		await settle();
		expect(submit().disabled).toBe(false);
		submit().click();
		await settle();
		await new Promise((resolve) => setTimeout(resolve, 0));

		const sent = postBody(fetchMock)!;
		expect(sent.url).toBe('/api/back-office/donations/DN-206');
		expect(sent.body).toMatchObject({
			status: 'received',
			expected_rev: '3-abc',
			point_id: GYM.id,
			line_nos: [0]
		});
		expect(sent.body.items).toHaveLength(2);
		// FR-MP-20: shelved at the line's own point unless staff change it.
		expect(sent.body.items[0].lot).toMatchObject({ storage_point_id: GYM.id });
		expect(sent.body.items[1]).toEqual({ item_id: 'item:paracetamol', qty: '10', unit: 'pack' });
	});

	it('unlocks another points line and shelves it at the chosen point (AC-10)', async () => {
		shelterDoc.current = { common_areas: { sub_storage: [dropOffPoint(GYM), dropOffPoint(MED)] } };
		storagePointList.current = [GYM, MED];
		localStorage.setItem('stock-donations:receiving-point:SH001', GYM.id);
		const fetchMock = stubApi(splitBooking());
		await openBooking();

		document.querySelector<HTMLButtonElement>('[data-testid="unlock-other-points"]')!.click();
		await settle();
		expect(line(1).dataset.lineState).toBe('receivable');
		buttonIn(line(1), 'ผ่านการตรวจสอบแล้ว').click();
		await settle();
		submit().click();
		await settle();
		await new Promise((resolve) => setTimeout(resolve, 0));

		const sent = postBody(fetchMock)!;
		expect(sent.body).toMatchObject({ point_id: GYM.id, line_nos: [1] });
		expect(sent.body.items[1].lot).toMatchObject({ storage_point_id: GYM.id });
	});

	it('shows a recorded line as received at its point, and offers ปิดใบ (FR-MP-19, FR-MP-26)', async () => {
		shelterDoc.current = { common_areas: { sub_storage: [dropOffPoint(GYM), dropOffPoint(MED)] } };
		storagePointList.current = [GYM, MED];
		stubApi(
			splitBooking({
				point_receipts: [
					{
						point_id: GYM.id,
						line_nos: [0],
						received_at: '2026-10-28T09:12:00+07:00',
						received_by: 'a'
					}
				]
			})
		);
		await openBooking();

		expect(line(0).dataset.lineState).toBe('recorded');
		expect(document.querySelector('[data-testid="scan-line-0-recorded"]')?.textContent).toContain(
			'รับแล้วที่ โรงยิม'
		);
		expect(document.querySelector('[data-testid="close-donation-button"]')).not.toBeNull();
		// A started booking is closed, not rejected (FR-MP-17a).
		expect(buttonIn(document.body, 'ปฏิเสธคำขอ')).toBeUndefined();
	});

	it('closes the booking through the close route after confirming (FR-MP-26, FR-MP-27)', async () => {
		shelterDoc.current = { common_areas: { sub_storage: [dropOffPoint(GYM), dropOffPoint(MED)] } };
		storagePointList.current = [GYM, MED];
		const fetchMock = stubApi(
			splitBooking({
				point_receipts: [
					{
						point_id: GYM.id,
						line_nos: [0],
						received_at: '2026-10-28T09:12:00+07:00',
						received_by: 'a'
					}
				]
			}),
			{ success: true, donation: { status: 'received' } }
		);
		await openBooking();

		document.querySelector<HTMLButtonElement>('[data-testid="close-donation-button"]')!.click();
		await settle();
		const dialog = document.querySelector('[data-testid="close-donation-dialog"]')!;
		expect(dialog.textContent).toContain('paracetamol');
		document.querySelector<HTMLButtonElement>('[data-testid="close-donation-confirm"]')!.click();
		await settle();
		await new Promise((resolve) => setTimeout(resolve, 0));

		const sent = postBody(fetchMock)!;
		expect(sent.url).toBe('/api/back-office/donations/DN-206/close');
		expect(sent.body).toEqual({ expected_rev: '3-abc' });
		expect(toastMock.success).toHaveBeenCalledWith(expect.stringContaining('ปิดใบ DN-206 แล้ว'));
	});

	it('offers no ปิดใบ before any point recorded (FR-MP-28)', async () => {
		shelterDoc.current = { common_areas: { sub_storage: [dropOffPoint(GYM), dropOffPoint(MED)] } };
		stubApi(splitBooking());
		await openBooking();
		expect(document.querySelector('[data-testid="close-donation-button"]')).toBeNull();
		expect(buttonIn(document.body, 'ปฏิเสธคำขอ')).toBeDefined();
	});

	it('receives the rest with point_id null once no point is left (FR-MP-18b, AC-23)', async () => {
		shelterDoc.current = { common_areas: { sub_storage: [{ ...STORE3, types: ['general'] }] } };
		storagePointList.current = [STORE3];
		stubApi(
			splitBooking({
				point_receipts: [
					{
						point_id: GYM.id,
						line_nos: [0],
						received_at: '2026-10-28T09:12:00+07:00',
						received_by: 'a'
					}
				]
			})
		);
		await openBooking();

		expect(document.querySelector('[data-testid="receiving-point"]')).toBeNull();
		expect(
			document.querySelector('[data-testid="no-drop-off-point-banner"]')?.textContent
		).toContain('ศูนย์ไม่มีจุดรับบริจาคแล้ว รับรายการที่เหลือเข้าสถานที่จัดเก็บที่เลือก');
		expect(line(1).dataset.lineState).toBe('receivable');

		buttonIn(line(1), 'ผ่านการตรวจสอบแล้ว').click();
		await settle();
		// The storage location is staff's pick here (FR-MP-20 has no point to start from).
		expect(submit().disabled).toBe(true);
	});

	it('reads no "no point left" while the shelter doc is still loading', async () => {
		shelterDoc.ready = false;
		stubApi(
			splitBooking({
				point_receipts: [
					{
						point_id: GYM.id,
						line_nos: [0],
						received_at: '2026-10-28T09:12:00+07:00',
						received_by: 'a'
					}
				]
			})
		);
		await openBooking();

		expect(document.querySelector('[data-testid="no-drop-off-point-banner"]')).toBeNull();
		expect(submit().disabled).toBe(true);
	});

	it('sends point_id null with the remaining lines (FR-MP-18b)', async () => {
		// A shelter with no storage point at all receives into the main store.
		const fetchMock = stubApi(
			splitBooking({
				point_receipts: [
					{
						point_id: GYM.id,
						line_nos: [0],
						received_at: '2026-10-28T09:12:00+07:00',
						received_by: 'a'
					}
				]
			})
		);
		await openBooking();

		buttonIn(line(1), 'ผ่านการตรวจสอบแล้ว').click();
		await settle();
		submit().click();
		await settle();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(postBody(fetchMock)!.body).toMatchObject({ point_id: null, line_nos: [1] });
	});

	it('keeps the whole-booking flow without point fields (FR-MP-24)', async () => {
		const fetchMock = stubApi(
			splitBooking({
				items: [{ item_id: 'item:water', qty: '24', unit: 'bottle' }]
			})
		);
		await openBooking();

		expect(document.querySelector('[data-testid="receiving-point"]')).toBeNull();
		buttonIn(line(0), 'ผ่านการตรวจสอบแล้ว').click();
		await settle();
		submit().click();
		await settle();
		await new Promise((resolve) => setTimeout(resolve, 0));

		const sent = postBody(fetchMock)!;
		expect(sent.body).not.toHaveProperty('point_id');
		expect(sent.body).not.toHaveProperty('line_nos');
	});

	it.each([
		{ lots: [{ item_id: 'item:water', lot_no: 'L1' }], says: 'ลงคลังแล้ว' },
		{ lots: [], says: 'ไม่มีของเข้าคลัง' }
	])(
		'tells staff whether goods went in when the booking closed under them (AC-22): $says',
		async ({ lots, says }) => {
			shelterDoc.current = {
				common_areas: { sub_storage: [dropOffPoint(GYM), dropOffPoint(MED)] }
			};
			storagePointList.current = [GYM, MED];
			localStorage.setItem('stock-donations:receiving-point:SH001', MED.id);
			stubApi(splitBooking(), {
				success: false,
				error_code: 'DONATION_CLOSED',
				error: 'closed',
				lots
			});
			await openBooking();

			buttonIn(line(1), 'ผ่านการตรวจสอบแล้ว').click();
			await settle();
			submit().click();
			await settle();
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(toastMock.error).toHaveBeenCalledWith(
				expect.stringContaining('ถูกปิดไปก่อนบันทึกเสร็จ'),
				expect.objectContaining({ description: expect.stringContaining(says) })
			);
		}
	);
});

describe('scan-station vehicle plate (CR-209 FR-3b, AC-8)', () => {
	const booking = (logistics: Record<string, unknown>) => ({
		success: true,
		donation: {
			booking_ref: 'DN-000010',
			shelter_code: 'SH001',
			status: 'verifying',
			donor: { name: 'ผู้บริจาค', phone: '0812345678', email: null },
			items: [{ item_id: 'item:rice', qty: '5', unit: 'kg' }],
			logistics
		}
	});

	async function open(logistics: Record<string, unknown>) {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({ ok: true, json: async () => booking(logistics) })
		);
		instance = mount(ScanStation, { target: document.body, props: { initialQuery: 'DN-000010' } });
		await settle();
		await new Promise((resolve) => setTimeout(resolve, 0));
		await settle();
	}

	it('shows the plate next to the vehicle on a v10 booking that has one', async () => {
		await open({ delivery_method: 'self_dropoff', vehicle: 'car', vehicle_plate: 'กข 1234' });
		expect(document.body.textContent).toContain('ทะเบียน กข 1234');
	});

	it('shows no plate line on a booking without one (doc from before v10)', async () => {
		await open({ delivery_method: 'self_dropoff', vehicle: 'car' });
		expect(document.body.textContent).toContain('วิธีส่ง / ยานพาหนะ');
		expect(document.body.textContent).not.toContain('ทะเบียน ');
	});
});
