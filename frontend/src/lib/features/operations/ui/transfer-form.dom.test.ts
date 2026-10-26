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

vi.mock('../application/queries', () => ({
	useCreateTransfer: () => ({ mutateAsync: vi.fn(), isPending: false }),
	useStockBalance: () => ({ data: new Map<string, string>() }),
	useTransferDestinations: () => destinations.current
}));
vi.mock('../application/use-stock-form-items.svelte', () => ({
	useStockFormItems: () => ({ items: [] })
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
