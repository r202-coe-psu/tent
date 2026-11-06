// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import StockTable from './stock-table.svelte';

const mocks = vi.hoisted(() => ({ roles: [] as string[] }));

const q = <T>(data: T) => ({ data, isLoading: false });

vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: {
		get user() {
			return { roles: mocks.roles };
		},
		needsReauth: false
	}
}));
vi.mock('../application/queries', () => ({
	useStockBalance: () => q(new Map([['item_master:rice', '10']])),
	useLedger: () =>
		q([
			{
				_id: 'stock_ledger:01J8Z9K5N7QXR3T6V8W0Y2A4B6',
				type: 'stock_ledger',
				schema_v: 6,
				shelter_code: 'SH001',
				item_id: 'item_master:rice',
				qty: '10',
				unit: 'kg',
				reason: 'donation',
				created_at: '2026-11-01T00:00:00.000Z',
				updated_at: '2026-11-01T00:00:00.000Z',
				created_by: 'don'
			}
		]),
	useCrossShelterStockBalances: () => q([]),
	useCrossShelterLedger: () => q([])
}));
vi.mock('$lib/features/supply', () => ({
	useSupplyItems: () => q([]),
	useThresholdOverrides: () => q([]),
	SUPPLY_CATEGORY_LABELS: {}
}));
vi.mock('$lib/features/catalog', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/catalog')>()),
	useItemMasters: () =>
		q([
			{
				_id: 'item_master:rice',
				type: 'item_master',
				name: 'ข้าวสาร',
				category: 'food',
				base_unit: 'kg',
				conversions: []
			}
		]),
	useItemCategories: () => q([]),
	useUnitsOfMeasure: () => q([])
}));
vi.mock('$lib/features/shelters', () => ({ useShelters: () => q([]) }));
vi.mock('../application/use-storage-points.svelte', () => ({
	useStoragePoints: () => ({ points: [] })
}));
vi.mock('$lib/db/shelter', () => ({ getShelterCode: () => 'SH001' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/back-office/supply') } }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
// Children that need their own queries are out of scope here: this is about the page buttons.
vi.mock('./receive-stock-form.svelte', async () => ({
	default: (await import('./stock/disabled-reason.svelte')).default
}));
vi.mock('./distribute-stock-form.svelte', async () => ({
	default: (await import('./stock/disabled-reason.svelte')).default
}));
vi.mock('./adjust-stock-form.svelte', async () => ({
	default: (await import('./stock/disabled-reason.svelte')).default
}));
vi.mock('./cycle-count-form.svelte', async () => ({
	default: (await import('./stock/disabled-reason.svelte')).default
}));

let instance: ReturnType<typeof mount> | null = null;

async function render(roles: string[]) {
	mocks.roles = roles;
	instance = mount(StockTable, { target: document.body });
	for (let i = 0; i < 3; i++) {
		flushSync();
		await tick();
	}
}

const labels = () =>
	[...document.body.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '');

beforeEach(() => {
	document.body.innerHTML = '';
});

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
});

describe('StockTable movement buttons (CR-227)', () => {
	it.each([
		['warehouse_staff', ['shelter:SH001', 'SH001:warehouse_staff']],
		['supply_coordinator', ['shelter:SH001', 'SH001:supply_coordinator']],
		['shelter_manager', ['shelter:SH001', 'SH001:shelter_manager']]
	])('shows receive, adjust and count to %s', async (_cap, roles) => {
		await render(roles);

		const text = labels();
		expect(text).toContain('รับเข้า');
		expect(text).toContain('ปรับยอด');
		expect(text).toContain('ตรวจนับ');
		expect(document.body.querySelector('[aria-label^="รับเข้า"]')).not.toBeNull();
	});

	it('hides every receive, issue, adjust and count button from donation_staff', async () => {
		await render(['shelter:SH001', 'SH001:donation_staff']);

		expect(document.body.textContent).toContain('ข้าวสาร');
		const text = labels().join('|');
		for (const word of ['รับเข้า', 'เบิก', 'ปรับยอด', 'ตรวจนับ']) {
			expect(text).not.toContain(word);
		}
		expect(document.body.querySelector('[aria-label^="รับเข้า"]')).toBeNull();
	});

	it('keeps the add-new-item link for donation_staff, who may create catalog items', async () => {
		await render(['shelter:SH001', 'SH001:donation_staff']);

		expect(document.body.textContent).toContain('เพิ่มของใหม่');
	});
});
