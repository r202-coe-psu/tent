// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { DonationStore, newDonationItem } from '../../../routes/(public)/donations/donation.svelte';
import DonorTimeSelectionForm from './donor-time-selection-form.svelte';

const holder = vi.hoisted(() => ({
	store: null as unknown,
	mapProps: null as null | { focusPointId?: string | null }
}));
vi.mock('../../../routes/(public)/donations/donation.svelte', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../../routes/(public)/donations/donation.svelte')>()),
	getDonationStore: () => holder.store
}));
vi.mock('$lib/features/catalog', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/catalog')>()),
	useUnitsOfMeasure: () => ({ data: [] })
}));
vi.mock('$lib/features/donations', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/donations')>()),
	useDonationSlots: () => ({ isSuccess: true, isLoading: false, isError: false, data: [] })
}));
// The real map needs a QueryClient and Leaflet; what the form hands it is under test.
vi.mock('$lib/features/public-portal', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/public-portal')>()),
	DropOffShelterMap: (_anchor: unknown, props: { focusPointId?: string | null }) => {
		holder.mapProps = props;
	},
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
vi.mock('$lib/api/recaptcha-status', () => ({ fetchRecaptchaEnabled: async () => false }));
vi.mock('$lib/api/recaptcha-script', () => ({ ensureRecaptchaLoaded: async () => {} }));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let instance: ReturnType<typeof mount> | null = null;
let store: DonationStore;

async function render() {
	instance = mount(DonorTimeSelectionForm, { target: document.body, props: {} });
	flushSync();
	await tick();
}

const groups = () =>
	[...document.body.querySelectorAll('[data-testid="drop-off-group"]')].map((card) => ({
		title: card.querySelector('p')?.textContent?.trim() ?? '',
		text: card.textContent ?? ''
	}));

beforeEach(() => {
	store = new DonationStore();
	store.shelterCode = 'SH001';
	store.selectedShelterName = 'ศูนย์พักพิงหาดใหญ่';
	store.deliveryMethod = 'self_dropoff';
	holder.store = store;
	holder.mapProps = null;
	vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

// CR-206 A2 FR-AP-11, FR-AP-12, FR-AP-12a — step 3 shows each line's point, read-only.
describe('donor time form — drop-off points per line', () => {
	it('groups a card line at its point and a typed line awaiting staff (AC-AP-3, AC-AP-4h)', async () => {
		store.items = [
			{
				...newDonationItem({
					item_id: 'item:rice',
					name: 'ข้าวสาร',
					needDropOffPointId: 'point-med'
				}),
				amount: 5
			},
			{ ...newDonationItem({ name: 'ผ้าห่ม' }), amount: 2 }
		];
		await render();

		const shown = groups();
		expect(shown.map((g) => g.title)).toEqual(['ห้องพยาบาล', 'รอเจ้าหน้าที่กำหนดจุดส่ง']);
		expect(shown[0].text).toContain('ข้าวสาร');
		expect(shown[1].text).toContain('ผ้าห่ม');
		// Read-only: no select, no radio, no "tracking page will say" note.
		expect(document.body.querySelector('[data-testid="drop-off-points-by-staff"]')).toBeNull();
		expect(
			document.body.querySelector(
				'[data-testid="drop-off-groups"] select, [data-testid="drop-off-groups"] input'
			)
		).toBeNull();
	});

	it('zooms the map to the first group that has a point (FR-AP-12)', async () => {
		store.items = [
			{ ...newDonationItem({ name: 'ผ้าห่ม' }), amount: 2 },
			{
				...newDonationItem({
					item_id: 'item:rice',
					name: 'ข้าวสาร',
					needDropOffPointId: 'point-gym'
				}),
				amount: 5
			}
		];
		await render();

		expect(holder.mapProps?.focusPointId).toBe('point-gym');
	});

	it('puts a card with no point in the any-point group and leaves the map unfocused (AC-AP-4g)', async () => {
		store.items = [
			{
				...newDonationItem({ item_id: 'item:rice', name: 'ข้าวสาร', needDropOffPointId: null }),
				amount: 5
			}
		];
		await render();

		expect(groups().map((g) => g.title)).toEqual(['ส่งที่จุดรับบริจาคไหนของศูนย์ก็ได้']);
		expect(holder.mapProps?.focusPointId ?? null).toBeNull();
	});

	it('shows no points when the delivery is not a self drop-off (AC-AP-4h)', async () => {
		store.deliveryMethod = 'parcel';
		store.items = [{ ...newDonationItem({ name: 'ผ้าห่ม' }), amount: 2 }];
		await render();

		expect(groups()).toEqual([]);
		expect(holder.mapProps).toBeNull();
	});
});
