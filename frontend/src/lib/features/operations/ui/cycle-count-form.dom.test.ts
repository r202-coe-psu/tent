// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import CycleCountForm from './cycle-count-form.svelte';

const WATER = { _id: 'item:water', name: 'น้ำดื่ม', unit: 'bottle', category: 'water' };
const lotRow = (id: string, qty: string, at: string, lotRef?: string) => ({
	_id: `stock_ledger:${id}`,
	type: 'stock_ledger',
	item_id: 'item:water',
	qty,
	unit: 'bottle',
	reason: qty.startsWith('-') ? 'adjust' : 'donation',
	ref_id: qty.startsWith('-') ? null : 'donation:d1',
	lot_ref: lotRef ?? `stock_ledger:${id}`,
	occurred_at: at
});
// Two lots overdrawn by the same amount: identical warning text, distinct lots (#855).
const LEDGER = [
	lotRow('01JIN1', '5', '2026-10-01T00:00:00.000Z'),
	lotRow('01JIN2', '5', '2026-10-01T00:00:01.000Z'),
	lotRow('01JOUT1', '-8', '2026-10-02T00:00:00.000Z', 'stock_ledger:01JIN1'),
	lotRow('01JOUT2', '-8', '2026-10-02T00:00:01.000Z', 'stock_ledger:01JIN2')
];

vi.mock('../application/queries', () => ({
	useLedger: () => ({ data: LEDGER }),
	useApplyCycleCount: () => ({ mutateAsync: vi.fn(), isPending: false })
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
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let instance: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('CycleCountForm negative lots (#855)', () => {
	it('lists every negative lot even when two share the same warning text', async () => {
		instance = mount(CycleCountForm, { target: document.body, props: {} });
		for (let i = 0; i < 3; i++) {
			flushSync();
			await tick();
		}
		const items = [...document.body.querySelectorAll('[role="alert"] li')];
		expect(items.map((li) => li.textContent)).toEqual(['น้ำดื่ม -3 bottle', 'น้ำดื่ม -3 bottle']);
	});
});
