// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { PendingDonationRow } from '$lib/features/donations';

vi.mock('$lib/features/catalog', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/catalog')>()),
	useUnitsOfMeasure: () => ({ data: [] })
}));

const { default: ReceivedDonationsList } = await import('./received-donations-list.svelte');

const row = (n: number): PendingDonationRow => ({
	donation_id: `donation:w${n}`,
	shelter_code: 'SH001',
	status: 'received',
	donor_name: `ผู้บริจาค ${n}`,
	donor_phone: '0811111111',
	donor_email: n === 1 ? 'a@b.th' : null,
	item_count: 0,
	items: [],
	received_at: '2026-10-20T03:00:00.000Z'
});

let instance: ReturnType<typeof mount> | null = null;
function mountList(props: Record<string, unknown>) {
	instance = mount(ReceivedDonationsList, {
		target: document.body,
		props: { rows: [], onLoadMore: vi.fn(), onViewDetails: vi.fn(), ...props } as never
	});
	flushSync();
}
const text = () => document.body.textContent ?? '';
const loadMore = () =>
	Array.from(document.body.querySelectorAll('button')).find((b) =>
		b.textContent?.includes('โหลดเพิ่ม')
	);

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('ReceivedDonationsList', () => {
	it('shows the phone and email masked, and says when either is missing', () => {
		mountList({ rows: [row(1), row(2)] });

		expect(text()).toContain('xxx-xxx-1111');
		expect(text()).not.toContain('0811111111');
		expect(text()).toContain('a***@b.th');
		expect(text()).not.toContain('a@b.th');
		expect(text()).toContain('ไม่ระบุอีเมล');
	});

	it('filters the loaded rows by name or phone digits and says how many matched', () => {
		const other = { ...row(2), donor_name: 'นายมานะ', donor_phone: '0899998888' };
		mountList({ rows: [row(1), other], hasMore: true });
		const search = document.body.querySelector('#received-search') as HTMLInputElement;

		search.value = 'มานะ';
		search.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(text()).toContain('นายมานะ');
		expect(text()).not.toContain('ผู้บริจาค 1');
		expect(document.body.querySelector('[data-testid="received-count"]')?.textContent).toMatch(
			/พบ\s*1\s*จาก\s*2/
		);

		search.value = '1111';
		search.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(text()).toContain('ผู้บริจาค 1');
		expect(text()).not.toContain('นายมานะ');
	});

	it('masks the donor surname with **** but still finds them by full name', () => {
		mountList({ rows: [{ ...row(1), donor_name: 'สมชาย ใจดี' }] });

		expect(text()).toContain('สมชาย ใ****');
		expect(text()).not.toContain('ใจดี');

		const search = document.body.querySelector('#received-search') as HTMLInputElement;
		search.value = 'ใจดี';
		search.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(text()).toContain('สมชาย ใ****');
	});

	it('says when nothing matches the search', () => {
		mountList({ rows: [row(1)] });
		const search = document.body.querySelector('#received-search') as HTMLInputElement;

		search.value = 'ไม่มีชื่อนี้';
		search.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(text()).toContain('ไม่พบรายการที่ตรงกับ');
	});

	it('shows "โหลดเพิ่ม" only while the server has more, and asks for the next page', () => {
		const onLoadMore = vi.fn();
		mountList({ rows: [row(1)], hasMore: true, onLoadMore });

		loadMore()?.click();

		expect(onLoadMore).toHaveBeenCalledTimes(1);
	});

	it('hides "โหลดเพิ่ม" at the end of the data', () => {
		mountList({ rows: [row(1)], hasMore: false });

		expect(loadMore()).toBeUndefined();
	});

	it('says so when nothing was received yet, and when loading fails', () => {
		mountList({ rows: [] });
		expect(text()).toContain('ยังไม่มีรายการของบริจาคที่รับแล้ว');
		unmount(instance!);
		document.body.innerHTML = '';

		mountList({ rows: [], error: 'พัง' });
		expect(text()).toContain('พัง');
	});

	it('opens the row it was asked about', () => {
		const onViewDetails = vi.fn();
		mountList({ rows: [row(2)], onViewDetails });

		Array.from(document.body.querySelectorAll('button'))
			.find((b) => b.textContent?.includes('ดูรายละเอียด'))
			?.click();

		expect(onViewDetails).toHaveBeenCalledWith(
			expect.objectContaining({ donation_id: 'donation:w2' })
		);
	});
});
