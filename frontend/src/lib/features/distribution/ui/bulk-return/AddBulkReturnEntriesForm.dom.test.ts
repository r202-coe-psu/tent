// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { overviewMock } from '../__fixtures__/add-entries-overview.fixture.svelte';
import { lastBulkReturnPoolKey } from '../model/last-bulk-return-pool-storage';
import { findWrittenBulkReturnEntries } from '../../application/queries';
import AddBulkReturnEntriesForm from './AddBulkReturnEntriesForm.svelte';

const OP_ULID = '01JB1RACE0000000000000000A';
const POOL_ID = 'bulk_return_pool:01JB1POOL000000000000000AA';
const ITEM_ID = 'item_master:blanket';
const EVACUEE_ID = 'evacuee:01JB1EV';

const hoisted = vi.hoisted(() => {
	let resolveAdd: (value: unknown) => void = () => {};
	return {
		loans: { data: [] as unknown[] },
		picker: { props: null as Record<string, unknown> | null },
		mutateAsync: vi.fn(
			() =>
				new Promise((resolve) => {
					resolveAdd = resolve;
				})
		),
		resolveAdd: (value: unknown) => resolveAdd(value),
		toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }
	};
});

vi.mock('svelte-sonner', () => ({ toast: hoisted.toast }));
vi.mock('../../application/queries', async () => {
	const { overviewMock } = await import('../__fixtures__/add-entries-overview.fixture.svelte');
	return {
		createStableOperationId: () => '01JB1RACE0000000000000000A',
		findWrittenBulkReturnEntries: vi.fn(async () => new Map()),
		resolveAuthenticatedAuthorContext: () => ({
			shelterCode: 'SH1',
			createdBy: 'tester',
			roles: []
		}),
		useAddBulkReturnEntries: () => ({ isPending: false, mutateAsync: hoisted.mutateAsync }),
		useBulkReturnPoolOverview: () => ({
			get data() {
				return overviewMock.data;
			},
			isPending: false
		}),
		useReturnerOutstandingLoans: () => ({
			data: hoisted.loans.data,
			isPending: false,
			isError: false
		})
	};
});
vi.mock('../../application/food-supplies/auth', () => ({ canWriteBulkReturnEntry: () => true }));
vi.mock('$lib/features/catalog', () => ({
	useItemMasters: () => ({
		data: [{ _id: 'item_master:blanket', name: 'ผ้าห่ม', base_unit: 'ผืน', returnable: true }]
	})
}));
// Heavy children (own queries, camera) are out of scope for the form test.
// The picker stub keeps the props the form passes (bind:value arrives as a getter/setter pair), so
// a test can read `disabled` and pick a returner the way the real picker would.
vi.mock('../common/RecipientSearchPicker.svelte', () => ({
	default: (_anchor: unknown, props: Record<string, unknown>) => {
		hoisted.picker.props = props;
	}
}));
vi.mock('$lib/components/camera-code-scanner-dialog.svelte', async () => ({
	default: (await import('../__fixtures__/component-stub.fixture.svelte')).default
}));

const POOL = { _id: POOL_ID, name: 'กอง A', lock: null };

function writtenResult(opts: { loanPending?: boolean } = {}) {
	return {
		results: [
			{
				entry: {
					_id: `bulk_return_entry:${OP_ULID}`,
					item_id: ITEM_ID,
					returner_id: EVACUEE_ID,
					loan_refs: [{ distribution_log_id: 'distribution_log:L1', qty: '2' }]
				},
				late: false,
				replayed: false,
				loansApplied: opts.loanPending ? [] : ['distribution_log:L1'],
				loansSkipped: [],
				unallocated_qty: '0',
				...(opts.loanPending ? { loan_pending: true } : {})
			}
		],
		returner_had_outstanding_loans: true,
		no_outstanding_loan: false
	};
}

async function settle() {
	for (let i = 0; i < 5; i++) await tick();
	flushSync();
}

describe('AddBulkReturnEntriesForm save', () => {
	let component: ReturnType<typeof mount> | null = null;
	let dialog = { open: true };

	function mountForm() {
		component = mount(AddBulkReturnEntriesForm, {
			target: document.body,
			props: {
				get open() {
					return dialog.open;
				},
				set open(value: boolean) {
					dialog.open = value;
				},
				shelterCode: 'SH1',
				initialPoolId: POOL_ID,
				initialItemId: ITEM_ID,
				initialReturner: { recipientType: 'evacuee', recipientId: EVACUEE_ID, label: 'A' }
			}
		});
		flushSync();
	}

	function fillQtyAndGetForm(): HTMLFormElement {
		const qty = document.querySelector<HTMLInputElement>('input[id^="add-entry-qty-"]');
		expect(qty).not.toBeNull();
		qty!.value = '2';
		qty!.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		return document.querySelector('form')!;
	}

	const submit = (form: HTMLFormElement) =>
		form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

	beforeEach(async () => {
		vi.clearAllMocks();
		localStorage.clear();
		hoisted.loans.data = [];
		dialog = { open: true };
		overviewMock.data = [{ pool: { ...POOL, status: 'OPEN' } }];
		mountForm();
		await settle();
	});

	afterEach(() => {
		if (component) unmount(component);
		component = null;
		document.body.innerHTML = '';
	});

	it('finishes a successful save even when the pool leaves OPEN while the save is pending', async () => {
		const form = fillQtyAndGetForm();
		submit(form);
		flushSync();
		expect(hoisted.mutateAsync).toHaveBeenCalledTimes(1);

		// A concurrent submit reaches this browser through the live overview refetch.
		overviewMock.data = [{ pool: { ...POOL, status: 'SUBMITTED' } }];
		flushSync();

		hoisted.resolveAdd(writtenResult());
		await settle();

		expect(hoisted.toast.error).not.toHaveBeenCalled();
		expect(hoisted.toast.success).toHaveBeenCalledWith('บันทึกเข้ากองแล้ว 1 รายการ · ตัดยอดยืม 2');
		expect(dialog.open).toBe(false);
		expect(localStorage.getItem(lastBulkReturnPoolKey('SH1', 'tester'))).toBe(POOL_ID);
	});

	it('warns which items still need a loan cut and closes when every line was written', async () => {
		const form = fillQtyAndGetForm();
		submit(form);
		flushSync();

		hoisted.resolveAdd(writtenResult({ loanPending: true }));
		await settle();

		expect(hoisted.toast.error).not.toHaveBeenCalled();
		const warning = hoisted.toast.warning.mock.calls.map(([text]) => String(text)).join('\n');
		expect(warning).toContain('ยอดยืมของรายการนี้ยังไม่ถูกตัด');
		expect(warning).toContain('ผ้าห่ม');
		expect(warning).toContain('ตัดยอดยืมที่ค้าง');
		expect(dialog.open).toBe(false);
	});

	it('starts only one save when submitted twice before the pending state renders', async () => {
		const form = fillQtyAndGetForm();
		submit(form);
		submit(form);
		flushSync();

		expect(hoisted.mutateAsync).toHaveBeenCalledTimes(1);

		hoisted.resolveAdd(writtenResult());
		await settle();
		expect(hoisted.mutateAsync).toHaveBeenCalledTimes(1);
	});

	/** Remounts with one outstanding loan, fails a save, then starts return-all on a held lookup. */
	async function startPendingReturnAll(): Promise<
		(written: Map<string, { qty: string; item_id: string }>) => void
	> {
		unmount(component!);
		component = null;
		document.body.innerHTML = '';
		hoisted.loans.data = [
			{
				_id: 'distribution_log:L1',
				item_id: ITEM_ID,
				qty: '5',
				qty_returned: '0',
				distributed_at: '2026-01-01T00:00:00.000Z'
			}
		];
		mountForm();
		await settle();

		// A failed save marks the line ULID as sent, so return-all must look it up first.
		hoisted.mutateAsync.mockImplementationOnce(() => Promise.reject(new Error('offline')));
		const form = fillQtyAndGetForm();
		submit(form);
		await settle();

		let resolveLookup: (value: Map<string, { qty: string; item_id: string }>) => void = () => {};
		vi.mocked(findWrittenBulkReturnEntries).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveLookup = resolve;
				})
		);
		const returnAll = [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
			button.textContent?.includes('คืนทั้งหมด')
		);
		expect(returnAll).toBeDefined();
		returnAll!.click();
		flushSync();
		return (written) => resolveLookup(written);
	}

	const qty = () => document.querySelector<HTMLInputElement>('input[id^="add-entry-qty-"]')!;
	const unspecifiedSwitch = () =>
		document.querySelector<HTMLButtonElement>('#add-entry-unspecified')!;

	it('disables line editing while the return-all written lookup is pending', async () => {
		const resolveLookup = await startPendingReturnAll();

		const addLineButton = () =>
			[...document.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
				button.textContent?.includes('เพิ่มรายการสินค้า')
			)!;
		const removeButtons = () =>
			[...document.querySelectorAll<HTMLButtonElement>('button')].filter((button) =>
				button.textContent?.includes('ลบรายการที่')
			);
		expect(qty().disabled).toBe(true);
		expect(addLineButton().disabled).toBe(true);
		expect(removeButtons().every((button) => button.disabled)).toBe(true);

		resolveLookup(new Map());
		await settle();

		expect(qty().disabled).toBe(false);
		expect(addLineButton().disabled).toBe(false);
	});

	it('disables the returner controls while the return-all written lookup is pending', async () => {
		expect(unspecifiedSwitch().disabled).toBe(false);
		expect(hoisted.picker.props?.disabled).toBe(false);

		const resolveLookup = await startPendingReturnAll();
		expect(unspecifiedSwitch().disabled).toBe(true);
		expect(hoisted.picker.props?.disabled).toBe(true);

		resolveLookup(new Map<string, { qty: string; item_id: string }>());
		await settle();
		expect(unspecifiedSwitch().disabled).toBe(false);
		expect(hoisted.picker.props?.disabled).toBe(false);
	});

	it('replaces the lines from the loans when the returner is unchanged after the lookup', async () => {
		const resolveLookup = await startPendingReturnAll();
		resolveLookup(new Map());
		await settle();

		expect(qty().value).toBe('5');
	});

	it('leaves the lines alone when the returner changed before the lookup resolved', async () => {
		const resolveLookup = await startPendingReturnAll();
		expect(qty().value).toBe('2');
		// The failed save above toasted; only toasts after this point count.
		hoisted.toast.error.mockClear();

		// The controls are disabled, so move the selection the way the picker binding would.
		hoisted.picker.props!.value = {
			recipientType: 'evacuee',
			recipientId: 'evacuee:01JB1OTHER',
			label: 'B'
		};
		flushSync();
		resolveLookup(new Map());
		await settle();

		expect(qty().value).toBe('2');
		expect(hoisted.toast.info).not.toHaveBeenCalled();
		expect(hoisted.toast.error).not.toHaveBeenCalled();
	});
});
