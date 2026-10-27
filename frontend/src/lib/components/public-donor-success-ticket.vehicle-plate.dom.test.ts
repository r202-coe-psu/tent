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

describe('success ticket vehicle plate', () => {
	it('shows the typed plate for a self drop-off, without fetching', async () => {
		store.deliveryMethod = 'self_dropoff';
		store.vehicleType = 'car';
		store.vehiclePlate = '  กข 1234 ';
		await render();
		expect(document.body.textContent).toContain('กข 1234');
		expect(fetch).not.toHaveBeenCalled();
	});

	it('shows nothing extra when there is no plate', async () => {
		store.deliveryMethod = 'self_dropoff';
		store.vehiclePlate = '   ';
		await render();
		expect(document.body.textContent).not.toContain('ทะเบียนรถ');
	});

	it('hides a typed plate once the donor switched to another delivery method', async () => {
		store.deliveryMethod = 'parcel';
		store.vehiclePlate = 'กข 1234';
		await render();
		expect(document.body.textContent).not.toContain('กข 1234');
	});
});
