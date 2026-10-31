// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type { DistributeBatchResult } from '../application/distribute-batch';
import DistributeStockForm from './distribute-stock-form.svelte';

const mutation = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
const toastMock = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	loading: vi.fn(() => 'toast-id')
}));

const RICE = { _id: 'item:rice', name: 'ข้าวสาร', unit: 'ถุง', base_unit: 'ถุง', conversions: [] };
const WATER = {
	_id: 'item:water',
	name: 'น้ำดื่ม',
	unit: 'ขวด',
	base_unit: 'ขวด',
	conversions: []
};

function inbound(id: string, itemId: string, qty: string, unit: string) {
	return {
		_id: `stock_ledger:${id}`,
		type: 'stock_ledger',
		item_id: itemId,
		qty,
		unit,
		reason: 'donation',
		ref_id: 'donation:d1',
		lot_ref: `stock_ledger:${id}`,
		occurred_at: '2026-10-01T00:00:00.000Z'
	};
}
const LEDGER = [
	inbound('RICE1', RICE._id, '10', 'ถุง'),
	inbound('WATER1', WATER._id, '100', 'ขวด')
];

let ledgerRows: unknown[] = LEDGER;

vi.mock('../application/queries', () => ({
	useLedger: () => ({ data: ledgerRows, isLoading: false }),
	useStockBalance: () => ({
		data: new Map([
			['item:rice', '10'],
			['item:water', '100']
		]),
		isLoading: false
	}),
	useDistributeBatch: () => ({
		mutateAsync: mutation.mutateAsync,
		get isPending() {
			return false;
		}
	})
}));
vi.mock('../application/use-stock-form-items.svelte', () => ({
	useStockFormItems: () => ({ items: [RICE, WATER], isLoading: false })
}));
vi.mock('../application/use-storage-points.svelte', () => ({
	useStoragePoints: () => ({ points: [] })
}));
vi.mock('../application/use-destination-options.svelte', () => ({
	useDestinationOptions: () => ({ options: ['ครัวกลาง'] })
}));
vi.mock('$lib/features/catalog', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/catalog')>()),
	useUnitsOfMeasure: () => ({ data: [] }),
	useItemMasters: () => ({ data: [] })
}));
vi.mock('$lib/features/supply', () => ({
	useSupplyItems: () => ({ data: [] }),
	useThresholdOverrides: () => ({ data: [] })
}));
vi.mock('$lib/auth/roles', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/auth/roles')>()),
	canDistributeStock: () => true
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

async function settle() {
	for (let i = 0; i < 3; i++) {
		flushSync();
		await tick();
	}
}

async function render(props: { preselectedItemId?: string } = {}) {
	instance = mount(DistributeStockForm, { target: document.body, props });
	await settle();
}

async function openItemPicker(lineIndex: number) {
	const input = document.querySelectorAll<HTMLInputElement>('input[id^="distribute-item-"]')[
		lineIndex
	];
	const trigger = input.parentElement!.querySelector<HTMLElement>('button[aria-haspopup]')!;
	trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
	trigger.click();
	await settle();
	return [...document.body.querySelectorAll<HTMLElement>('[role="option"]')];
}

const qtyInputs = () => [...document.querySelectorAll<HTMLInputElement>('input[type="number"]')];
const button = (label: string) =>
	[...document.body.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
		b.textContent?.replace(/\s+/g, ' ').trim().includes(label)
	);

async function type(input: HTMLInputElement, value: string) {
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	await settle();
}

afterEach(async () => {
	ledgerRows = LEDGER;
	mutation.mutateAsync.mockReset();
	toastMock.error.mockReset();
	toastMock.success.mockReset();
	if (instance) unmount(instance);
	instance = null;
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
});

describe('distribute form: one batch, many lines (#837)', () => {
	it('opens with the preselected item as line 1, like the old single-item form', async () => {
		await render({ preselectedItemId: RICE._id });

		expect(document.body.textContent).toContain('รายการที่ 1');
		expect(document.body.textContent).toContain('1 รายการ');
		const item = document.querySelector<HTMLInputElement>('input[id^="distribute-item-"]');
		expect(item?.value).toBe('ข้าวสาร');
		expect(qtyInputs()).toHaveLength(1);
	});

	it('"เพิ่มรายการ" adds a line, and the new line cannot pick the item line 1 already has', async () => {
		await render({ preselectedItemId: RICE._id });

		button('เพิ่มรายการ')!.click();
		await settle();

		expect(document.body.textContent).toContain('รายการที่ 2');
		expect(document.body.textContent).toContain('2 รายการ');
		const options = (await openItemPicker(1)).map((o) => o.textContent ?? '');
		expect(options.some((o) => o.includes('น้ำดื่ม'))).toBe(true);
		expect(options.some((o) => o.includes('ข้าวสาร'))).toBe(false);
	});

	it('a line over the balance shows its shortfall and blocks both save buttons', async () => {
		await render({ preselectedItemId: RICE._id });

		await type(qtyInputs()[0], '25');

		expect(document.body.textContent).toContain('ยอดที่ใช้ได้ไม่พอ');
		expect(document.body.textContent).toContain('เบิกไม่ได้ 1 รายการ');
		expect(button('บันทึกแล้วเบิกรายการถัดไป')!.disabled).toBe(true);

		await type(qtyInputs()[0], '4');
		expect(document.body.textContent).not.toContain('ยอดที่ใช้ได้ไม่พอ');
		expect(button('บันทึกแล้วเบิกรายการถัดไป')!.disabled).toBe(false);
	});

	it('the summary under "เพิ่มรายการ" lists every ready line with its lot, expiry and balance', async () => {
		await render({ preselectedItemId: RICE._id });
		const summary = () => document.querySelector('[aria-labelledby="distribute-summary-title"]');

		expect(summary()?.textContent).toContain('เลือกสินค้าและใส่จำนวนให้ครบ');

		await type(qtyInputs()[0], '4');
		button('เพิ่มรายการ')!.click();
		await settle();
		const water = (await openItemPicker(1)).find((o) => o.textContent?.includes('น้ำดื่ม'))!;
		water.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
		water.click();
		await settle();
		await type(qtyInputs()[1], '30');

		const text = summary()?.textContent?.replace(/\s+/g, ' ') ?? '';
		expect(text).toContain('2 รายการ · 2 แถวในบัญชีสต็อก');
		expect(text).toContain('ข้าวสาร −4 ถุง');
		expect(text).toContain('น้ำดื่ม −30 ขวด');
		expect(text).toContain('คลังหลัก −4 ถุง');
		expect(text).toContain('คงเหลือ 10 → 6 ถุง');
		expect(text).toContain('ไม่ระบุวันหมดอายุ');
	});

	it('one item with a broken history does not stop another item from planning its lots (#569)', async () => {
		// Water was dispatched from a lot that never existed, so its history cannot be replayed.
		ledgerRows = [
			...LEDGER,
			{
				...inbound('WATER_OUT', WATER._id, '-150', 'ขวด'),
				_id: 'stock_ledger:WATER_OUT',
				reason: 'distribution',
				lot_ref: 'stock_ledger:UNKNOWN',
				occurred_at: '2026-10-02T00:00:00.000Z'
			}
		];
		await render({ preselectedItemId: RICE._id });

		await type(qtyInputs()[0], '4');

		expect(document.body.textContent).not.toContain('ไม่สอดคล้องกัน');
		expect(document.body.textContent).not.toContain('ไม่พบล็อตที่มีคงเหลือ');
		expect(button('บันทึกแล้วเบิกรายการถัดไป')!.disabled).toBe(false);

		button('เพิ่มรายการ')!.click();
		await settle();
		const water = (await openItemPicker(1)).find((o) => o.textContent?.includes('น้ำดื่ม'))!;
		water.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
		water.click();
		await settle();

		expect(document.body.textContent).toContain('ประวัติคลังของ น้ำดื่ม ไม่สอดคล้องกัน');
		expect(document.body.textContent).not.toContain('ประวัติคลังของ ข้าวสาร');
	});

	it('saving without a destination writes nothing and names the problem', async () => {
		await render({ preselectedItemId: RICE._id });
		await type(qtyInputs()[0], '4');

		button('เบิก 4')!.click();
		await settle();

		expect(mutation.mutateAsync).not.toHaveBeenCalled();
		expect(toastMock.error).toHaveBeenCalledWith('กรุณาระบุปลายทาง / ผู้รับ');
	});

	it('a partial run locks the landed line, keeps the same ref_id and retries only the rest', async () => {
		await render({ preselectedItemId: RICE._id });
		button('เพิ่มรายการ')!.click();
		await settle();
		await type(qtyInputs()[0], '4');
		// line 2: pick water through its combobox
		const water = (await openItemPicker(1)).find((o) => o.textContent?.includes('น้ำดื่ม'))!;
		water.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
		water.click();
		await settle();
		await type(qtyInputs()[1], '30');
		button('ครัวกลาง')!.click();
		await settle();

		const keys: string[] = [];
		mutation.mutateAsync.mockImplementationOnce(async (args: { lines: { key: string }[] }) => {
			keys.push(...args.lines.map((l) => l.key));
			return {
				ref_id: 'x',
				complete: false,
				outcomes: [
					{ kind: 'done', key: args.lines[0].key, distributedQty: '4' },
					{ kind: 'failed', key: args.lines[1].key, message: 'offline' }
				]
			} satisfies DistributeBatchResult;
		});
		button('เบิก 2 รายการ')!.click();
		await settle();

		const first = mutation.mutateAsync.mock.calls[0][0];
		expect(first.note).toBe('ครัวกลาง');
		expect(first.lines).toHaveLength(2);
		expect(document.body.textContent).toContain('บันทึกไปบางส่วนแล้ว');
		expect(document.body.textContent).toContain('เบิกแล้ว 4 ถุง');
		expect(button('เบิกที่เหลือ 1 รายการ')).toBeTruthy();
		expect(qtyInputs()).toHaveLength(1);

		mutation.mutateAsync.mockResolvedValueOnce({
			ref_id: 'x',
			complete: true,
			outcomes: [{ kind: 'done', key: keys[1], distributedQty: '30' }]
		} satisfies DistributeBatchResult);
		button('เบิกที่เหลือ 1 รายการ')!.click();
		await settle();

		const retry = mutation.mutateAsync.mock.calls[1][0];
		expect(retry.ref_id).toBe(first.ref_id);
		expect(retry.lines.map((l: { key: string }) => l.key)).toEqual([keys[1]]);
		expect(toastMock.success).toHaveBeenCalled();
	});
});
