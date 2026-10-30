// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import TicketManagementPage from './TicketManagementPage.svelte';
import { BULK_RETURN_POOL_NOT_FOUND_TOAST } from '../model/bulk-return-copy';

type DetailProps = { row: { pool: { _id: string } } | null };

const stubs = vi.hoisted(() => ({ detail: null as DetailProps | null }));
const env = vi.hoisted(() => ({
	// Reactive URL + overview query state; filled in beforeEach (needs the svelte import).
	url: null as Map<string, unknown> | null,
	overview: null as Map<string, unknown> | null,
	goto: vi.fn(),
	refetch: vi.fn()
}));
const sonner = vi.hoisted(() => ({ warning: vi.fn(), error: vi.fn(), success: vi.fn() }));

vi.mock('svelte-sonner', () => ({ toast: sonner }));

// Page-level children that are irrelevant to the pool link.
vi.mock('./TicketGroupTabs.svelte', () => ({ default: () => {} }));
vi.mock('./TicketFilters.svelte', () => ({ default: () => {} }));
vi.mock('./TicketTable.svelte', () => ({ default: () => {} }));
vi.mock('./CreateTicketDialog.svelte', () => ({ default: () => {} }));
vi.mock('./TicketDetailShell.svelte', () => ({ default: () => {} }));
vi.mock('$lib/components/ui/tabs/index.js', () => ({
	Root: () => {},
	List: () => {},
	Trigger: () => {}
}));

// Board children; the board itself is the real one.
vi.mock('../bulk-return/BulkReturnPoolDetail.svelte', () => ({
	default: (_anchor: Comment, props: DetailProps) => {
		stubs.detail = props;
	}
}));
vi.mock('../bulk-return/OpenBulkReturnPoolDialog.svelte', () => ({ default: () => {} }));
vi.mock('../bulk-return/BulkReturnPoolWorkQueue.svelte', () => ({ default: () => {} }));
vi.mock('../bulk-return/BulkReturnPoolLifecycleActions.svelte', () => ({ default: () => {} }));
vi.mock('../bulk-return/AddBulkReturnEntriesDialog.svelte', () => ({ default: () => {} }));
vi.mock('../model/bulk-return-work-queue', () => ({ workQueuesFor: () => [] }));

vi.mock('../../application/queries', () => ({
	resolveAuthenticatedAuthorContext: () => ({}),
	useRequisitionTickets: () => ({
		data: [],
		isLoading: false,
		isError: false,
		error: null
	}),
	useBulkReturnSkippedDocs: () => ({ data: [] }),
	useBulkReturnPoolOverview: () => ({
		get data() {
			return env.overview?.get('data');
		},
		get isSuccess() {
			return env.overview?.get('isSuccess');
		},
		get isFetching() {
			return env.overview?.get('isFetching');
		},
		get isLoading() {
			return env.overview?.get('isLoading');
		},
		get isError() {
			return env.overview?.get('isError');
		},
		get dataUpdatedAt() {
			return env.overview?.get('dataUpdatedAt');
		},
		isPlaceholderData: false,
		error: null,
		refetch: env.refetch
	})
}));
vi.mock('../../application/food-supplies/auth', () => ({
	canCreateTicket: () => false,
	canDispatchTicket: () => false,
	canReceiveWarehouseReturns: () => false,
	canPerformFrontlineDistribution: () => false,
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
vi.mock('$app/navigation', () => ({ goto: env.goto }));
vi.mock('$app/state', () => ({
	page: {
		get url() {
			return new URL(String(env.url?.get('href')));
		}
	}
}));

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

function setOverview(next: { data?: unknown[]; isSuccess?: boolean; isLoading?: boolean }) {
	const s = env.overview!;
	// Data is "as of now": never older than a link that arrived before this call.
	s.set('dataUpdatedAt', Date.now());
	s.set('data', next.data ?? []);
	s.set('isSuccess', next.isSuccess ?? false);
	s.set('isFetching', false);
	s.set('isLoading', next.isLoading ?? false);
	s.set('isError', false);
}

const ORIGIN = 'http://localhost';
let instance: ReturnType<typeof mount> | null = null;

async function render(search: string) {
	env.url!.set('href', `${ORIGIN}/back-office/distribution${search}`);
	instance = mount(TicketManagementPage, { target: document.body });
	flushSync();
	await tick();
	flushSync();
}

beforeEach(() => {
	env.url = new SvelteMap<string, unknown>();
	env.overview = new SvelteMap<string, unknown>();
	stubs.detail = null;
	sonner.warning.mockClear();
	env.goto.mockReset();
	env.refetch.mockReset();
	// A replaceState navigation rewrites the (reactive) page URL, like SvelteKit does.
	env.goto.mockImplementation((href: string) => {
		env.url!.set('href', `${ORIGIN}${href}`);
		return Promise.resolve();
	});
	setOverview({ isLoading: true });
});

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('back office pool deep link (#921)', () => {
	it('an unknown pool toasts once and the URL keeps view=bulk_pools without pool', async () => {
		await render('?view=bulk_pools&pool=missing');
		// No toast and no URL write while the overview is loading.
		expect(sonner.warning).not.toHaveBeenCalled();
		expect(env.goto).not.toHaveBeenCalled();

		setOverview({ data: [makeRow('a', 'OPEN')], isSuccess: true });
		flushSync();
		await tick();
		flushSync();

		expect(sonner.warning).toHaveBeenCalledOnce();
		expect(sonner.warning).toHaveBeenCalledWith(BULK_RETURN_POOL_NOT_FOUND_TOAST);
		expect(env.goto).toHaveBeenCalledOnce();
		expect(env.goto.mock.calls[0][0]).toBe('/back-office/distribution?view=bulk_pools');
		expect(env.goto.mock.calls[0][1]).toMatchObject({ replaceState: true });
		expect(env.url!.get('href')).toBe(`${ORIGIN}/back-office/distribution?view=bulk_pools`);
	});

	it('a known pool hidden by the view filters opens its detail without a toast', async () => {
		const rows = [
			makeRow('old', 'RECEIVED', { received_at: '2000-01-01T00:00:00.000Z' }),
			makeRow('gone', 'CANCELLED')
		];
		// Read through a function so TS does not narrow stubs.detail to null from the reset below.
		const detailRow = () => stubs.detail?.row;
		for (const id of ['old', 'gone']) {
			stubs.detail = null;
			setOverview({ data: rows, isSuccess: true });
			await render(`?view=bulk_pools&pool=${id}`);

			expect(detailRow()?.pool._id).toBe(id);
			expect(sonner.warning).not.toHaveBeenCalled();
			expect(env.goto).not.toHaveBeenCalled();

			unmount(instance!);
			instance = null;
			document.body.innerHTML = '';
		}
	});
});
