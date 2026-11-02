// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { DonationLotRow } from '../domain/donation-lots';

const lots = vi.hoisted(() => ({
	state: { data: [] as unknown[], isPending: false, isError: false, error: null as Error | null }
}));

vi.mock('../application/queries', () => ({ useDonationLots: () => lots.state }));
vi.mock('../application/use-stock-form-items.svelte', () => ({
	useStockFormItems: () => ({
		items: [{ _id: 'item_master:rice', name: 'ข้าวสาร' }],
		isLoading: false
	})
}));
vi.mock('../application/use-storage-points.svelte', () => ({
	useStoragePoints: () => ({ points: [{ id: 'sp1', name: 'ชั้น B2' }] })
}));
vi.mock('$lib/features/catalog', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/catalog')>()),
	useUnitsOfMeasure: () => ({ data: [] })
}));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

const { default: DonationLotsTable } = await import('./donation-lots-table.svelte');

const lotRow = (over: Partial<DonationLotRow> = {}): DonationLotRow => ({
	ledgerId: 'stock_ledger:1',
	itemId: 'item_master:rice',
	qty: '10',
	unit: 'kg',
	lotNo: 'L-261020-001',
	expiry: '2027-01-31',
	lot: { lot_no: 'L-261020-001', storage_point_id: 'sp1', storage_zone: 'ชั้น B2' },
	remaining: '6',
	...over
});

let instance: ReturnType<typeof mount> | null = null;
function render() {
	instance = mount(DonationLotsTable, {
		target: document.body,
		props: { donationId: 'donation:w001', shelterCode: 'SH001' }
	});
	flushSync();
}
const text = () => document.body.textContent ?? '';
const set = (state: Partial<typeof lots.state>) => Object.assign(lots.state, state);

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
	set({ data: [], isPending: false, isError: false, error: null });
});

describe('DonationLotsTable (#821 FR-12 / FR-13)', () => {
	it('shows item, quantity, lot, expiry, storage point and what is left', () => {
		set({ data: [lotRow()] });
		render();

		const headers = [...document.body.querySelectorAll('th')].map((h) => h.textContent?.trim());
		expect(headers).toEqual(['สินค้า', 'จำนวน', 'ล็อต', 'หมดอายุ', 'จุดจัดเก็บ', 'คงเหลือ']);
		expect(text()).toContain('ข้าวสาร');
		expect(text()).toContain('L-261020-001');
		expect(text()).toContain('2027-01-31');
		expect(text()).toContain('ชั้น B2');
		const cells = [...document.body.querySelectorAll('tbody td')].map((c) =>
			c.textContent?.replace(/\s+/g, ' ').trim()
		);
		expect(cells[1]).toMatch(/^10 /);
		expect(cells[5]).toMatch(/^6 /);
	});

	it('links the lot number to the stock movements filtered to that lot', () => {
		set({ data: [lotRow()] });
		render();

		const link = document.body.querySelector('a') as HTMLAnchorElement;
		expect(link.textContent?.trim()).toBe('L-261020-001');
		const url = new URL(link.getAttribute('href')!, 'http://x');
		expect(url.pathname).toBe('/back-office/supply');
		expect(url.searchParams.get('tab')).toBe('movements');
		expect(url.searchParams.get('range')).toBe('all');
		expect(url.searchParams.get('lq')).toBe('L-261020-001');
	});

	it('shows "—" with no link for a row without lot_no, expiry, or a replayable balance', () => {
		set({ data: [lotRow({ lotNo: null, expiry: null, remaining: null, lot: undefined })] });
		render();

		expect(document.body.querySelector('a')).toBeNull();
		const cells = [...document.body.querySelectorAll('tbody td')].map((c) => c.textContent?.trim());
		expect(cells[2]).toBe('—');
		expect(cells[3]).toBe('—');
		expect(cells[5]).toBe('—');
	});

	it('falls back to the item id when the catalog has no name for it, and to คลังหลัก for no place', () => {
		set({ data: [lotRow({ itemId: 'item_master:unknown', lot: { lot_no: 'L-261020-001' } })] });
		render();

		expect(text()).toContain('item_master:unknown');
		expect(text()).toContain('คลังหลัก');
	});

	it('says so while loading, when it fails, and when the donation has no receipt rows', () => {
		set({ isPending: true });
		render();
		expect(text()).toContain('กำลังโหลดข้อมูลล็อต');
		unmount(instance!);
		document.body.innerHTML = '';

		set({ isPending: false, isError: true, error: new Error('พัง') });
		render();
		expect(text()).toContain('โหลดข้อมูลล็อตไม่สำเร็จ');
		expect(text()).toContain('พัง');
		unmount(instance!);
		document.body.innerHTML = '';

		set({ isError: false, error: null, data: [] });
		render();
		expect(text()).toContain('ใบนี้ไม่มีรายการรับเข้าคลัง');
	});
});
