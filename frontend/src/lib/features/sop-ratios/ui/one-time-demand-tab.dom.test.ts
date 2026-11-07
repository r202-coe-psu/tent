// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

const ok = <T>(data: T) => ({
	data,
	isSuccess: true,
	isPending: false,
	isLoading: false,
	isError: false
});

const oneTime = (_id: string, name: string, shelter_code?: string) => ({
	_id,
	name,
	base_unit: 'piece',
	distribution_type: 'one_time',
	qty_per_person: 1,
	...(shelter_code ? { shelter_code } : {})
});

const central = oneTime('item_master:net', 'มุ้งกลาง');
const local = oneTime('item_master:local-tent', 'เต็นท์ของศูนย์', 'SH001');

const useItemMasters = vi.fn((shelterCode: () => string | null = () => null) =>
	ok(shelterCode() === 'SH001' ? [central, local] : [central])
);

vi.mock('$lib/features/catalog', () => ({
	useItemMasters: (...args: Parameters<typeof useItemMasters>) => useItemMasters(...args),
	useItemCategories: () => ok([]),
	useUnitsOfMeasure: () => ok([]),
	formatUnit: (unit: string) => unit
}));
vi.mock('$lib/features/operations', () => ({
	useLedgerByItems: () => ok([]),
	useLotReservationClaims: () => ok([]),
	projectStockLotBalances: () => []
}));
vi.mock('$lib/features/distribution', () => ({ useItemRecipients: () => ok([]) }));
vi.mock('../application/shelter-people-queries', () => ({
	useShelterPeopleCounts: () =>
		ok({ evacuees: 10, staff: 1, volunteers: 1, total: 12, evacueeIds: [] })
}));
vi.mock('$lib/states/i18n.svelte', () => ({ langState: { current: 'th' } }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

import OneTimeDemandTab from './one-time-demand-tab.svelte';

let component: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (component) unmount(component);
	component = undefined;
	document.body.innerHTML = '';
	useItemMasters.mockClear();
});

async function render(shelterCode: string) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	component = mount(OneTimeDemandTab, { target, props: { shelterCode } });
	flushSync();
	await tick();
	return target.textContent ?? '';
}

describe('OneTimeDemandTab item scope', () => {
	it("lists the shelter's own one-time items next to the central ones", async () => {
		const text = await render('SH001');
		expect(text).toContain('มุ้งกลาง');
		expect(text).toContain('เต็นท์ของศูนย์');
		expect(useItemMasters.mock.calls.every(([getter]) => getter?.() === 'SH001')).toBe(true);
	});
});
