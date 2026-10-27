import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/utils/scroll-app-to-top', () => ({ scrollAppToTop: vi.fn() }));

const { buildDonationItemsPayload } = await import('./donation-payload');
const { newDonationItem } = await import('./donation.svelte');

const t = { unspecified: 'ไม่ระบุ', defaultItemUnit: 'piece' };
const line = (amount: number) => ({ ...newDonationItem({ name: 'ข้าวสาร' }), amount });

describe('buildDonationItemsPayload', () => {
	it('sends the typed amount as qty', () => {
		expect(buildDonationItemsPayload([line(3)], t)[0].qty).toBe(3);
		expect(buildDonationItemsPayload([line(5)], t)[0].qty).toBe(5);
	});

	it('never coerces 0 to 1', () => {
		expect(buildDonationItemsPayload([line(0)], t)[0].qty).toBe(0);
	});

	it('does not fabricate an item for an empty list', () => {
		expect(buildDonationItemsPayload([], t)).toEqual([]);
	});

	it('keeps the existing mapping and never sends needQty', () => {
		const item = { ...newDonationItem({ name: '', qty_needed: 365 }), amount: 5 };
		const [p] = buildDonationItemsPayload([item], t);
		expect(p.free_text).toBe('ไม่ระบุ');
		expect(p.item_id).toBeUndefined();
		expect(p.condition).toBe('new');
		expect(p.note).toBeUndefined();
		expect(p).not.toHaveProperty('needQty');
	});
});
