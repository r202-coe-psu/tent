// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import TransferForm from './transfer-form.svelte';

type DestinationsState = {
	data?: { code: string; name: string }[];
	isSuccess: boolean;
	isError: boolean;
};
const destinations: { current: DestinationsState } = {
	current: { data: undefined, isSuccess: false, isError: false }
};

const BOTTLE = {
	_id: 'item:water',
	name: 'น้ำดื่ม',
	unit: 'ขวด',
	base_unit: 'ขวด',
	conversions: []
};
const stockItems = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock('../application/queries', () => ({
	useCreateTransfer: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useStockBalance: () => ({ data: new Map([['item:water', '10']]) }),
	useTransferDestinations: () => destinations.current
}));
vi.mock('../application/use-stock-form-items.svelte', () => ({
	useStockFormItems: () => ({
		get items() {
			return stockItems.current;
		}
	})
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
vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn(),
	onNavigate: vi.fn()
}));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// happy-dom leaves `form.method` unset; superforms' `use:enhance` reads it to insist on POST.
Object.defineProperty(HTMLFormElement.prototype, 'method', {
	configurable: true,
	get(this: HTMLFormElement) {
		return (this.getAttribute('method') ?? 'get').toLowerCase();
	}
});

let instance: ReturnType<typeof mount> | null = null;

async function render(state: DestinationsState) {
	destinations.current = state;
	instance = mount(TransferForm, { target: document.body, props: {} });
	flushSync();
	await tick();
	flushSync();
}

const submitButton = () =>
	[...document.body.querySelectorAll('button')].find((b) =>
		b.textContent?.includes('ส่งคำขอโอน')
	) as HTMLButtonElement;
const destinationTrigger = () =>
	document.body.querySelector('[data-select-trigger], [data-slot="select-trigger"]') as HTMLElement;

afterEach(() => {
	stockItems.current = [];
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('transfer form destinations (#570)', () => {
	it('explains an empty destination list and keeps the request button off', async () => {
		await render({ data: [], isSuccess: true, isError: false });

		expect(document.body.textContent).toContain('ยังไม่มีศูนย์อื่นในระบบให้โอนไป');
		expect(submitButton().disabled).toBe(true);
		expect(
			destinationTrigger().hasAttribute('disabled') ||
				destinationTrigger().dataset.disabled !== undefined
		).toBe(true);
	});

	it('says the list failed to load rather than looking empty', async () => {
		await render({ data: undefined, isSuccess: false, isError: true });

		expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
			'โหลดรายชื่อศูนย์ปลายทางไม่สำเร็จ'
		);
		expect(submitButton().disabled).toBe(true);
	});

	it('lets the user pick a destination when other shelters exist', async () => {
		await render({
			data: [
				{ code: 'SH002', name: 'ศูนย์สอง' },
				{ code: 'SH003', name: 'ศูนย์สาม' }
			],
			isSuccess: true,
			isError: false
		});

		expect(document.body.textContent).not.toContain('ยังไม่มีศูนย์อื่นในระบบให้โอนไป');
		expect(destinationTrigger().hasAttribute('disabled')).toBe(false);
		expect(destinationTrigger().dataset.disabled).toBeUndefined();
	});
});

describe('transfer form whole numbers for count units (#805)', () => {
	const tick3 = async () => {
		for (let i = 0; i < 3; i++) {
			flushSync();
			await tick();
		}
	};
	const qtyInput = () => document.querySelector<HTMLInputElement>('input[type="number"]')!;

	async function pickBottles() {
		stockItems.current = [BOTTLE];
		await render({
			data: [{ code: 'SH002', name: 'ศูนย์สอง' }],
			isSuccess: true,
			isError: false
		});
		const input = document.querySelector<HTMLInputElement>('input[role="combobox"]')!;
		const trigger = input.parentElement!.querySelector<HTMLElement>('button[aria-haspopup]')!;
		trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
		trigger.click();
		await tick3();
		const option = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find((o) =>
			o.textContent?.includes('น้ำดื่ม')
		)!;
		option.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
		option.click();
		await tick3();
	}

	async function type(value: string) {
		qtyInput().value = value;
		qtyInput().dispatchEvent(new Event('input', { bubbles: true }));
		await tick3();
	}

	it('flags a fractional quantity at once; the request button follows the destination rule', async () => {
		await pickBottles();
		expect(qtyInput().step).toBe('1');

		await type('1.5');
		expect(document.body.textContent).toContain('หน่วยนับต้องเป็นจำนวนเต็ม');
		expect(qtyInput().getAttribute('aria-invalid')).toBe('true');
		expect(submitButton().disabled).toBe(true);

		await type('2');
		expect(document.body.textContent).not.toContain('หน่วยนับต้องเป็นจำนวนเต็ม');
		expect(submitButton().disabled).toBe(false);
	});
});

describe('transfer form quantity input (CR-038)', () => {
	const QTY_HINT = 'จำนวนต้องมากกว่า 0 ทศนิยมไม่เกิน 4 ตำแหน่ง';
	const qtyInput = () => document.querySelector<HTMLInputElement>('input[type="number"]')!;

	async function settle() {
		for (let i = 0; i < 3; i++) {
			flushSync();
			await tick();
		}
	}

	async function pickBottles() {
		stockItems.current = [BOTTLE];
		await render({ data: [{ code: 'SH002', name: 'ศูนย์สอง' }], isSuccess: true, isError: false });
		const input = document.querySelector<HTMLInputElement>('input[role="combobox"]')!;
		const trigger = input.parentElement!.querySelector<HTMLElement>('button[aria-haspopup]')!;
		trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
		trigger.click();
		await settle();
		const option = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find((o) =>
			o.textContent?.includes('น้ำดื่ม')
		)!;
		option.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
		option.click();
		await settle();
	}

	async function type(value: string) {
		qtyInput().value = value;
		qtyInput().dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
	}

	it.each(['1e3', '1.23456', '0', '1000000000000000'])(
		'refuses %s with the decimal hint and keeps the request button off',
		async (raw) => {
			await pickBottles();
			await type(raw);
			expect(document.body.textContent).toContain(QTY_HINT);
			expect(qtyInput().getAttribute('aria-invalid')).toBe('true');
			expect(submitButton().disabled).toBe(true);
		}
	);

	it('explains a quantity the number input cannot parse, such as "1e"', async () => {
		await pickBottles();
		Object.defineProperty(qtyInput(), 'validity', {
			configurable: true,
			value: { badInput: true }
		});
		await type('');

		expect(document.body.textContent).toContain(QTY_HINT);
		expect(submitButton().disabled).toBe(true);
	});
});
