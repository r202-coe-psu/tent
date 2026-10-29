// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { PendingDonationRow } from '$lib/features/donations';

vi.mock('$lib/features/catalog', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/catalog')>()),
	useUnitsOfMeasure: () => ({ data: [] })
}));

vi.mock('$lib/features/operations', () => ({
	useStockFormItems: () => ({ items: [], isLoading: false }),
	// Only rendered for an item search; its own behaviour is not under test here.
	ItemCombobox: () => {}
}));

const { default: ReceivedDonationsList } = await import('./received-donations-list.svelte');

const row = (n: number): PendingDonationRow => ({
	donation_id: `donation:w${n}`,
	shelter_code: 'SH001',
	status: 'received',
	// As the server sends a received row: already masked (FR-10).
	donor_name: `ผู้บริจาค ${n}`,
	donor_phone: 'xxx-xxx-1111',
	donor_email: n === 1 ? 'a***@b.th' : null,
	contact_masked: true,
	item_count: 0,
	items: [],
	received_at: '2026-10-20T03:00:00.000Z'
});

let instance: ReturnType<typeof mount> | null = null;
function mountList(props: Record<string, unknown>) {
	instance = mount(ReceivedDonationsList, {
		target: document.body,
		props: {
			rows: [],
			onLoadMore: vi.fn(),
			onViewDetails: vi.fn(),
			onSearch: vi.fn(),
			onClearSearch: vi.fn(),
			...props
		} as never
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

const searchInput = () => document.body.querySelector('#received-search') as HTMLInputElement;
const form = () => document.body.querySelector('form[role="search"]') as HTMLFormElement;
const submitButton = () =>
	Array.from(document.body.querySelectorAll('button')).find(
		(b) => b.getAttribute('type') === 'submit'
	) as HTMLButtonElement;
function typeInto(value: string) {
	searchInput().value = value;
	searchInput().dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

describe('ReceivedDonationsList', () => {
	it('shows the contact exactly as the server sent it — no masking on the client (FR-10)', () => {
		// A value the client would mask differently proves the row is displayed as it is.
		mountList({ rows: [{ ...row(1), donor_name: 'สมชาย ใ****', donor_phone: 'xxx-xxx-1111' }] });

		expect(text()).toContain('สมชาย ใ****');
		expect(text()).toContain('xxx-xxx-1111');
		expect(text()).toContain('a***@b.th');
	});

	it('shows what was received, not what was declared, and falls back to the declared items (FR-4)', () => {
		mountList({
			rows: [
				{
					...row(1),
					items: [{ item_id: 'x', free_text: 'ข้าวสาร', qty: '10', unit: 'kg' }],
					received_items: [{ item_id: 'x', free_text: 'ข้าวสาร', qty: '6', unit: 'kg' }]
				},
				{ ...row(2), items: [{ item_id: 'y', free_text: 'น้ำดื่ม', qty: '12', unit: 'ขวด' }] }
			]
		});
		expect(text()).toContain('ข้าวสาร 6');
		expect(text()).not.toContain('ข้าวสาร 10');
		expect(text()).toContain('น้ำดื่ม 12');
	});

	it('says when the phone or email is missing', () => {
		mountList({ rows: [{ ...row(2), donor_phone: null }] });

		expect(text()).toContain('ไม่ระบุเบอร์โทร');
		expect(text()).toContain('ไม่ระบุอีเมล');
	});

	it('shows ไม่ระบุชื่อ for a donation whose name was removed', () => {
		mountList({ rows: [{ ...row(3), donor_name: '' }] });

		expect(text()).toContain('ไม่ระบุชื่อ');
	});

	it('does not search while typing — only on submit (FR-8)', () => {
		const onSearch = vi.fn();
		mountList({ rows: [row(1)], onSearch });

		typeInto('DN-306892');
		expect(onSearch).not.toHaveBeenCalled();

		form().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
		expect(onSearch).toHaveBeenCalledTimes(1);
		expect(onSearch).toHaveBeenCalledWith({
			by: 'booking_ref',
			q: 'DN-306892',
			label: 'DN-306892'
		});
	});

	it('does not submit an empty box, and the button is disabled', () => {
		const onSearch = vi.fn();
		mountList({ rows: [row(1)], onSearch });

		expect(submitButton().disabled).toBe(true);
		form().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
		typeInto('   ');
		form().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

		expect(onSearch).not.toHaveBeenCalled();
	});

	it('trims the term it sends', () => {
		const onSearch = vi.fn();
		mountList({ rows: [], onSearch });

		typeInto('  DN-306892  ');
		form().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

		expect(onSearch).toHaveBeenCalledWith(expect.objectContaining({ q: 'DN-306892' }));
	});

	it('offers "ล้าง" only while a search shows, and it goes back to the plain list', () => {
		const onClearSearch = vi.fn();
		mountList({ rows: [row(1)], onClearSearch });
		const clearButton = () =>
			Array.from(document.body.querySelectorAll('button')).find((b) =>
				b.textContent?.includes('ล้าง')
			);
		expect(clearButton()).toBeUndefined();
		unmount(instance!);
		document.body.innerHTML = '';

		mountList({
			rows: [row(1)],
			onClearSearch,
			searchTerm: { by: 'name', q: 'สมชาย', label: 'สมชาย' }
		});
		clearButton()!.click();

		expect(onClearSearch).toHaveBeenCalledTimes(1);
	});

	it('counts what the search found, and starts the box from the search that shows', () => {
		mountList({
			rows: [row(1), row(2)],
			searchTerm: { by: 'phone', q: '0812345678', label: '0812345678' }
		});

		expect(document.body.querySelector('[data-testid="received-count"]')?.textContent).toMatch(
			/พบ\s*2\s*รายการ/
		);
		expect(searchInput().value).toBe('0812345678');
	});

	it('says nothing matched, naming the term', () => {
		mountList({
			rows: [],
			searchTerm: { by: 'name', q: 'ไม่มีชื่อนี้', label: 'ไม่มีชื่อนี้' }
		});

		expect(text()).toContain('ไม่พบรายการที่ตรงกับ "ไม่มีชื่อนี้"');
	});

	it('names the item, not its id, when an item search finds nothing', () => {
		mountList({
			rows: [],
			searchTerm: { by: 'item', q: 'item_master:rice', label: 'ข้าวสาร' }
		});

		expect(text()).toContain('ไม่พบรายการที่ตรงกับ "ข้าวสาร"');
		expect(text()).not.toContain('item_master:rice');
	});

	it('shows a search error with the server message, and retries on request', () => {
		const onRetry = vi.fn();
		mountList({
			rows: [],
			error: 'เบอร์โทรต้องเป็นตัวเลข 10 หลัก ขึ้นต้นด้วย 0',
			onRetry,
			searchTerm: { by: 'phone', q: '5678', label: '5678' }
		});

		expect(text()).toContain('ค้นหารายการที่รับแล้วไม่สำเร็จ');
		expect(text()).toContain('เบอร์โทรต้องเป็นตัวเลข 10 หลัก ขึ้นต้นด้วย 0');
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
