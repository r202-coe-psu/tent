// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { TransferForbiddenError } from '../domain/operations';
import TransferList from './transfer-list.svelte';

type TransfersState = {
	data?: unknown[];
	error: unknown;
	isError: boolean;
	isLoading: boolean;
	isFetching: boolean;
	refetch: () => void;
};
const transfers = vi.hoisted(() => ({
	current: {
		data: [],
		error: null,
		isError: false,
		isLoading: false,
		isFetching: false,
		refetch: () => {}
	} as TransfersState
}));
vi.mock('../application/queries', () => {
	const mutation = () => ({ mutateAsync: vi.fn(), isPending: false });
	return {
		useTransfers: () => transfers.current,
		useDispatchTransfer: mutation,
		useReceiveTransfer: mutation,
		useCancelTransfer: mutation,
		useDisputeTransfer: mutation,
		useResumeTransfer: mutation
	};
});
vi.mock('$lib/db/shelter', () => ({ getShelterCode: () => 'SH001' }));
// Item names and units (#777) come from catalog and supply queries; none are needed here.
vi.mock('$lib/features/catalog', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/catalog')>()),
	useItemMasters: () => ({ data: [] }),
	useUnitsOfMeasure: () => ({ data: [] })
}));
vi.mock('$lib/features/supply', () => ({ useSupplyItems: () => ({ data: [] }) }));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let instance: ReturnType<typeof mount> | null = null;

async function render(state: Partial<TransfersState>) {
	transfers.current = {
		data: [],
		error: null,
		isError: false,
		isLoading: false,
		isFetching: false,
		refetch: vi.fn(),
		...state
	};
	instance = mount(TransferList, { target: document.body, props: {} });
	flushSync();
	await tick();
	flushSync();
}

const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('transfer list states (#571)', () => {
	it('says the account may not read transfers when the API refuses it', async () => {
		await render({ data: undefined, isError: true, error: new TransferForbiddenError() });

		expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
			'บัญชีนี้ไม่มีสิทธิ์ดูรายการโอนย้ายของศูนย์นี้'
		);
		expect(text()).not.toContain('ยังไม่มีรายการโอนย้าย');
		expect(text()).not.toContain('ไม่มีรายการรอตรวจรับ');
	});

	it('says the list failed to load, with a retry, for any other error', async () => {
		const refetch = vi.fn();
		await render({
			data: undefined,
			isError: true,
			error: new Error('Failed to list transfers'),
			refetch
		});

		expect(text()).toContain('โหลดรายการโอนย้ายไม่สำเร็จ');
		expect(text()).not.toContain('ยังไม่มีรายการโอนย้าย');
		const retry = [...document.body.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('ลองใหม่')
		) as HTMLButtonElement;
		retry.click();
		expect(refetch).toHaveBeenCalled();
	});

	it('keeps a loaded list when only a background refetch fails', async () => {
		await render({ data: [], isError: true, error: new Error('Service Unavailable') });

		expect(document.body.querySelector('[role="alert"]')).toBeNull();
		expect(text()).toContain('ไม่มีรายการรอตรวจรับ');
		expect(text()).toContain('ยังไม่มีรายการโอนย้าย');
	});

	it('still says no permission when a refusal comes after a loaded list', async () => {
		await render({ data: [], isError: true, error: new TransferForbiddenError() });

		expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
			'บัญชีนี้ไม่มีสิทธิ์ดูรายการโอนย้ายของศูนย์นี้'
		);
	});

	it('disables the retry while it is loading again', async () => {
		await render({
			data: undefined,
			isError: true,
			isFetching: true,
			error: new Error('Failed to list transfers')
		});

		const retry = [...document.body.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('กำลังโหลด…')
		) as HTMLButtonElement | undefined;
		expect(retry?.disabled).toBe(true);
	});

	it('still shows the empty state when the list loaded and is empty', async () => {
		await render({ data: [] });

		expect(text()).toContain('ยังไม่มีรายการโอนย้าย');
		expect(document.body.querySelector('[role="alert"]')).toBeNull();
	});
});
