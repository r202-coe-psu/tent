// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { InvalidRatioQtyError } from '../domain/qty-input';

const state = vi.hoisted(() => ({
	error: null as Error | null,
	build: vi.fn(() => ({
		groups: [],
		summary: {
			totalItems: 0,
			criticalCount: 0,
			warningCount: 0,
			adequateCount: 0,
			overstockCount: 0,
			unconfiguredCount: 0
		}
	}))
}));
const ok = <T>(data: T) => ({ data, isLoading: false, isError: false, error: null });
vi.mock('$lib/features/catalog', () => ({
	useItemMasters: () => ok([]),
	useUnitsOfMeasure: () => ok([]),
	formatUnit: (v: string) => v
}));
vi.mock('$lib/features/supply', () => ({ useSupplyItems: () => ok([]) }));
vi.mock('$lib/features/operations', () => ({
	useStockBalance: () => ok(new Map()),
	useLedger: () => ok([]),
	useStoragePoints: () => ({ points: [] }),
	lotStorageName: () => null
}));
vi.mock('../application/food-sphere-queries', () => ({
	useFoodSphereStandards: () => ({ ...ok([]), error: state.error, isError: !!state.error })
}));
vi.mock('../application/requirement-group-queries', () => ({ useRequirementGroups: () => ok([]) }));
vi.mock('../application/replenishment-queries', () => ({ useReplenishmentPolicies: () => ok([]) }));
vi.mock('../application/shelter-people-queries', () => ({
	useShelterPeopleCounts: () => ok({ evacuees: 0, staff: 0, volunteers: 0 })
}));
vi.mock('$lib/features/dashboard', () => ({
	useDashboardDemographics: () => ok(null),
	useDashboardOccupancy: () => ok(null)
}));
vi.mock('$lib/stores/shelter.svelte', () => ({ shelterStore: { selectedShelterCode: 'SH001' } }));
vi.mock('$lib/stores/auth.svelte', () => ({ authStore: { user: { roles: [] } } }));
vi.mock('$lib/states/i18n.svelte', () => ({ langState: { current: 'th' } }));
vi.mock('$lib/auth/roles', () => ({
	canEditStockParameters: () => false,
	isSystemAdmin: () => false
}));
vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('../domain/food-sphere-table', () => ({
	buildFoodSphereTable: state.build,
	InvalidStockQtyError: class extends Error {}
}));
vi.mock('./stock-parameters-sheet.svelte', () => import('./stock-test-empty.svelte'));
vi.mock('./requirement-group-edit-sheet.svelte', () => import('./stock-test-empty.svelte'));
vi.mock('./people-total-tooltip.svelte', () => import('./stock-test-empty.svelte'));
import FoodSphereStockTab from './food-sphere-stock-tab.svelte';
let component: ReturnType<typeof mount> | undefined;
afterEach(() => {
	if (component) unmount(component);
	component = undefined;
	document.body.innerHTML = '';
	state.error = null;
	state.build.mockClear();
});
async function render() {
	component = mount(FoodSphereStockTab, { target: document.body });
	flushSync();
	await tick();
}
it('blocks results on invalid data, identifies the field, and recovers when corrected', async () => {
	state.error = new InvalidRatioQtyError('food_sphere_standard:X', 'daily_demand');
	await render();
	expect(document.querySelector('[role="alert"]')?.textContent).toContain('food_sphere_standard:X');
	expect(document.querySelector('[role="alert"]')?.textContent).toContain('daily_demand');
	expect(document.querySelector('[aria-label="สรุปสถานะเสบียง"]')).toBeNull();
	expect(state.build).not.toHaveBeenCalled();
	unmount(component!);
	component = undefined;
	document.body.innerHTML = '';
	state.error = null;
	await render();
	expect(state.build).toHaveBeenCalled();
	expect(document.querySelector('[role="alert"]')).toBeNull();
	expect(document.querySelector('[aria-label="สรุปสถานะเสบียง"]')).not.toBeNull();
});
