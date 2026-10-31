// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import AdjustStockForm from './adjust-stock-form.svelte';

// The ledger sits in a SvelteMap (made in the mock factory) so a test can change it under a
// mounted form, as a refetch would.
const ledger = vi.hoisted(() => ({
	store: null as null | {
		get(k: 'rows'): unknown[] | undefined;
		set(k: 'rows', v: unknown[]): void;
	},
	set current(rows: unknown[]) {
		this.store!.set('rows', rows);
	}
}));
const adjust = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), promise: vi.fn() }));

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

vi.mock('../application/queries', async () => {
	const { SvelteMap } = await import('svelte/reactivity');
	ledger.store = new SvelteMap<'rows', unknown[]>([['rows', []]]);
	return {
		useLedger: () => ({
			get data() {
				return ledger.store!.get('rows');
			}
		}),
		useAdjustStock: () => ({ mutateAsync: adjust.mutateAsync, isPending: false }),
		useStockBalance: () => ({ data: new Map([['item:water', '1199']]) })
	};
});
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
vi.mock('svelte-sonner', () => ({ toast: toastMock }));

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

async function settle() {
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

async function chooseLot(text: string) {
	await lotOptions();
	const option = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find((o) =>
		o.textContent?.includes(text)
	);
	option!.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
	option!.click();
	await settle();
}

async function fillAndSubmit(newQty: string, reasonLabel: string) {
	const qty = document.getElementById('new-qty') as HTMLInputElement;
	qty.value = newQty;
	qty.dispatchEvent(new Event('input', { bubbles: true }));
	await settle();
	[...document.body.querySelectorAll<HTMLButtonElement>('button')]
		.find((b) => b.textContent?.trim() === reasonLabel)!
		.click();
	await settle();
	document
		.querySelector('form')!
		.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
	await settle();
}

const submittedInput = () =>
	adjust.mutateAsync.mock.calls.at(-1)?.[0]?.input as Record<string, unknown> | undefined;

afterEach(async () => {
	adjust.mutateAsync.mockReset();
	toastMock.error.mockReset();
	if (instance) unmount(instance);
	instance = null;
	// bits-ui releases the body scroll lock on a 24 ms timer; let it run before happy-dom tears down.
	await new Promise((resolve) => setTimeout(resolve, 50));
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

	it('writes a write-off off the chosen lot, naming its lot_ref', async () => {
		ledger.current = [INBOUND, DISPATCH];
		await render();
		await chooseLot('คงเหลือ 1199');

		await fillAndSubmit('1190', 'เสียหาย / เน่าเสีย');

		expect(submittedInput()).toMatchObject({ qty: '-9', lot_ref: INBOUND._id });
	});

	it('adds stock as a new lot (no lot_ref) where the chosen lot is', async () => {
		ledger.current = [INBOUND, DISPATCH];
		await render();
		await chooseLot('คงเหลือ 1199');

		await fillAndSubmit('1205', 'พบของเพิ่ม');

		const input = submittedInput();
		expect(input).toMatchObject({ qty: '6', lot: { expiry: '2027-03-01' } });
		expect(input).not.toHaveProperty('lot_ref');
	});

	it('says added stock becomes a new lot, but not for a write-off', async () => {
		ledger.current = [INBOUND, DISPATCH];
		await render();
		await chooseLot('คงเหลือ 1199');
		const qty = document.getElementById('new-qty') as HTMLInputElement;
		const hint = () => document.body.querySelector('[role="note"]')?.textContent ?? '';

		qty.value = '1205';
		qty.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
		expect(hint()).toContain('ล็อตใหม่');

		qty.value = '1190';
		qty.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
		expect(hint()).toBe('');
	});

	it('hides a lot that is down to zero', async () => {
		const EMPTY = {
			...INBOUND,
			_id: 'stock_ledger:01JINEMPTY0000000000000000',
			lot_ref: undefined
		};
		const EMPTIED = {
			...DISPATCH,
			_id: 'stock_ledger:01JOUTEMPTY000000000000000',
			qty: '-1200',
			lot_ref: EMPTY._id
		};
		ledger.current = [INBOUND, EMPTY, EMPTIED];
		await render();

		const lots = (await lotOptions()).filter((o) => o.includes('คงเหลือ'));
		expect(lots).toEqual([expect.stringContaining('คงเหลือ 1200')]);
	});

	it('says the history is inconsistent, tied to the lot picker', async () => {
		ledger.current = [INBOUND, { ...DISPATCH, lot_ref: 'stock_ledger:UNKNOWN' }];
		await render();

		const alert = document.getElementById('lot-integrity-error');
		expect(alert?.getAttribute('role')).toBe('alert');
		expect(alert?.textContent).toContain('ไม่สอดคล้อง');
		expect(document.getElementById('lot-select')?.getAttribute('aria-describedby')).toBe(
			'lot-integrity-error'
		);
	});

	it('refuses to save when the chosen lot ran out while the form was open', async () => {
		ledger.current = [INBOUND, DISPATCH];
		await render();
		await chooseLot('คงเหลือ 1199');
		const qty = document.getElementById('new-qty') as HTMLInputElement;
		qty.value = '1190';
		qty.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();

		// a refetch shows the lot emptied by someone else
		ledger.current = [INBOUND, { ...DISPATCH, qty: '-1200' }];
		await settle();
		[...document.body.querySelectorAll<HTMLButtonElement>('button')]
			.find((b) => b.textContent?.trim() === 'เสียหาย / เน่าเสีย')
			?.click();
		await settle();
		document
			.querySelector('form')!
			.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
		await settle();

		expect(adjust.mutateAsync).not.toHaveBeenCalled();
		expect(toastMock.error).toHaveBeenCalledWith('ล็อตที่เลือกไม่มีคงเหลือแล้ว กรุณาเลือกล็อตใหม่');
	});
});
