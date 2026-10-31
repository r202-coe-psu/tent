// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { DonationStore, newDonationItem } from '../../routes/(public)/donations/donation.svelte';
import PublicDonorSuccessTicket from './public-donor-success-ticket.svelte';

const holder = vi.hoisted(() => ({ store: null as unknown }));
vi.mock('../../routes/(public)/donations/donation.svelte', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../routes/(public)/donations/donation.svelte')>()),
	getDonationStore: () => holder.store
}));
vi.mock('$lib/features/catalog', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/catalog')>()),
	useUnitsOfMeasure: () => ({ data: [] })
}));
vi.mock('$lib/features/public-portal', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/public-portal')>()),
	usePublicShelter: () => ({
		data: {
			code: 'SH001',
			name: 'ศูนย์พักพิงหาดใหญ่',
			address: '1 ถ.เพชรเกษม',
			geo: { lat: 7.0086, lng: 100.4747 },
			donation_points: [
				{ id: 'point-gym', name: 'โรงยิม', geo: { lat: 7.009, lng: 100.4752 } },
				{ id: 'point-med', name: 'ห้องพยาบาล', geo: { lat: 7.01, lng: 100.476 } }
			]
		}
	})
}));
vi.mock('$lib/utils/qrcode', () => ({ generateQrDataUrl: async () => '' }));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let instance: ReturnType<typeof mount> | null = null;
let store: DonationStore;

async function render() {
	instance = mount(PublicDonorSuccessTicket, { target: document.body, props: {} });
	flushSync();
	await tick();
}

const groupTitles = () =>
	[...document.body.querySelectorAll('[data-testid="drop-off-group"]')].map(
		(card) => card.querySelector('p')?.textContent?.trim() ?? ''
	);

beforeEach(() => {
	store = new DonationStore();
	store.bookingRef = 'DN-000001';
	store.shelterCode = 'SH001';
	store.items = [
		{ ...newDonationItem({ item_id: 'item:rice', name: 'ข้าวสาร', unit: 'kg' }), amount: 10 },
		{ ...newDonationItem({ name: 'ผ้าห่ม', unit: 'piece' }), amount: 5 }
	];
	holder.store = store;
	vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

// Staff-assigned drop-off FR-AP-8b, FR-AP-22 — the ticket groups the lines the booking returned.
describe('success ticket drop-off groups', () => {
	it('groups the booked lines: the campaign point, then the lines awaiting staff (AC-13)', async () => {
		store.deliveryMethod = 'self_dropoff';
		store.bookedItems = [
			{ drop_off_point_id: 'point-gym', review_status: 'approved' },
			{ drop_off_point_id: null, review_status: 'pending' }
		];
		await render();

		expect(groupTitles()).toEqual(['โรงยิม', 'รอเจ้าหน้าที่กำหนดจุดส่ง']);
		const cards = document.body.querySelectorAll('[data-testid="drop-off-group"]');
		expect(cards[0].textContent).toContain('ข้าวสาร');
		expect(cards[1].textContent).toContain('ผ้าห่ม');
	});

	it('shows the shelter alone for a parcel with nothing to group (AC-9)', async () => {
		store.deliveryMethod = 'parcel';
		store.bookedItems = [
			{ drop_off_point_id: null, review_status: 'pending' },
			{ drop_off_point_id: null, review_status: 'pending' }
		];
		await render();

		expect(groupTitles()).toEqual([]);
	});
});
