import { beforeEach, describe, expect, it, vi } from 'vitest';

const scrollAppToTop = vi.fn();

vi.mock('$lib/utils/scroll-app-to-top', () => ({
	scrollAppToTop: () => scrollAppToTop()
}));

const { DonationStore, newDonationItem } = await import('./donation.svelte');

describe('DonationStore.goToStep', () => {
	beforeEach(() => {
		scrollAppToTop.mockReset();
	});

	it('switches the step and scrolls the page back to the top', async () => {
		const store = new DonationStore();

		store.goToStep('form');

		expect(store.activeTab).toBe('form');
		await vi.waitFor(() => expect(scrollAppToTop).toHaveBeenCalledTimes(1));
	});

	it('scrolls on the way back too', async () => {
		const store = new DonationStore();
		store.goToStep('time');
		await vi.waitFor(() => expect(scrollAppToTop).toHaveBeenCalledTimes(1));

		store.goToStep('form');

		expect(store.activeTab).toBe('form');
		await vi.waitFor(() => expect(scrollAppToTop).toHaveBeenCalledTimes(2));
	});

	it('reset() returns to the needs board at the top of the page', async () => {
		const store = new DonationStore();
		store.goToStep('ticket');
		await vi.waitFor(() => expect(scrollAppToTop).toHaveBeenCalledTimes(1));

		store.reset();

		expect(store.activeTab).toBe('needs');
		await vi.waitFor(() => expect(scrollAppToTop).toHaveBeenCalledTimes(2));
	});
});

describe('donation item defaults (#822)', () => {
	const need = {
		item_id: 'item:egg',
		category: 'food',
		name: 'ไข่ไก่',
		unit: 'ฟอง',
		unit_code: 'piece',
		qty_needed: 365
	};

	it('starts a need-derived line at 0 and keeps the shortfall as a hint', () => {
		const item = newDonationItem(need);
		expect(item.amount).toBe(0);
		expect(item.needQty).toBe(365);
		expect(item.item_id).toBe('item:egg');
		expect(item.unit).toBe('ฟอง');
		expect(item.unit_code).toBe('piece');
	});

	it.each([0, -3, undefined])('has no hint and amount 0 when qty_needed is %s', (qty_needed) => {
		const item = newDonationItem({ ...need, qty_needed });
		expect(item.amount).toBe(0);
		expect(item.needQty).toBeUndefined();
	});

	it('starts an "other items" line at 0 without a hint', () => {
		const item = newDonationItem();
		expect(item.amount).toBe(0);
		expect(item.needQty).toBeUndefined();
		expect(item.name).toBe('');
		expect(item.category).toBe('food');
		expect(item.unit).toBe('piece');
	});

	it('initial store item is 0', () => {
		const store = new DonationStore();
		expect(store.items).toHaveLength(1);
		expect(store.items[0].amount).toBe(0);
	});

	it('addItem() pushes a 0 line with a fresh id', () => {
		const store = new DonationStore();
		store.addItem();
		expect(store.items).toHaveLength(2);
		expect(store.items[1].amount).toBe(0);
		expect(store.items[1].id).not.toBe(store.items[0].id);
	});

	it('reset() restores a single 0 line', () => {
		const store = new DonationStore();
		store.items[0].amount = 9;
		store.addItem();
		store.reset();
		expect(store.items).toHaveLength(1);
		expect(store.items[0].amount).toBe(0);
	});
	// Staff-assigned drop-off FR-AP-8b — the booked lines go with the booking they came from.
	it('reset() forgets the booked lines with the tracking token', () => {
		const store = new DonationStore();
		store.trackingToken = 'TX-SH001-ABC';
		store.bookedItems = [{ drop_off_point_id: 'point-gym', review_status: 'approved' }];
		store.reset();
		expect(store.trackingToken).toBe('');
		expect(store.bookedItems).toEqual([]);
	});
});
