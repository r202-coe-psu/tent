// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { DonationStore } from '../../routes/(public)/donations/donation.svelte';
import PublicDonorNeeds from './public-donor-needs.svelte';

const holder = vi.hoisted(() => ({ store: null as unknown }));
vi.mock('../../routes/(public)/donations/donation.svelte', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../routes/(public)/donations/donation.svelte')>()),
	getDonationStore: () => holder.store
}));
// The map needs a QueryClient and Leaflet; the board's cards are what is under test.
vi.mock('$lib/features/public-portal', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/public-portal')>()),
	DonationNeedsMap: () => {}
}));
vi.mock('$lib/features/catalog', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/catalog')>()),
	useUnitsOfMeasure: () => ({ data: [] })
}));

// CR-206 A2 FR-AP-28 — one card per item + drop-off point.
const board = [
	{
		code: 'SH001',
		name: 'ศูนย์พักพิงหาดใหญ่',
		needs: [
			{
				item_id: 'item:rice',
				name: 'ข้าวสาร',
				unit: 'kg',
				qty_needed: '30',
				status: 'open',
				urgency: 'critical',
				drop_off_point_id: 'point-gym',
				drop_off_point_name: 'โรงยิม'
			},
			{
				item_id: 'item:rice',
				name: 'ข้าวสาร',
				unit: 'kg',
				qty_needed: '20',
				status: 'open',
				urgency: 'critical',
				drop_off_point_id: 'point-med',
				drop_off_point_name: 'ห้องพยาบาล'
			},
			{
				item_id: 'item:soap',
				name: 'สบู่',
				unit: 'bar',
				qty_needed: '10',
				status: 'open',
				urgency: 'normal',
				drop_off_point_id: null,
				drop_off_point_name: null
			}
		]
	}
];

let instance: ReturnType<typeof mount> | null = null;
let store: DonationStore;

async function render() {
	instance = mount(PublicDonorNeeds, { target: document.body, props: {} });
	flushSync();
	await vi.waitFor(() => expect(document.body.textContent).toContain('จุดรับบริจาค'));
	await tick();
}

const donateButtons = () =>
	[...document.body.querySelectorAll('button')].filter((b) =>
		b.textContent?.includes('บริจาครายการนี้')
	);

beforeEach(() => {
	store = new DonationStore();
	store.activeTab = 'shelter-details';
	store.selectedShelterForNeeds = 'SH001';
	holder.store = store;
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => ({ ok: true, json: async () => board }))
	);
});

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

describe('public donor needs board — cards per item and drop-off point', () => {
	it('shows one card per row and names the point only when there is one (FR-AP-28, AC-AP-4g)', async () => {
		await render();

		const points = [...document.body.querySelectorAll('[data-testid="need-drop-off-point"]')].map(
			(el) => el.textContent?.trim()
		);
		expect(points).toEqual(['จุดรับบริจาค: โรงยิม', 'จุดรับบริจาค: ห้องพยาบาล']);
		expect(donateButtons()).toHaveLength(3);
	});

	it("keeps the pressed card's point on the line (FR-AP-13)", async () => {
		await render();

		donateButtons()[1].click();
		flushSync();

		expect(store.items).toHaveLength(1);
		expect(store.items[0]).toMatchObject({
			item_id: 'item:rice',
			needDropOffPointId: 'point-med'
		});
	});

	it('keeps null for a card with no point', async () => {
		await render();

		donateButtons()[2].click();
		flushSync();

		expect(store.items[0]).toMatchObject({ item_id: 'item:soap', needDropOffPointId: null });
	});
});

describe('public donor needs board — shelter progress', () => {
	it('counts stock on hand once per item, however many point cards it has (FR-AP-25)', async () => {
		const rice = {
			item_id: 'item:rice',
			name: 'ข้าวสาร',
			unit: 'kg',
			qty_needed: '30',
			qty_target: '50',
			on_hand: '40',
			reserved: '0',
			status: 'open',
			urgency: 'critical'
		};
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				ok: true,
				json: async () => [
					{
						code: 'SH001',
						name: 'ศูนย์พักพิงหาดใหญ่',
						needs: [
							{ ...rice, drop_off_point_id: 'point-gym', drop_off_point_name: 'โรงยิม' },
							{ ...rice, drop_off_point_id: 'point-med', drop_off_point_name: 'ห้องพยาบาล' }
						]
					}
				]
			}))
		);
		store.activeTab = 'needs';
		instance = mount(PublicDonorNeeds, { target: document.body, props: {} });
		flushSync();

		// target 50 + 50, on hand 40 once (not 40 + 40): 40%.
		await vi.waitFor(() =>
			expect(document.body.textContent).toContain('ต้องการ 1 รายการ · คืบหน้าแล้ว 40% ของเป้าหมาย')
		);
	});
});
