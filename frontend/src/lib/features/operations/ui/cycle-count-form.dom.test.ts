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

const ledgerState = { rows: LEDGER as unknown[] };

vi.mock('../application/queries', () => ({
	useLedger: () => ({ data: ledgerState.rows }),
	useApplyCycleCount: () => ({ mutateAsync: vi.fn(), isPending: false })
}));
vi.mock('../application/use-stock-form-items.svelte', () => ({
	useStockFormItems: () => ({ items: [WATER], isLoading: false })
}));
vi.mock('../application/use-storage-points.svelte', () => ({
	useStoragePoints: () => ({ points: [] })
}));
vi.mock('$lib/features/catalog', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/features/catalog')>();
	return {
		...actual,
		useUnitsOfMeasure: () => ({ data: [] }),
		useUnitDimensionResolver: () => ({
			resolve: (unit: string) => actual.resolveUnitDimension(unit)
		})
	};
});
vi.mock('$lib/db/shelter', () => ({ getShelterCode: () => 'SH001' }));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let instance: ReturnType<typeof mount> | null = null;
afterEach(() => {
	ledgerState.rows = LEDGER;
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

describe('CycleCountForm whole numbers for count units (#805)', () => {
	async function settle() {
		for (let i = 0; i < 3; i++) {
			flushSync();
			await tick();
		}
	}
	async function startCount(rows: unknown[]) {
		ledgerState.rows = rows;
		instance = mount(CycleCountForm, { target: document.body, props: {} });
		await settle();
		document.body.querySelector<HTMLButtonElement>('ul button')!.click();
		await settle();
	}
	async function key(value: string) {
		const input = document.body.querySelector<HTMLInputElement>('input[id^="count-"]')!;
		input.value = value;
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
		return input;
	}
	const saveButton = () => document.body.querySelector<HTMLButtonElement>('button[type="submit"]')!;

	it('refuses a fractional count and says why, then accepts a whole one', async () => {
		await startCount([lotRow('01JIN1', '5', '2026-10-01T00:00:00.000Z')]);

		const input = await key('3.5');
		expect(document.body.textContent).toContain('หน่วยนับต้องเป็นจำนวนเต็ม');
		expect(input.getAttribute('aria-invalid')).toBe('true');
		expect(saveButton().disabled).toBe(true);

		await key('3');
		expect(document.body.textContent).not.toContain('หน่วยนับต้องเป็นจำนวนเต็ม');
		expect(saveButton().disabled).toBe(false);
	});

	it('lets a legacy fractional balance be counted as it is, since that writes nothing', async () => {
		await startCount([lotRow('01JIN1', '2.5', '2026-10-01T00:00:00.000Z')]);

		await key('2.5');
		expect(document.body.textContent).not.toContain('หน่วยนับต้องเป็นจำนวนเต็ม');
	});

	it('writes a fractional remainder off by counting the whole number', async () => {
		await startCount([lotRow('01JIN1', '2.5', '2026-10-01T00:00:00.000Z')]);

		await key('2');
		expect(document.body.textContent).not.toContain('หน่วยนับต้องเป็นจำนวนเต็ม');
		expect(saveButton().disabled).toBe(false);
	});
});
