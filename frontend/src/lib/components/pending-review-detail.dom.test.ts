// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type { PendingDonationRow } from '$lib/features/donations';
import PendingReviewDetail from './pending-review-detail.svelte';

const reveal = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));
const toastError = vi.hoisted(() => vi.fn());
const lotsProps = vi.hoisted(() => ({ calls: [] as unknown[] }));

vi.mock('$lib/features/donations', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/donations')>()),
	useRevealDonorContact: () => reveal
}));
vi.mock('$lib/features/operations', () => ({
	// The lots table has its own tests; here only whether and for what it is mounted.
	DonationLotsTable: (_anchor: unknown, props: unknown) => {
		lotsProps.calls.push(props);
	},
	// Catalog names for lines that carry only an item_id (a walk-in).
	useStockFormItems: () => ({ items: [{ _id: 'item:rice', name: 'ข้าวสาร' }] })
}));
vi.mock('svelte-sonner', () => ({ toast: { error: toastError, success: vi.fn() } }));

vi.mock('$lib/features/shelters', () => ({
	useShelters: () => ({ data: [], isPending: false }),
	useShelter: () => ({ data: undefined, isSuccess: true }),
	listDonationPoints: () => []
}));
vi.mock('$lib/features/catalog', () => ({
	formatUnit: (unit: string) => unit,
	useUnitsOfMeasure: () => ({ data: [] })
}));

// What the list route sends for a received donation: the contact is already masked (FR-10).
const received: PendingDonationRow = {
	donation_id: 'donation:w1',
	shelter_code: 'SH001',
	status: 'received',
	donor_name: 'สมชาย ใ****',
	donor_phone: 'xxx-xxx-5678',
	donor_email: 's***i@example.com',
	contact_masked: true,
	item_count: 1,
	items: [{ item_id: 'item:rice', qty: '10', unit: 'kg' }],
	point_receipts: [],
	received_at: '2026-10-20T03:00:00.000Z'
};

let instance: ReturnType<typeof mount> | null = null;
function render(props: { readonly?: boolean; request?: PendingDonationRow }) {
	instance = mount(PendingReviewDetail, {
		target: document.body,
		props: {
			request: received,
			onBack: vi.fn(),
			onApprove: vi.fn(),
			onReject: vi.fn(),
			...props
		}
	});
	flushSync();
}
const buttonLabels = () =>
	Array.from(document.body.querySelectorAll('button')).map((b) => b.textContent?.trim() ?? '');

const FULL = { name: 'สมชาย ใจดี', phone: '0812345678', email: 'somchai@example.com' };
const text = () => document.body.textContent ?? '';
const revealButton = () =>
	[...document.body.querySelectorAll('button')].find((b) =>
		b.textContent?.includes('แสดงข้อมูลติดต่อ')
	)!;

afterEach(() => {
	reveal.mutateAsync.mockReset();
	toastError.mockReset();
	lotsProps.calls.length = 0;
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('PendingReviewDetail readonly (a received donation)', () => {
	it('offers no approve, reject or redirect action', () => {
		render({ readonly: true });

		const labels = buttonLabels().join('|');
		expect(labels).not.toContain('ปฏิเสธ');
		expect(labels).not.toContain('อนุมัติ');
		expect(labels).not.toContain('ประสานงานส่งต่อ');
		expect(labels).not.toContain('บันทึกผล');
		expect(document.body.querySelector('#internal-review-memo')).toBeNull();
		// Back is the one way out.
		expect(labels).toContain('กลับหน้าตรวจรับบริจาค');
	});

	it('names a line that carries only an item_id from the catalog, not the raw id (walk-in)', () => {
		render({ readonly: true });

		const text = document.body.textContent ?? '';
		expect(text).toContain('ข้าวสาร');
		expect(text).not.toContain('item:rice');
	});

	it('shows the masked contact the server sent, and asks for nothing until pressed', () => {
		render({ readonly: true });

		expect(text()).toContain('สมชาย ใ****');
		expect(text()).toContain('xxx-xxx-5678');
		expect(text()).toContain('s***i@example.com');
		expect(text()).not.toContain('ใจดี');
		expect(text()).not.toContain('0812345678');
		expect(document.body.querySelector('a[href^="tel:"]')).toBeNull();
		expect(reveal.mutateAsync).not.toHaveBeenCalled();
	});

	it('FR-6 / FR-10a: "แสดงข้อมูลติดต่อ" fetches the full contact for this donation and shows it', async () => {
		reveal.mutateAsync.mockResolvedValue(FULL);
		render({ readonly: true });

		revealButton().click();
		await tick();
		flushSync();

		expect(reveal.mutateAsync).toHaveBeenCalledTimes(1);
		expect(reveal.mutateAsync).toHaveBeenCalledWith('donation:w1');
		expect(text()).toContain('สมชาย ใจดี');
		expect(text()).toContain('0812345678');
		expect(text()).toContain('somchai@example.com');
		expect(document.body.querySelector('a[href="tel:0812345678"]')).not.toBeNull();
		// Revealed: the button is gone, so one press is one audited call.
		expect(
			[...document.body.querySelectorAll('button')].some((b) =>
				b.textContent?.includes('แสดงข้อมูลติดต่อ')
			)
		).toBe(false);
	});

	it('addresses a counter-keyed donation by its booking_ref when it has one', async () => {
		reveal.mutateAsync.mockResolvedValue(FULL);
		instance = mount(PendingReviewDetail, {
			target: document.body,
			props: {
				request: { ...received, booking_ref: 'DN-306892' },
				readonly: true,
				onBack: vi.fn(),
				onApprove: vi.fn(),
				onReject: vi.fn()
			}
		});
		flushSync();

		revealButton().click();
		await tick();

		expect(reveal.mutateAsync).toHaveBeenCalledWith('DN-306892');
	});

	it('FR-10c: when retention removed the contact it says so instead of showing blanks', async () => {
		reveal.mutateAsync.mockResolvedValue({ name: null, phone: null, email: null });
		render({ readonly: true });

		revealButton().click();
		await tick();
		flushSync();

		expect(text()).toContain('ข้อมูลติดต่อถูกลบตามนโยบายการเก็บข้อมูล');
		expect(text()).not.toContain('xxx-xxx-5678');
	});

	it('toasts the error and keeps the masked contact when the request fails', async () => {
		reveal.mutateAsync.mockRejectedValue(new Error('ไม่มีสิทธิ์ดูข้อมูลติดต่อของรายการนี้'));
		render({ readonly: true });

		revealButton().click();
		await tick();
		flushSync();

		expect(toastError).toHaveBeenCalledWith('ไม่มีสิทธิ์ดูข้อมูลติดต่อของรายการนี้');
		expect(text()).toContain('xxx-xxx-5678');
		expect(text()).not.toContain('0812345678');
		expect(revealButton()).toBeDefined();
	});

	it('FR-7: the review queue shows the full contact from the row, with no button and no request', () => {
		render({
			request: {
				...received,
				donor_name: 'สมชาย ใจดี',
				donor_phone: '0812345678',
				donor_email: 'somchai@example.com',
				contact_masked: undefined
			}
		});

		expect(text()).toContain('สมชาย ใจดี');
		expect(text()).toContain('0812345678');
		expect(text()).toContain('somchai@example.com');
		expect(document.body.querySelector('a[href="tel:0812345678"]')).not.toBeNull();
		expect(
			[...document.body.querySelectorAll('button')].some((b) =>
				b.textContent?.includes('แสดงข้อมูลติดต่อ')
			)
		).toBe(false);
		expect(reveal.mutateAsync).not.toHaveBeenCalled();
	});

	it('FR-12: mounts the lots of the donation in the read-only detail only', () => {
		render({ readonly: true });
		expect(lotsProps.calls).toEqual([{ donationId: 'donation:w1', shelterCode: 'SH001' }]);
		unmount(instance!);
		instance = null;
		document.body.innerHTML = '';
		lotsProps.calls.length = 0;

		render({});
		expect(lotsProps.calls).toEqual([]);
	});

	it('regression: without readonly the review actions are still there', () => {
		render({});

		expect(buttonLabels().join('|')).toContain('ปฏิเสธคำขอ');
		expect(document.body.querySelector('#internal-review-memo')).not.toBeNull();
	});
});
