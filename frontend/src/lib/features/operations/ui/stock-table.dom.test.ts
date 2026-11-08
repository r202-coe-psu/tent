// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import StockTable from './stock-table.svelte';

const RICE_LEDGER = vi.hoisted(() => [
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
]);

const mocks = vi.hoisted(() => ({
	roles: [] as string[],
	search: '',
	ledger: null as unknown[] | null,
	balance: null as Map<string, string> | null,
	incoming: undefined as unknown
}));

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
	useStockBalance: () => q(mocks.balance ?? new Map([['item_master:rice', '10']])),
	useLedger: () => q(mocks.ledger ?? RICE_LEDGER),
	useCrossShelterStockBalances: () => q([]),
	useCrossShelterLedger: () => q([]),
	useIncomingStock: () => mocks.incoming ?? q(undefined)
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
			},
			{
				_id: 'item_master:veg',
				type: 'item_master',
				name: 'ผักรวม',
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
vi.mock('$app/state', () => ({
	page: {
		get url() {
			return new URL(`http://localhost/back-office/supply${mocks.search}`);
		}
	}
}));
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

// The sheet mounts every tab; the history and policy tabs have their own queries and are out of
// scope for the lots tab under test here.
vi.mock('./ledger-table.svelte', async () => ({
	default: (await import('./__fixtures__/empty-component.svelte')).default
}));
vi.mock('$lib/features/sop-ratios/item-policy', async () => ({
	ItemPolicyPanel: (await import('./__fixtures__/empty-component.svelte')).default
}));

let instance: ReturnType<typeof mount> | null = null;

async function render(roles: string[], search = '') {
	mocks.roles = roles;
	mocks.search = search;
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
	mocks.ledger = null;
	mocks.balance = null;
	mocks.search = '';
	mocks.incoming = undefined;
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

describe('StockTable "ซื้อเอง" filter (#1187)', () => {
	const WH = ['shelter:SH001', 'SH001:warehouse_staff'];
	const row = (over: Record<string, unknown>) => ({
		type: 'stock_ledger',
		schema_v: 7,
		shelter_code: 'SH001',
		item_id: 'item_master:veg',
		unit: 'kg',
		created_at: '2026-11-01T00:00:00.000Z',
		updated_at: '2026-11-01T00:00:00.000Z',
		occurred_at: '2026-11-01T00:00:00.000Z',
		created_by: 'wh',
		...over
	});
	// Lot A (donated, 200 kg) expires before lot B (bought by the shelter, 10 kg).
	const LEDGER = [
		row({
			_id: 'stock_ledger:01J8Z9K5N7QXR3T6V8W0Y2A4C1',
			qty: '200',
			reason: 'donation',
			lot: { lot_no: 'L-A', expiry: '2099-01-01' }
		}),
		row({
			_id: 'stock_ledger:01J8Z9K5N7QXR3T6V8W0Y2A4C2',
			qty: '10',
			reason: 'adjust',
			adjust_reason: 'found',
			lot: { lot_no: 'L-B', expiry: '2099-06-01', self_purchased: true }
		})
	];

	function arrange() {
		mocks.ledger = [...RICE_LEDGER, ...LEDGER];
		mocks.balance = new Map([
			['item_master:rice', '10'],
			['item_master:veg', '210']
		]);
	}

	/** The desktop table row of the item (the mobile card has no lot count line). */
	const vegRow = () =>
		[...document.body.querySelectorAll('tr')].find((el) => el.textContent?.includes('ผักรวม'));

	it('shows the full stock and both lots without the filter', async () => {
		arrange();
		await render(WH);

		expect(vegRow()?.textContent).toContain('210');
		expect(vegRow()?.textContent).toContain('2 ล็อต');
		expect(document.body.textContent).toContain('ข้าวสาร');
	});

	it('shows only what was bought, and hides items with no self-purchased lot', async () => {
		arrange();
		await render(WH, '?sp=1');

		const text = vegRow()?.textContent ?? '';
		expect(text).toContain('10');
		expect(text).not.toContain('210');
		expect(text).toContain('1 ล็อต');
		expect(document.body.textContent).not.toContain('ข้าวสาร');
	});

	it('keeps the full lot order in the sheet, so only the earlier-expiring lot is "next"', async () => {
		arrange();
		await render(WH, '?sp=1');

		(vegRow()?.querySelector('button') as HTMLButtonElement).click();
		for (let i = 0; i < 4; i++) {
			flushSync();
			await tick();
		}

		const sheet = document.body.textContent ?? '';
		// The sheet starts with its own "ซื้อเอง" switch on, so lot A is hidden but L-B keeps place 2.
		expect(sheet).toContain('L-B');
		expect(sheet).not.toContain('L-A');
		expect(sheet).toContain('ลำดับที่ 2');
		expect(sheet).not.toContain('เบิกถัดไป');
		// The header keeps the total next to the self-purchased part.
		expect(sheet).toContain('210');
		expect(sheet).toContain('ซื้อเอง 10');
	});
});

describe('StockTable incoming switch (#1153)', () => {
	const alerts = () =>
		[...document.body.querySelectorAll('[role=alert]')].map((e) => e.textContent);

	it('says so when incoming goods cannot be loaded, instead of showing nothing', async () => {
		mocks.incoming = { data: undefined, isLoading: false, isError: true, error: new Error('x') };
		await render(['system_admin'], '?incoming=1');
		expect(alerts().join()).toContain('โหลดของที่กำลังมาไม่สำเร็จ');
	});

	it('stays quiet while the switch is off, even if the query errored before', async () => {
		mocks.incoming = { data: undefined, isLoading: false, isError: true, error: new Error('x') };
		await render(['system_admin'], '');
		expect(alerts()).toEqual([]);
	});

	it('is off in the "ซื้อเอง" view, so no incoming error shows there', async () => {
		mocks.incoming = { data: undefined, isLoading: false, isError: true, error: new Error('x') };
		await render(['system_admin'], '?incoming=1&sp=1');
		expect(alerts()).toEqual([]);
	});
});
