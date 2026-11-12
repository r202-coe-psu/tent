// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type { StockLotBalance } from '../../domain/operations';
import LotFractionWriteOff from './lot-fraction-write-off.svelte';

const adjust = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), promise: vi.fn() }));

vi.mock('../../application/queries', () => ({
	useAdjustStock: () => ({ mutateAsync: adjust.mutateAsync, isPending: false })
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
vi.mock('svelte-sonner', () => ({ toast: toastMock }));

const lot = (over: Partial<StockLotBalance> = {}): StockLotBalance => ({
	lot_ref: 'stock_ledger:01JINWATER0000000000000000',
	item_id: 'item:water',
	unit: 'bottle',
	qty: '3.5',
	lot: { expiry: '2027-03-01' },
	received_at: '2026-10-01T00:00:00.000Z',
	...over
});

let instance: ReturnType<typeof mount> | null = null;
function render(props: { lot: StockLotBalance; offline?: boolean }) {
	instance = mount(LotFractionWriteOff, { target: document.body, props });
	flushSync();
}
const writeOffButton = () =>
	[...document.body.querySelectorAll('button')].find((b) =>
		b.textContent?.includes('ตัดเศษเหลือทิ้ง')
	);

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
	adjust.mutateAsync.mockReset();
	toastMock.promise.mockReset();
});

describe('LotFractionWriteOff (#805)', () => {
	it.each([
		['a whole count lot', lot({ qty: '3' })],
		['a mass lot with a fraction', lot({ unit: 'kg' })],
		['a negative lot', lot({ qty: '-0.5' })]
	])('shows no button for %s', (_name, balance) => {
		render({ lot: balance });
		expect(writeOffButton()).toBeUndefined();
	});

	it('is disabled while the session is expired', () => {
		render({ lot: lot(), offline: true });
		expect(writeOffButton()?.disabled).toBe(true);
	});

	it('asks first, then writes the fraction off the lot as an adjust', async () => {
		adjust.mutateAsync.mockResolvedValue(undefined);
		render({ lot: lot() });

		writeOffButton()!.click();
		await tick();
		const dialog = document.body.querySelector('[role="alertdialog"]');
		expect(dialog?.textContent).toContain('ตัดเศษ 0.5');
		expect(dialog?.textContent).toContain('ยอดคงเหลือจะเป็น 3');
		expect(adjust.mutateAsync).not.toHaveBeenCalled();

		[...dialog!.querySelectorAll<HTMLElement>('button')]
			.find((b) => b.textContent?.includes('ตัดเศษเหลือทิ้ง'))!
			.click();
		await tick();

		expect(adjust.mutateAsync).toHaveBeenCalledOnce();
		const { input, ctx } = adjust.mutateAsync.mock.calls[0][0];
		expect(input).toMatchObject({
			item_id: 'item:water',
			qty: '-0.5',
			adjust_reason: 'count_mismatch',
			note: 'ตัดเศษเหลือทิ้ง',
			lot_ref: 'stock_ledger:01JINWATER0000000000000000'
		});
		expect(ctx.shelterCode).toBe('SH001');
		expect(toastMock.promise).toHaveBeenCalledOnce();
	});

	it('writes nothing when the dialog is cancelled', async () => {
		render({ lot: lot() });
		writeOffButton()!.click();
		await tick();

		[...document.body.querySelectorAll<HTMLElement>('[role="alertdialog"] button')]
			.find((b) => b.textContent?.includes('ยกเลิก'))!
			.click();
		await tick();

		expect(adjust.mutateAsync).not.toHaveBeenCalled();
	});
});
