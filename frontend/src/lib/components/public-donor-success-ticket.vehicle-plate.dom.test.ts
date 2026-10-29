// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { DonationStore } from '../../routes/(public)/donations/donation.svelte';
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
	usePublicShelter: () => ({ data: undefined })
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

beforeEach(() => {
	store = new DonationStore();
	store.bookingRef = 'DN-000001';
	holder.store = store;
	vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

describe('success ticket vehicle plate (CR-209 FR-3a)', () => {
	it('shows the plate the booking sent, without fetching', async () => {
		store.deliveryMethod = 'self_dropoff';
		store.vehicleType = 'car';
		store.bookedVehiclePlate = 'กข 1234';
		await render();
		expect(document.body.textContent).toContain('กข 1234');
		expect(fetch).not.toHaveBeenCalled();
	});

	it('shows nothing extra when the booking sent no plate', async () => {
		store.deliveryMethod = 'self_dropoff';
		await render();
		expect(document.body.textContent).not.toContain('ทะเบียนรถ');
	});

	it('ignores a plate still typed in the form that the booking did not send', async () => {
		// Booked by parcel, then went back and switched to self drop-off without re-submitting.
		store.deliveryMethod = 'self_dropoff';
		store.vehiclePlate = 'กข 1234';
		store.bookedVehiclePlate = '';
		await render();
		expect(document.body.textContent).not.toContain('กข 1234');
	});
});
