// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type { PendingDonationRow } from '$lib/features/donations';
import PendingReviewDetail from './pending-review-detail.svelte';

const shelter = vi.hoisted(() => ({ doc: undefined as unknown }));

vi.mock('$lib/features/shelters', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/shelters')>()),
	useShelters: () => ({ data: [] }),
	useShelter: () => ({ data: shelter.doc, isSuccess: true })
}));
vi.mock('$lib/features/catalog', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/catalog')>()),
	useUnitsOfMeasure: () => ({ data: [] })
}));
vi.mock('$lib/features/donations', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/donations')>()),
	useRevealDonorContact: () => ({ mutateAsync: vi.fn(), isPending: false })
}));
vi.mock('$lib/features/operations', () => ({
	DonationLotsTable: () => {},
	useStockFormItems: () => ({ items: [] })
}));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const point = (id: string, name: string) => ({
	id,
	name,
	accepts_donations: true,
	lat: 7.0,
	lng: 100.5
});
const GYM = point('sp-gym', 'โรงยิม');
const MED = point('sp-med', 'ห้องพยาบาล');
const shelterWith = (...points: object[]) => ({ common_areas: { sub_storage: points } });

/** AC-AP-9 — two lines the donor typed in, no point yet. */
const baseRow: PendingDonationRow = {
	booking_ref: 'DN-000001',
	rev: '1-abc',
	shelter_code: 'SH001',
	status: 'pending_review',
	donor_name: 'ผู้บริจาค',
	donor_phone: '0800000001',
	item_count: 2,
	items: [
		{
			free_text: 'ผ้าห่ม',
			qty: '5',
			unit: 'ผืน',
			review_status: 'pending',
			drop_off_point_id: null
		},
		{
			free_text: 'น้ำดื่ม',
			qty: '2',
			unit: 'ลัง',
			review_status: 'pending',
			drop_off_point_id: null
		}
	],
	delivery_method: 'self_dropoff',
	point_receipts: []
};

let instance: ReturnType<typeof mount> | null = null;
const onApprove = vi.fn();

async function settle() {
	flushSync();
	await tick();
	flushSync();
}

async function render(row: PendingDonationRow) {
	instance = mount(PendingReviewDetail, {
		target: document.body,
		props: { request: row, onBack: () => {}, onApprove, onReject: () => {} }
	});
	await settle();
}

async function press(el: Element) {
	el.dispatchEvent(
		new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })
	);
	el.dispatchEvent(
		new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' })
	);
	(el as HTMLElement).click();
	await settle();
}

const pointPicker = (line: number) =>
	document.body.querySelector<HTMLElement>(`#review-line-${line}-point`);
const confirmButton = () =>
	[...document.body.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
		b.textContent?.includes('บันทึกผลการประเมิน')
	)!;

/** Presses "รับรายการนี้" on the line's decision pair. */
async function approve(line: number) {
	const group = document.body.querySelectorAll('[role="group"]')[line];
	await press(group.querySelector('button')!);
}

async function choosePoint(line: number, name: string) {
	await press(pointPicker(line)!);
	const listbox = [...document.body.querySelectorAll('[role="listbox"]')].at(-1)!;
	const option = [...listbox.querySelectorAll('[role="option"]')].find(
		(o) => o.textContent?.trim() === name
	)!;
	await press(option);
}

beforeEach(() => {
	shelter.doc = shelterWith(GYM, MED);
});

afterEach(async () => {
	if (instance) unmount(instance);
	instance = null;
	vi.clearAllMocks();
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
});

describe('PendingReviewDetail drop-off point per line (FR-AP-20)', () => {
	it('AC-AP-10: staff pick a point for each approved line before confirming', async () => {
		await render(baseRow);
		expect(pointPicker(0)).toBeNull();

		await approve(0);
		await approve(1);
		expect(pointPicker(0)?.textContent).toContain('เลือกจุดรับบริจาค');
		// AC-AP-11: an approved line without a point cannot be confirmed.
		expect(confirmButton().disabled).toBe(true);

		await choosePoint(0, 'โรงยิม');
		expect(confirmButton().disabled).toBe(true);
		await choosePoint(1, 'ห้องพยาบาล');
		expect(confirmButton().disabled).toBe(false);

		await press(confirmButton());
		expect(onApprove).toHaveBeenCalledWith('DN-000001', '', [
			{ index: 0, decision: 'approved', drop_off_point_id: 'sp-gym' },
			{ index: 1, decision: 'approved', drop_off_point_id: 'sp-med' }
		]);
	});

	it('AC-AP-2a / D-AP-11: the only point is chosen for the line', async () => {
		shelter.doc = shelterWith(GYM);
		await render({ ...baseRow, items: [baseRow.items[0]], item_count: 1 });

		await approve(0);

		expect(pointPicker(0)?.textContent).toContain('โรงยิม');
		await press(confirmButton());
		expect(onApprove).toHaveBeenCalledWith('DN-000001', '', [
			{ index: 0, decision: 'approved', drop_off_point_id: 'sp-gym' }
		]);
	});

	it('AC-AP-13a: a line that still has a current point starts on it', async () => {
		await render({
			...baseRow,
			items: [
				{
					item_id: 'item:rice',
					qty: '10',
					unit: 'kg',
					review_status: 'pending',
					drop_off_point_id: 'sp-med'
				}
			],
			item_count: 1
		});

		await approve(0);

		expect(pointPicker(0)?.textContent).toContain('ห้องพยาบาล');
		expect(confirmButton().disabled).toBe(false);
	});

	it('AC-AP-13a: a line whose point was deleted starts empty', async () => {
		await render({
			...baseRow,
			items: [
				{
					item_id: 'item:rice',
					qty: '10',
					unit: 'kg',
					review_status: 'pending',
					drop_off_point_id: 'sp-gone'
				}
			],
			item_count: 1
		});

		await approve(0);

		expect(pointPicker(0)?.textContent).toContain('เลือกจุดรับบริจาค');
		expect(confirmButton().disabled).toBe(true);
	});

	it('a refused line gets no point picker', async () => {
		await render({ ...baseRow, items: [baseRow.items[0]], item_count: 1 });

		const group = document.body.querySelectorAll('[role="group"]')[0];
		await press(group.querySelectorAll('button')[1]);

		expect(pointPicker(0)).toBeNull();
	});

	it.each([
		['a parcel booking', { delivery_method: 'parcel' }, shelterWith(GYM, MED)],
		['a shelter without drop-off points', {}, shelterWith()]
	])('%s approves without a point', async (_label, over, doc) => {
		shelter.doc = doc;
		await render({ ...baseRow, ...over, items: [baseRow.items[0]], item_count: 1 });

		await approve(0);

		expect(pointPicker(0)).toBeNull();
		await press(confirmButton());
		expect(onApprove).toHaveBeenCalledWith('DN-000001', '', [{ index: 0, decision: 'approved' }]);
	});

	it('AC-AP-13b: a line a point already received shows where, read-only, with no picker', async () => {
		await render({
			...baseRow,
			point_receipts: [{ point_id: 'sp-gym', line_nos: [0] }]
		});

		expect(
			document.body.querySelector('[data-testid="review-line-0-received"]')?.textContent
		).toContain('รับแล้วที่ โรงยิม');

		await approve(0);
		await approve(1);
		expect(pointPicker(0)).toBeNull();
		expect(pointPicker(1)).not.toBeNull();
		await choosePoint(1, 'ห้องพยาบาล');
		await press(confirmButton());
		expect(onApprove).toHaveBeenCalledWith('DN-000001', '', [
			{ index: 0, decision: 'approved' },
			{ index: 1, decision: 'approved', drop_off_point_id: 'sp-med' }
		]);
	});

	it('AC-AP-13: an auto-approved campaign line keeps its point read-only', async () => {
		await render({
			...baseRow,
			campaign_id: 'donation_campaign:c1',
			items: [
				{
					item_id: 'item:rice',
					qty: '10',
					unit: 'kg',
					review_status: 'approved',
					reserved_qty: '10',
					drop_off_point_id: 'sp-gym'
				},
				baseRow.items[0]
			]
		});

		expect(
			document.body.querySelector('[data-testid="review-line-0-point"]')?.textContent
		).toContain('โรงยิม');
		expect(pointPicker(0)).toBeNull();
	});
});
