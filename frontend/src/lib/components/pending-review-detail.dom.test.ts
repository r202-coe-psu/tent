// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { PendingDonationRow } from '$lib/features/donations';
import PendingReviewDetail from './pending-review-detail.svelte';

vi.mock('$lib/features/shelters', () => ({
	useShelters: () => ({ data: [], isPending: false })
}));
vi.mock('$lib/features/catalog', () => ({
	formatUnit: (unit: string) => unit,
	useUnitsOfMeasure: () => ({ data: [] })
}));

const received: PendingDonationRow = {
	donation_id: 'donation:w1',
	shelter_code: 'SH001',
	status: 'received',
	donor_name: 'สมชาย ใจดี',
	donor_phone: '0812345678',
	donor_email: 'somchai@example.com',
	item_count: 1,
	items: [{ item_id: 'item:rice', qty: '10', unit: 'kg' }],
	received_at: '2026-10-20T03:00:00.000Z'
};

let instance: ReturnType<typeof mount> | null = null;
function render(props: { readonly?: boolean }) {
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

afterEach(() => {
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

	it('masks the donor name and contact until staff ask to see them', () => {
		render({ readonly: true });

		const text = () => document.body.textContent ?? '';
		expect(text()).toContain('สมชาย ใ****');
		expect(text()).not.toContain('ใจดี');
		expect(text()).not.toContain('0812345678');
		expect(text()).not.toContain('somchai@example.com');
		expect(document.body.querySelector('a[href^="tel:"]')).toBeNull();

		const reveal = [...document.body.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('แสดงข้อมูลติดต่อ')
		)!;
		reveal.click();
		flushSync();

		expect(text()).toContain('สมชาย ใจดี');
		expect(text()).toContain('0812345678');
		expect(text()).toContain('somchai@example.com');
		expect(document.body.querySelector('a[href="tel:0812345678"]')).not.toBeNull();
	});

	it('shows the full contact straight away in the review queue', () => {
		render({});

		expect(document.body.textContent).toContain('สมชาย ใจดี');
		expect(document.body.textContent).toContain('0812345678');
		expect(
			[...document.body.querySelectorAll('button')].some((b) =>
				b.textContent?.includes('แสดงข้อมูลติดต่อ')
			)
		).toBe(false);
	});

	it('regression: without readonly the review actions are still there', () => {
		render({});

		expect(buttonLabels().join('|')).toContain('ปฏิเสธคำขอ');
		expect(document.body.querySelector('#internal-review-memo')).not.toBeNull();
	});
});
