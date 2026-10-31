// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type { PendingDonationRow } from '$lib/features/donations';
import PendingReviewDetail from './pending-review-detail.svelte';

vi.mock('$lib/features/shelters', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/shelters')>()),
	useShelters: () => ({ data: [] }),
	useShelter: () => ({ data: undefined, isSuccess: true })
}));
vi.mock('$lib/features/catalog', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/catalog')>()),
	useUnitsOfMeasure: () => ({ data: [] })
}));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const baseRow: PendingDonationRow = {
	booking_ref: 'DN-000001',
	shelter_code: 'SH001',
	status: 'pending_review',
	donor_name: 'ผู้บริจาค',
	donor_phone: '0800000001',
	item_count: 1,
	items: [{ free_text: 'น้ำดื่ม', qty: '5', unit: 'ลัง', review_status: 'pending' }],
	delivery_method: 'self_dropoff',
	vehicle: 'car',
	point_receipts: []
};

let instance: ReturnType<typeof mount> | null = null;

async function render(row: PendingDonationRow) {
	instance = mount(PendingReviewDetail, {
		target: document.body,
		props: { request: row, onBack: () => {}, onApprove: () => {}, onReject: () => {} }
	});
	flushSync();
	await tick();
}

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('PendingReviewDetail vehicle plate', () => {
	it('shows the plate under the vehicle type', async () => {
		await render({ ...baseRow, vehicle_plate: 'กข 1234 กรุงเทพมหานคร' });
		expect(document.body.textContent).toContain('ทะเบียน กข 1234 กรุงเทพมหานคร');
		expect(document.body.textContent).toContain('รถยนต์ส่วนบุคคล');
	});

	it.each([null, undefined])('shows no plate line when vehicle_plate is %s (v7 doc)', async (v) => {
		await render({ ...baseRow, vehicle_plate: v });
		expect(document.body.textContent).not.toContain('ทะเบียน');
		expect(document.body.textContent).toContain('รถยนต์ส่วนบุคคล');
	});
});
