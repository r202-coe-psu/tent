// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import AdjustStockForm from './adjust-stock-form.svelte';

const ledger = vi.hoisted(() => ({ current: [] as unknown[] }));

const WATER = {
	_id: 'item:water',
	name: 'น้ำดื่ม',
	unit: 'bottle',
	category: 'water'
};
const INBOUND = {
	_id: 'stock_ledger:01JINWATER0000000000000000',
	type: 'stock_ledger',
	item_id: 'item:water',
	qty: '1200',
	unit: 'bottle',
	reason: 'donation',
	ref_id: 'donation:d1',
	lot_ref: 'stock_ledger:01JINWATER0000000000000000',
	lot: { expiry: '2027-03-01' },
	occurred_at: '2026-10-01T00:00:00.000Z'
};
/** Dispatched against the lot: `lot_ref` only, and the destination kept in `lot.note`. */
const DISPATCH = {
	_id: 'stock_ledger:01JOUTWATER000000000000000',
	type: 'stock_ledger',
	item_id: 'item:water',
	qty: '-1',
	unit: 'bottle',
	reason: 'distribute',
	ref_id: 'requisition_ticket:t1',
	lot_ref: INBOUND._id,
	lot: { note: 'อาคารยิมเนเซียม 1' },
	occurred_at: '2026-10-02T00:00:00.000Z'
};

vi.mock('../application/queries', () => ({
	useLedger: () => ({ data: ledger.current }),
	useAdjustStock: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useStockBalance: () => ({ data: new Map([['item:water', '1199']]) })
}));
vi.mock('../application/use-stock-form-items.svelte', () => ({
	useStockFormItems: () => ({ items: [WATER], isLoading: false })
}));
vi.mock('../application/use-storage-points.svelte', () => ({
	useStoragePoints: () => ({ points: [] })
}));
vi.mock('$lib/features/catalog', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/catalog')>()),
	useUnitsOfMeasure: () => ({ data: [] })
}));
vi.mock('$lib/db/shelter', () => ({ getShelterCode: () => 'SH001' }));
vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn(),
	onNavigate: vi.fn()
}));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), promise: vi.fn() } }));

let instance: ReturnType<typeof mount> | null = null;

async function render() {
	instance = mount(AdjustStockForm, {
		target: document.body,
		props: { preselectedItemId: 'item:water' }
	});
	for (let i = 0; i < 3; i++) {
		flushSync();
		await tick();
	}
}

async function lotOptions(): Promise<string[]> {
	const trigger = document.getElementById('lot-select') as HTMLElement;
	trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
	trigger.click();
	for (let i = 0; i < 3; i++) {
		flushSync();
		await tick();
	}
	return [...document.body.querySelectorAll('[role="option"]')].map(
		(o) => o.textContent?.replace(/\s+/g, ' ').trim() ?? ''
	);
}

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('adjust form lots (#569)', () => {
	it('shows the lot at the stock-table balance, and no group for the dispatch destination', async () => {
		ledger.current = [INBOUND, DISPATCH];
		await render();

		const options = await lotOptions();
		const lots = options.filter((o) => o.includes('คงเหลือ'));
		expect(lots).toHaveLength(1);
		expect(lots[0]).toContain('คงเหลือ 1199');
		expect(options.join(' ')).not.toContain('อาคารยิมเนเซียม');
	});
});
