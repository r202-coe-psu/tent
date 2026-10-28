// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import ReceiveStockForm from './receive-stock-form.svelte';

const mutation = { mutateAsync: vi.fn(), isPending: false, data: undefined };

vi.mock('../application/queries', () => ({
	useReceiveStock: () => mutation,
	useReceiveWalkInDonation: () => mutation,
	useDonations: () => ({ data: [] }),
	useStockLedgers: () => ({ data: [] }),
	useStockBalance: () => ({ data: new Map() })
}));
vi.mock('../application/use-stock-form-items.svelte', () => ({
	useStockFormItems: () => ({ items: [], isLoading: false })
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
// happy-dom's cloned <form> reports no method, which trips kit's dev-only `enhance` guard.
vi.mock('$app/forms', async (importOriginal) => ({
	...(await importOriginal<typeof import('$app/forms')>()),
	enhance: () => ({ destroy() {} })
}));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), promise: vi.fn() } }));

let instance: ReturnType<typeof mount> | null = null;

async function settle() {
	for (let i = 0; i < 3; i++) {
		flushSync();
		await tick();
	}
}

async function openWalkIn() {
	instance = mount(ReceiveStockForm, { target: document.body });
	await settle();
	[...document.body.querySelectorAll<HTMLElement>('[role="radio"]')]
		.find((b) => b.textContent?.includes('บริจาคหน้างาน'))!
		.click();
	await settle();
	return document.getElementById('walkin-donor-phone') as HTMLInputElement;
}

async function type(input: HTMLInputElement, value: string) {
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	await settle();
}

const errorEl = () => document.querySelector('[data-testid="walkin-phone-error"]');

afterEach(async () => {
	if (instance) unmount(instance);
	instance = null;
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
});

describe('receive-stock walk-in phone', () => {
	it('uses a numeric keypad and the example placeholder', async () => {
		const input = await openWalkIn();
		expect(input.getAttribute('inputmode')).toBe('numeric');
		expect(input.placeholder).toBe('เช่น 0891234567');
	});

	it('filters typing to digits and shows no error while blank', async () => {
		const input = await openWalkIn();
		expect(errorEl()).toBeNull();
		await type(input, '089-abc');
		expect(input.value).toBe('089');
	});

	it('clears letters typed into an empty phone field instead of leaving them on screen', async () => {
		const input = await openWalkIn();
		await type(input, 'ฟกหดน่หกด่');
		expect(input.value).toBe('');
	});

	it('shows the inline error for an incomplete number and clears it for a valid one', async () => {
		const input = await openWalkIn();
		await type(input, '089123');
		expect(errorEl()?.textContent?.trim()).toBe('เบอร์โทรต้องเป็นตัวเลข 10 หลัก ขึ้นต้นด้วย 0');
		await type(input, '0891234567');
		expect(errorEl()).toBeNull();
		await type(input, '+66891234567');
		expect(errorEl()).toBeNull();
	});
});
