// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import FrontlineStationPage from './FrontlineStationPage.svelte';

type BoardProps = {
	shelterCode?: string;
	initialPoolId?: string | null;
	onSelectedPoolChange?: (poolId: string | null) => void;
};

const board = vi.hoisted(() => ({ props: null as BoardProps | null }));
const nav = vi.hoisted(() => ({ replaceState: vi.fn() }));
const appPage = vi.hoisted(() => ({ url: { pathname: '/onsite/distribution' } }));

// Svelte 5 client components are plain `(anchor, props) => void` functions.
vi.mock('../bulk-return/BulkReturnPoolBoard.svelte', () => ({
	default: (anchor: Comment, props: BoardProps) => {
		board.props = props;
		const marker = document.createElement('div');
		marker.dataset.testid = 'board-stub';
		anchor.before(marker);
	}
}));
vi.mock('./FoodDistributionCard.svelte', () => ({ default: () => {} }));
vi.mock('./SuppliesDistributionCard.svelte', () => ({ default: () => {} }));
vi.mock('./LoanReturnCard.svelte', () => ({ default: () => {} }));
vi.mock('./ShiftReconciliationCard.svelte', () => ({ default: () => {} }));
vi.mock('../common/DistributionHistory.svelte', () => ({ default: () => {} }));
vi.mock('../common/TicketStatusBadge.svelte', () => ({ default: () => {} }));

vi.mock('../../application/queries', () => ({
	resolveAuthenticatedAuthorContext: () => ({}),
	useRequisitionTickets: () => ({ data: [], isPending: false, isError: false }),
	useReceiveTicketAtDistributionPoint: () => ({ mutateAsync: vi.fn(), isPending: false })
}));
vi.mock('../../application/food-supplies/auth', () => ({
	canPerformFrontlineDistribution: () => true
}));
vi.mock('$lib/stores/shelter.svelte', () => ({ shelterStore: { selectedShelterCode: 'SH001' } }));
vi.mock('$lib/db/shelter', () => ({ getShelterCode: () => 'SH001' }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('$app/navigation', () => ({ replaceState: nav.replaceState }));
vi.mock('$app/state', () => ({ page: appPage }));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const MODE_STORAGE_KEY = 'distribution-desk-mode';

let instance: ReturnType<typeof mount> | null = null;

async function render(props: Record<string, unknown>) {
	instance = mount(FrontlineStationPage, { target: document.body, props });
	flushSync();
	await tick();
	flushSync();
}

const boardMarker = () => document.body.querySelector('[data-testid="board-stub"]');
const tabButton = (label: string) =>
	[...document.body.querySelectorAll('button')].find((b) =>
		b.textContent?.includes(label)
	) as HTMLButtonElement;
const modeButton = (label: string) =>
	[...document.body.querySelectorAll('[role="group"] button')].find((b) =>
		b.textContent?.trim().startsWith(label)
	) as HTMLButtonElement;
const click = (button: HTMLButtonElement) => {
	button.click();
	flushSync();
};
const lastUrl = () => nav.replaceState.mock.lastCall?.[0];

beforeEach(() => {
	board.props = null;
	nav.replaceState.mockClear();
	appPage.url.pathname = '/onsite/distribution';
	localStorage.clear();
});

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('frontline station returns tab wiring (#921)', () => {
	it('passes the deep-linked pool and shelter to the board on the returns tab', async () => {
		await render({ initialMode: 'supplies', initialTab: 'returns', initialPoolId: 'p1' });

		expect(boardMarker()).not.toBeNull();
		expect(board.props?.initialPoolId).toBe('p1');
		expect(board.props?.shelterCode).toBe('SH001');
	});

	it('a pool link starts in supplies mode on returns even when the stored mode is food', async () => {
		localStorage.setItem(MODE_STORAGE_KEY, 'food');
		await render({ initialMode: 'supplies', initialTab: 'returns', initialPoolId: 'p1' });

		expect(modeButton('สิ่งของ').getAttribute('aria-pressed')).toBe('true');
		expect(modeButton('อาหาร').getAttribute('aria-pressed')).toBe('false');
		expect(board.props?.initialPoolId).toBe('p1');
		// FR-DFS-06: the linked mode is remembered; the initial load does not write the URL.
		expect(localStorage.getItem(MODE_STORAGE_KEY)).toBe('supplies');
		expect(nav.replaceState).not.toHaveBeenCalled();
	});

	it('uses the stored mode when the link carries none', async () => {
		localStorage.setItem(MODE_STORAGE_KEY, 'supplies');
		await render({});

		expect(modeButton('สิ่งของ').getAttribute('aria-pressed')).toBe('true');
		expect(nav.replaceState).not.toHaveBeenCalled();
	});

	it('follows a later initialMode, initialTab and initialPoolId change', async () => {
		const state = new SvelteMap<string, unknown>([
			['initialMode', null],
			['initialTab', 'receive'],
			['initialPoolId', null]
		]);
		await render({
			get initialMode() {
				return state.get('initialMode');
			},
			get initialTab() {
				return state.get('initialTab');
			},
			get initialPoolId() {
				return state.get('initialPoolId');
			}
		});
		expect(boardMarker()).toBeNull();

		state.set('initialMode', 'supplies');
		state.set('initialTab', 'returns');
		state.set('initialPoolId', 'p1');
		flushSync();

		expect(boardMarker()).not.toBeNull();
		expect(board.props?.initialPoolId).toBe('p1');
		expect(modeButton('สิ่งของ').getAttribute('aria-pressed')).toBe('true');
	});

	it('does not render the board outside the returns tab', async () => {
		await render({ initialTab: 'receive' });

		expect(boardMarker()).toBeNull();
		expect(board.props).toBeNull();
	});
});

describe('frontline station URL writes', () => {
	it('selecting a tab writes mode and tab with no pool', async () => {
		await render({ initialMode: 'supplies', initialTab: 'returns', initialPoolId: 'p1' });

		click(tabButton('2. จ่ายพัสดุ'));

		expect(lastUrl()).toBe('/onsite/distribution?mode=supplies&tab=supplies');
		expect(nav.replaceState).toHaveBeenLastCalledWith(
			'/onsite/distribution?mode=supplies&tab=supplies',
			{}
		);
		expect(boardMarker()).toBeNull();
	});

	it('opening and closing a pool writes the full URL on the returns tab', async () => {
		await render({ initialMode: 'supplies', initialTab: 'returns' });

		board.props?.onSelectedPoolChange?.('p 2');
		flushSync();
		expect(lastUrl()).toBe('/onsite/distribution?mode=supplies&tab=returns&pool=p%202');
		expect(board.props?.initialPoolId).toBe('p 2');

		board.props?.onSelectedPoolChange?.(null);
		flushSync();
		expect(lastUrl()).toBe('/onsite/distribution?mode=supplies&tab=returns');
		expect(board.props?.initialPoolId).toBeNull();
	});

	it('closing a deep-linked pool keeps it closed when the user returns to the tab', async () => {
		await render({ initialMode: 'supplies', initialTab: 'returns', initialPoolId: 'p1' });

		board.props?.onSelectedPoolChange?.(null);
		flushSync();
		click(tabButton('1. รับของถึงจุดแจก'));
		click(tabButton('3. รับคืนสิ่งของ'));

		expect(lastUrl()).toBe('/onsite/distribution?mode=supplies&tab=returns');
		expect(board.props?.initialPoolId).toBeNull();
	});

	it('leaving returns drops the pool', async () => {
		await render({ initialMode: 'supplies', initialTab: 'returns', initialPoolId: 'p1' });

		click(tabButton('1. รับของถึงจุดแจก'));
		expect(lastUrl()).toBe('/onsite/distribution?mode=supplies&tab=receive');

		click(tabButton('3. รับคืนสิ่งของ'));
		expect(lastUrl()).toBe('/onsite/distribution?mode=supplies&tab=returns');
		expect(board.props?.initialPoolId).toBeNull();
	});

	it('a mode switch keeps a shared tab and writes the whole URL', async () => {
		await render({ initialMode: 'supplies', initialTab: 'reconciliation' });

		click(modeButton('อาหาร'));

		expect(lastUrl()).toBe('/onsite/distribution?mode=food&tab=reconciliation');
		expect(localStorage.getItem(MODE_STORAGE_KEY)).toBe('food');
	});

	it('a mode switch away from returns restarts at step 1 and drops the pool', async () => {
		await render({ initialMode: 'supplies', initialTab: 'returns', initialPoolId: 'p1' });

		click(modeButton('อาหาร'));

		expect(lastUrl()).toBe('/onsite/distribution?mode=food&tab=receive');
		expect(boardMarker()).toBeNull();

		click(modeButton('สิ่งของ'));
		click(tabButton('3. รับคืนสิ่งของ'));
		expect(lastUrl()).toBe('/onsite/distribution?mode=supplies&tab=returns');
		expect(board.props?.initialPoolId).toBeNull();
	});

	it('does not write the URL once the user has navigated away from the desk', async () => {
		await render({ initialMode: 'supplies', initialTab: 'returns', initialPoolId: 'p1' });
		appPage.url.pathname = '/portal';

		click(tabButton('2. จ่ายพัสดุ'));
		board.props?.onSelectedPoolChange?.('p2');
		flushSync();

		expect(nav.replaceState).not.toHaveBeenCalled();
	});

	it('a local mode switch is not undone by the props', async () => {
		await render({ initialMode: 'supplies', initialTab: 'receive' });

		click(modeButton('อาหาร'));
		click(tabButton('2. แจกอาหารปรุงสุก'));

		expect(lastUrl()).toBe('/onsite/distribution?mode=food&tab=food');
		expect(modeButton('อาหาร').getAttribute('aria-pressed')).toBe('true');
	});
});
