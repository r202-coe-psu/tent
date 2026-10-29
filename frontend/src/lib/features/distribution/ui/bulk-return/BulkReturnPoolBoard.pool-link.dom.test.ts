// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import BulkReturnPoolBoard from './BulkReturnPoolBoard.svelte';
import { BULK_RETURN_POOL_NOT_FOUND_TOAST } from '../model/bulk-return-copy';

type DetailProps = { row: { pool: { _id: string } } | null };
type OpenDialogProps = { onOpened: (pool: { _id: string }) => void };

const stubs = vi.hoisted(() => ({
	detail: null as DetailProps | null,
	openDialog: null as OpenDialogProps | null
}));
const overview = vi.hoisted(() => ({
	// Filled in with a SvelteMap below (needs the svelte import, which hoisting precedes).
	state: null as Map<string, unknown> | null
}));
const sonner = vi.hoisted(() => ({ warning: vi.fn(), error: vi.fn(), success: vi.fn() }));

vi.mock('svelte-sonner', () => ({ toast: sonner }));
vi.mock('./BulkReturnPoolDetail.svelte', () => ({
	default: (_anchor: Comment, props: DetailProps) => {
		stubs.detail = props;
	}
}));
vi.mock('./OpenBulkReturnPoolDialog.svelte', () => ({
	default: (_anchor: Comment, props: OpenDialogProps) => {
		stubs.openDialog = props;
	}
}));
vi.mock('./BulkReturnPoolWorkQueue.svelte', () => ({ default: () => {} }));
vi.mock('./BulkReturnPoolLifecycleActions.svelte', () => ({ default: () => {} }));
vi.mock('./AddBulkReturnEntriesDialog.svelte', () => ({ default: () => {} }));
vi.mock('../model/bulk-return-work-queue', () => ({ workQueuesFor: () => [] }));

vi.mock('../../application/queries', () => ({
	resolveAuthenticatedAuthorContext: () => ({}),
	useBulkReturnSkippedDocs: () => ({ data: [] }),
	useBulkReturnPoolOverview: () => ({
		get data() {
			return overview.state?.get('data');
		},
		get isSuccess() {
			return overview.state?.get('isSuccess');
		},
		get isFetching() {
			return overview.state?.get('isFetching');
		},
		get isLoading() {
			return overview.state?.get('isLoading');
		},
		get isError() {
			return overview.state?.get('isError');
		},
		isPlaceholderData: false,
		error: null,
		refetch: () => {}
	})
}));
vi.mock('../../application/food-supplies/auth', () => ({
	canManageBulkReturnPool: () => true,
	canWriteBulkReturnEntry: () => true
}));
vi.mock('$lib/features/catalog', () => ({ useItemMasters: () => ({ data: [] }) }));
vi.mock('$lib/features/people', () => ({ useEvacuees: () => ({ data: [] }) }));
vi.mock('$lib/features/volunteers', () => ({ useVolunteers: () => ({ data: [] }) }));
vi.mock('$lib/features/operations', () => ({ useStoragePoints: () => ({ points: [] }) }));
vi.mock('$lib/stores/shelter.svelte', () => ({ shelterStore: { selectedShelterCode: 'SH001' } }));
vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: { isAuthenticated: true, markNeedsReauth: () => {} }
}));
vi.mock('$lib/db/shelter', () => ({ getShelterCode: () => 'SH001' }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

function makeRow(id: string, status: string, extra: Record<string, unknown> = {}) {
	return {
		pool: {
			_id: id,
			name: `Pool ${id}`,
			status,
			created_by: 'u1',
			created_at: '2026-01-01T00:00:00.000Z',
			...extra
		},
		entries: [],
		items: [],
		late_entries: [],
		closed_loan_refs: [],
		snapshot_conflicts: [],
		unresolved_refs: [],
		entry_count: 0
	};
}

function setQuery(next: {
	data?: unknown[];
	isSuccess?: boolean;
	isFetching?: boolean;
	isLoading?: boolean;
	isError?: boolean;
}) {
	const s = overview.state!;
	s.set('data', next.data ?? []);
	s.set('isSuccess', next.isSuccess ?? false);
	s.set('isFetching', next.isFetching ?? false);
	s.set('isLoading', next.isLoading ?? false);
	s.set('isError', next.isError ?? false);
}

const loaded = (rows: unknown[]) => setQuery({ data: rows, isSuccess: true });

let instance: ReturnType<typeof mount> | null = null;

async function render(props: Record<string, unknown>) {
	instance = mount(BulkReturnPoolBoard, { target: document.body, props });
	flushSync();
	await tick();
	flushSync();
}

beforeEach(() => {
	overview.state = new SvelteMap<string, unknown>();
	stubs.detail = null;
	stubs.openDialog = null;
	sonner.warning.mockClear();
	sonner.error.mockClear();
	setQuery({ isLoading: true });
});

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('bulk pool board deep link (#921)', () => {
	it('toasts once and clears the selection for a pool that is not in the data', async () => {
		const onSelectedPoolChange = vi.fn();
		await render({ initialPoolId: 'missing', onSelectedPoolChange });

		// No toast while loading.
		expect(sonner.warning).not.toHaveBeenCalled();
		expect(onSelectedPoolChange).not.toHaveBeenCalled();

		loaded([makeRow('a', 'OPEN')]);
		flushSync();

		expect(sonner.warning).toHaveBeenCalledOnce();
		expect(sonner.warning).toHaveBeenCalledWith(BULK_RETURN_POOL_NOT_FOUND_TOAST);
		expect(onSelectedPoolChange).toHaveBeenCalledExactlyOnceWith(null);
		expect(stubs.detail?.row).toBeNull();
	});

	it('does not decide while the query is fetching or erroring', async () => {
		const onSelectedPoolChange = vi.fn();
		await render({ initialPoolId: 'missing', onSelectedPoolChange });

		setQuery({ data: [makeRow('a', 'OPEN')], isSuccess: true, isFetching: true });
		flushSync();
		setQuery({ isError: true });
		flushSync();

		expect(sonner.warning).not.toHaveBeenCalled();
		expect(onSelectedPoolChange).not.toHaveBeenCalled();
	});

	it('does not toast a second time for the same id after a refetch', async () => {
		const onSelectedPoolChange = vi.fn();
		await render({ initialPoolId: 'missing', onSelectedPoolChange });
		loaded([makeRow('a', 'OPEN')]);
		flushSync();
		expect(sonner.warning).toHaveBeenCalledOnce();

		setQuery({ data: [makeRow('a', 'OPEN')], isSuccess: true, isFetching: true });
		flushSync();
		loaded([makeRow('a', 'OPEN'), makeRow('b', 'OPEN')]);
		flushSync();

		expect(sonner.warning).toHaveBeenCalledOnce();
		expect(onSelectedPoolChange).toHaveBeenCalledOnce();
	});

	it('opens a known pool that view filters hide (old RECEIVED, CANCELLED) without a toast', async () => {
		const rows = [
			makeRow('old', 'RECEIVED', { received_at: '2000-01-01T00:00:00.000Z' }),
			makeRow('gone', 'CANCELLED')
		];
		// Read through a function so TS does not narrow stubs.detail to null from the reset below.
		const detailRow = () => stubs.detail?.row;
		for (const id of ['old', 'gone']) {
			const onSelectedPoolChange = vi.fn();
			stubs.detail = null;
			loaded(rows);
			await render({ initialPoolId: id, onSelectedPoolChange });

			expect(detailRow()?.pool._id).toBe(id);
			expect(sonner.warning).not.toHaveBeenCalled();
			expect(onSelectedPoolChange).not.toHaveBeenCalled();

			unmount(instance!);
			instance = null;
			document.body.innerHTML = '';
		}
	});

	it('does not toast a just-opened pool that the overview does not contain yet', async () => {
		loaded([makeRow('a', 'OPEN')]);
		const onSelectedPoolChange = vi.fn();
		await render({ onSelectedPoolChange });
		// Open the dialog from the header button so the stub receives the board callbacks.
		const openButton = [...document.body.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('เปิดกองใหม่')
		) as HTMLButtonElement;
		openButton.click();
		flushSync();

		stubs.openDialog?.onOpened({ _id: 'fresh' });
		flushSync();
		await tick();
		flushSync();

		expect(onSelectedPoolChange).toHaveBeenCalledExactlyOnceWith('fresh');
		expect(sonner.warning).not.toHaveBeenCalled();
	});
});
