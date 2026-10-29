// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import FrontlineStationPage from './FrontlineStationPage.svelte';
import { parseOnsiteDistributionParams } from '../model/pool-url-state';

type BoardProps = {
	shelterCode?: string;
	initialPoolId?: string | null;
	onSelectedPoolChange?: (poolId: string | null) => void;
};

const board = vi.hoisted(() => ({ props: null as BoardProps | null }));
type NavCallback = (navigation: Record<string, unknown>) => void;
const nav = vi.hoisted(() => ({
	replaceState: vi.fn(),
	goto: vi.fn<(...args: unknown[]) => Promise<void>>(),
	beforeNavigate: null as NavCallback | null
}));
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
// Stand-in food form: an input that registers as an FR-DFS-05 draft while it holds text.
vi.mock('./FoodDistributionCard.svelte', () => ({
	default: (anchor: Comment, props: { drafts?: { track: (isDraft: () => boolean) => void } }) => {
		const input = document.createElement('input');
		input.dataset.testid = 'draft-input';
		anchor.before(input);
		props.drafts?.track(() => input.isConnected && input.value !== '');
	}
}));
vi.mock('./SuppliesDistributionCard.svelte', () => ({ default: () => {} }));
vi.mock('./LoanReturnCard.svelte', () => ({ default: () => {} }));
vi.mock('./ShiftReconciliationCard.svelte', () => ({ default: () => {} }));
vi.mock('../common/DistributionHistory.svelte', () => ({ default: () => {} }));
vi.mock('../common/TicketStatusBadge.svelte', () => ({ default: () => {} }));

const queries = vi.hoisted(() => ({
	tickets: [] as unknown[],
	receive: vi.fn<(input: unknown) => Promise<unknown>>()
}));

vi.mock('../../application/queries', () => ({
	resolveAuthenticatedAuthorContext: () => ({}),
	useRequisitionTickets: () => ({
		get data() {
			return queries.tickets;
		},
		isPending: false,
		isError: false
	}),
	useReceiveTicketAtDistributionPoint: () => ({
		mutateAsync: (input: unknown) => queries.receive(input),
		isPending: false
	})
}));
vi.mock('../../application/food-supplies/auth', () => ({
	canPerformFrontlineDistribution: () => true
}));
vi.mock('$lib/stores/shelter.svelte', () => ({ shelterStore: { selectedShelterCode: 'SH001' } }));
vi.mock('$lib/db/shelter', () => ({ getShelterCode: () => 'SH001' }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('$app/navigation', () => ({
	replaceState: nav.replaceState,
	goto: nav.goto,
	beforeNavigate: (callback: NavCallback) => {
		nav.beforeNavigate = callback;
	}
}));
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
	queries.tickets = [];
	queries.receive.mockReset();
	nav.replaceState.mockClear();
	nav.goto.mockReset();
	nav.goto.mockResolvedValue(undefined);
	nav.beforeNavigate = null;
	appPage.url.pathname = '/onsite/distribution';
	localStorage.clear();
});

afterEach(async () => {
	if (instance) unmount(instance);
	instance = null;
	// bits-ui body-scroll-lock cleans up on a 24ms timer; let it run before the env tears down
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
	window.history.replaceState(null, '', '/');
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

	it('a link that changes only the pool re-applies mode, tab and pool together', async () => {
		const state = new SvelteMap<string, unknown>([['initialPoolId', 'p1']]);
		await render({
			initialMode: 'supplies',
			initialTab: 'returns',
			get initialPoolId() {
				return state.get('initialPoolId');
			}
		});

		click(modeButton('อาหาร'));
		expect(modeButton('อาหาร').getAttribute('aria-pressed')).toBe('true');
		expect(boardMarker()).toBeNull();

		state.set('initialPoolId', 'p2');
		flushSync();

		expect(modeButton('สิ่งของ').getAttribute('aria-pressed')).toBe('true');
		expect(tabButton('3. รับคืนสิ่งของ').getAttribute('aria-pressed')).toBe('true');
		expect(boardMarker()).not.toBeNull();
		expect(board.props?.initialPoolId).toBe('p2');
	});

	it('following the same link again (new linkKey) re-applies it after local changes', async () => {
		const state = new SvelteMap<string, unknown>([['linkKey', 0]]);
		await render({
			initialMode: 'supplies',
			initialTab: 'returns',
			initialPoolId: 'p1',
			get linkKey() {
				return state.get('linkKey');
			}
		});

		board.props?.onSelectedPoolChange?.(null);
		flushSync();
		click(modeButton('อาหาร'));
		expect(boardMarker()).toBeNull();

		state.set('linkKey', 1);
		flushSync();

		expect(modeButton('สิ่งของ').getAttribute('aria-pressed')).toBe('true');
		expect(tabButton('3. รับคืนสิ่งของ').getAttribute('aria-pressed')).toBe('true');
		expect(boardMarker()).not.toBeNull();
		expect(board.props?.initialPoolId).toBe('p1');
	});

	it('following the same supplies link again stores supplies after a local switch to food', async () => {
		const state = new SvelteMap<string, unknown>([['linkKey', 0]]);
		await render({
			initialMode: 'supplies',
			initialTab: 'receive',
			get linkKey() {
				return state.get('linkKey');
			}
		});

		click(modeButton('อาหาร'));
		expect(localStorage.getItem(MODE_STORAGE_KEY)).toBe('food');

		state.set('linkKey', 1);
		flushSync();

		expect(modeButton('สิ่งของ').getAttribute('aria-pressed')).toBe('true');
		expect(localStorage.getItem(MODE_STORAGE_KEY)).toBe('supplies');
	});

	it('props parsed from a restored deskSearch open no pool', async () => {
		// Route level: Back restores `page.state.deskSearch`, which the route parses into these props.
		const restored = parseOnsiteDistributionParams(
			new URLSearchParams('mode=supplies&tab=returns')
		);
		await render({
			initialMode: restored.mode,
			initialTab: restored.tab ?? 'receive',
			initialPoolId: restored.pool
		});

		expect(boardMarker()).not.toBeNull();
		expect(board.props?.initialPoolId).toBeNull();
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
			{ deskSearch: 'mode=supplies&tab=supplies' }
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

	it('an unknown pool link drops the pool from the URL and stays on the returns tab', async () => {
		await render({ initialMode: 'supplies', initialTab: 'returns', initialPoolId: 'missing' });
		expect(board.props?.initialPoolId).toBe('missing');

		// The real board reports an unknown pool this way once its overview has loaded.
		board.props?.onSelectedPoolChange?.(null);
		flushSync();

		expect(nav.replaceState).toHaveBeenLastCalledWith(
			'/onsite/distribution?mode=supplies&tab=returns',
			{ deskSearch: 'mode=supplies&tab=returns' }
		);
		expect(modeButton('สิ่งของ').getAttribute('aria-pressed')).toBe('true');
		expect(tabButton('3. รับคืนสิ่งของ').getAttribute('aria-pressed')).toBe('true');
		expect(boardMarker()).not.toBeNull();
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

	it('a receive that resolves after a mode switch does not jump tabs or write a mixed URL', async () => {
		queries.tickets = [
			{
				_id: 't1',
				ticket_no: 'T-1',
				status: 'IN_TRANSIT',
				requisition_type: 'food',
				destination_location: 'P1',
				items: []
			}
		];
		let resolveReceive: () => void = () => {};
		queries.receive.mockReturnValue(
			new Promise<void>((r) => {
				resolveReceive = r;
			})
		);
		await render({ initialMode: 'food', initialTab: 'receive' });

		click(tabButton('ตรวจรับเข้าจุดแจก'));
		click(modeButton('สิ่งของ'));
		nav.replaceState.mockClear();

		resolveReceive();
		await tick();
		flushSync();

		expect(queries.receive).toHaveBeenCalledOnce();
		expect(modeButton('สิ่งของ').getAttribute('aria-pressed')).toBe('true');
		expect(tabButton('1. รับของถึงจุดแจก').getAttribute('aria-pressed')).toBe('true');
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

describe('frontline station links with an unsaved draft (FR-DFS-05)', () => {
	const foodTicket = {
		_id: 't1',
		ticket_no: 'T-1',
		status: 'DISTRIBUTING',
		requisition_type: 'food',
		destination_location: 'P1',
		created_at: '2026-01-01T00:00:00Z',
		items: []
	};

	const draftInput = () =>
		document.body.querySelector('[data-testid="draft-input"]') as HTMLInputElement | null;
	const dialog = () => document.body.querySelector('[role="alertdialog"]');
	const dialogButton = (label: string) =>
		[...document.body.querySelectorAll('[role="alertdialog"] button')].find(
			(b) => b.textContent?.trim() === label
		) as HTMLButtonElement;
	const settle = async () => {
		flushSync();
		await tick();
		flushSync();
	};

	/** Food desk on the food tab, with typed input and a `link` state the test can change. */
	async function renderFoodDeskWithDraft(withDraft = true) {
		queries.tickets = [foodTicket];
		const link = new SvelteMap<string, unknown>([
			['initialMode', 'food'],
			['initialTab', 'food'],
			['initialPoolId', null],
			['linkKey', 0]
		]);
		await render({
			get initialMode() {
				return link.get('initialMode');
			},
			get initialTab() {
				return link.get('initialTab');
			},
			get initialPoolId() {
				return link.get('initialPoolId');
			},
			get linkKey() {
				return link.get('linkKey');
			}
		});
		expect(draftInput()).not.toBeNull();
		if (withDraft) draftInput()!.value = '5';
		return link;
	}

	/** What the route does once a navigation to the supplies pool link completes. */
	function followSuppliesPoolLink(link: SvelteMap<string, unknown>) {
		link.set('initialMode', 'supplies');
		link.set('initialTab', 'returns');
		link.set('initialPoolId', 'p1');
		link.set('linkKey', 1);
		flushSync();
	}

	const SUPPLIES_HREF = '/onsite/distribution?mode=supplies&tab=returns&pool=p1';

	/** Fire SvelteKit's `beforeNavigate` with a fake navigation; returns its `cancel` spy. */
	function fireNav(
		href: string,
		opts: {
			type?: string;
			delta?: number;
			willUnload?: boolean;
			to?: null;
			/** Address bar at the time of the event; popstates default to `href`. */
			location?: string;
		} = {}
	) {
		const url = new URL(href, 'http://localhost');
		if (opts.location !== undefined || opts.type === 'popstate') {
			window.history.replaceState(null, '', opts.location ?? href);
		}
		const cancel = vi.fn();
		nav.beforeNavigate?.({
			type: opts.type ?? 'link',
			to: opts.to === null ? null : { url, route: { id: url.pathname } },
			from: null,
			delta: opts.delta,
			willUnload: opts.willUnload ?? false,
			cancel
		});
		flushSync();
		return cancel;
	}

	it('cancels a mode-changing link with a draft and opens the confirm dialog', async () => {
		await renderFoodDeskWithDraft();

		const cancel = fireNav(SUPPLIES_HREF);
		await settle();

		expect(cancel).toHaveBeenCalledOnce();
		expect(dialog()?.textContent).toContain('สลับไปโหมดสิ่งของ?');
		expect(modeButton('อาหาร').getAttribute('aria-pressed')).toBe('true');
		expect(draftInput()?.value).toBe('5');
		expect(boardMarker()).toBeNull();
		// FR-DFS-06: a held link's mode is not stored.
		expect(localStorage.getItem(MODE_STORAGE_KEY)).not.toBe('supplies');

		click(dialogButton('อยู่โหมดเดิม'));
		await settle();

		// The navigation was already cancelled, so history is intact: nothing to write or re-run.
		expect(dialog()).toBeNull();
		expect(modeButton('อาหาร').getAttribute('aria-pressed')).toBe('true');
		expect(draftInput()?.value).toBe('5');
		expect(nav.replaceState).not.toHaveBeenCalled();
		expect(nav.goto).not.toHaveBeenCalled();
	});

	it('Confirm re-runs the navigation once as a push, without holding it again', async () => {
		const link = await renderFoodDeskWithDraft();
		fireNav(SUPPLIES_HREF);
		await settle();

		click(dialogButton('สลับโหมด'));
		await settle();

		expect(nav.goto).toHaveBeenCalledOnce();
		expect(nav.goto).toHaveBeenCalledWith(SUPPLIES_HREF, { replaceState: false });
		expect(dialog()).toBeNull();
		// Nothing is applied by the dialog itself: the navigation does that through the props.
		expect(modeButton('อาหาร').getAttribute('aria-pressed')).toBe('true');

		// The re-run passes through `beforeNavigate` untouched (one-shot bypass)...
		expect(fireNav(SUPPLIES_HREF)).not.toHaveBeenCalled();
		await settle();
		expect(dialog()).toBeNull();

		// ...and then the new props apply mode, tab and pool.
		followSuppliesPoolLink(link);
		await settle();
		expect(modeButton('สิ่งของ').getAttribute('aria-pressed')).toBe('true');
		expect(tabButton('3. รับคืนสิ่งของ').getAttribute('aria-pressed')).toBe('true');
		expect(boardMarker()).not.toBeNull();
		expect(board.props?.initialPoolId).toBe('p1');
		expect(draftInput()).toBeNull();
		expect(localStorage.getItem(MODE_STORAGE_KEY)).toBe('supplies');
		expect(nav.replaceState).not.toHaveBeenCalled();
	});

	it('the bypass is one-shot: the same navigation later is held again', async () => {
		await renderFoodDeskWithDraft();
		fireNav(SUPPLIES_HREF);
		await settle();
		click(dialogButton('สลับโหมด'));
		await settle();
		expect(fireNav(SUPPLIES_HREF)).not.toHaveBeenCalled();

		expect(fireNav(SUPPLIES_HREF)).toHaveBeenCalledOnce();
	});

	it('holds a popstate too; Confirm replays it with history.go(delta)', async () => {
		await renderFoodDeskWithDraft();
		const go = vi.spyOn(history, 'go').mockImplementation(() => {});

		const cancel = fireNav(SUPPLIES_HREF, { type: 'popstate', delta: -2 });
		await settle();
		expect(cancel).toHaveBeenCalledOnce();
		expect(dialog()).not.toBeNull();

		click(dialogButton('สลับโหมด'));
		await settle();

		expect(go).toHaveBeenCalledOnce();
		expect(go).toHaveBeenCalledWith(-2);
		expect(nav.goto).not.toHaveBeenCalled();
		// The replayed popstate is not held again.
		expect(fireNav(SUPPLIES_HREF, { type: 'popstate', delta: -2 })).not.toHaveBeenCalled();
		go.mockRestore();
	});

	it('a held popstate that is cancelled leaves history alone', async () => {
		await renderFoodDeskWithDraft();
		const go = vi.spyOn(history, 'go').mockImplementation(() => {});

		fireNav(SUPPLIES_HREF, { type: 'popstate', delta: -1 });
		await settle();
		click(dialogButton('อยู่โหมดเดิม'));
		await settle();

		// SvelteKit undoes a cancelled popstate itself (`history.go(-delta)`); the desk does nothing.
		expect(go).not.toHaveBeenCalled();
		expect(nav.goto).not.toHaveBeenCalled();
		expect(nav.replaceState).not.toHaveBeenCalled();
		go.mockRestore();
	});

	it('a popstate reads its target mode from location, not to.url (held)', async () => {
		await renderFoodDeskWithDraft();

		const cancel = fireNav('/onsite/distribution?mode=food&tab=food', {
			type: 'popstate',
			delta: -1,
			location: '/onsite/distribution?mode=supplies&tab=returns'
		});
		await settle();

		expect(cancel).toHaveBeenCalledOnce();
		expect(dialog()).not.toBeNull();
	});

	it('a popstate reads its target mode from location, not to.url (not held)', async () => {
		await renderFoodDeskWithDraft();

		const cancel = fireNav('/onsite/distribution?mode=supplies&tab=supplies', {
			type: 'popstate',
			delta: -1,
			location: '/onsite/distribution?mode=food&tab=food'
		});
		await settle();

		expect(cancel).not.toHaveBeenCalled();
		expect(dialog()).toBeNull();
	});

	it('a link navigation uses to.url even when location differs', async () => {
		await renderFoodDeskWithDraft();

		const cancel = fireNav(SUPPLIES_HREF, {
			location: '/onsite/distribution?mode=food&tab=food'
		});
		await settle();

		expect(cancel).toHaveBeenCalledOnce();
		expect(dialog()).not.toBeNull();
	});

	it('does not cancel a mode-changing navigation when there is no draft', async () => {
		await renderFoodDeskWithDraft(false);

		expect(fireNav(SUPPLIES_HREF)).not.toHaveBeenCalled();
		await settle();

		expect(dialog()).toBeNull();
	});

	it('does not cancel a same-mode navigation with a draft', async () => {
		await renderFoodDeskWithDraft();

		expect(fireNav('/onsite/distribution?mode=food&tab=receive')).not.toHaveBeenCalled();
		await settle();

		expect(dialog()).toBeNull();
		expect(draftInput()?.value).toBe('5');
	});

	it('a link without ?mode= resolves against the stored mode', async () => {
		localStorage.setItem(MODE_STORAGE_KEY, 'food');
		await renderFoodDeskWithDraft();

		expect(fireNav('/onsite/distribution')).not.toHaveBeenCalled();

		localStorage.setItem(MODE_STORAGE_KEY, 'supplies');
		expect(fireNav('/onsite/distribution')).toHaveBeenCalledOnce();
	});

	it('a same-mode navigation while the dialog is open proceeds and drops the stale confirm', async () => {
		await renderFoodDeskWithDraft();
		fireNav(SUPPLIES_HREF);
		await settle();
		expect(dialog()).not.toBeNull();

		// e.g. Back to an entry of the mode the desk is still in.
		const cancel = fireNav('/onsite/distribution?mode=food&tab=receive', { type: 'popstate' });
		await settle();

		expect(cancel).not.toHaveBeenCalled();
		expect(dialog()).toBeNull();
		expect(nav.goto).not.toHaveBeenCalled();
	});

	it('ignores other routes, unloads and navigations with no target', async () => {
		await renderFoodDeskWithDraft();

		expect(fireNav('/portal')).not.toHaveBeenCalled();
		expect(fireNav(SUPPLIES_HREF, { willUnload: true })).not.toHaveBeenCalled();
		expect(fireNav(SUPPLIES_HREF, { type: 'leave', to: null })).not.toHaveBeenCalled();
		await settle();

		expect(dialog()).toBeNull();
	});
});
