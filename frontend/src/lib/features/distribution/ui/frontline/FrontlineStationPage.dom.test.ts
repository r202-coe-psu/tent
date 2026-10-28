// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import FrontlineStationPage from './FrontlineStationPage.svelte';

type BoardProps = {
	shelterCode?: string;
	initialPoolId?: string | null;
	onSelectedPoolChange?: (poolId: string | null) => void;
};

const board = vi.hoisted(() => ({ props: null as BoardProps | null }));

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
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

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

beforeEach(() => {
	board.props = null;
});

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('frontline station returns tab wiring (#921)', () => {
	it('passes the deep-linked pool and shelter to the board on the returns tab', async () => {
		await render({ initialTab: 'returns', initialPoolId: 'p1' });

		expect(boardMarker()).not.toBeNull();
		expect(board.props?.initialPoolId).toBe('p1');
		expect(board.props?.shelterCode).toBe('SH001');
	});

	it('forwards pool selection changes from the board to the page callback', async () => {
		const onSelectedPoolChange = vi.fn();
		await render({ initialTab: 'returns', initialPoolId: 'p1', onSelectedPoolChange });

		board.props?.onSelectedPoolChange?.('p2');

		expect(onSelectedPoolChange).toHaveBeenCalledWith('p2');
	});

	it('reports a tab switch and drops the board when leaving the returns tab', async () => {
		const onTabChange = vi.fn();
		await render({ initialTab: 'returns', onTabChange });

		tabButton('2. แจกอาหารปรุงสุก').click();
		flushSync();

		expect(onTabChange).toHaveBeenCalledWith('food');
		expect(boardMarker()).toBeNull();
	});

	it('does not render the board outside the returns tab', async () => {
		await render({ initialTab: 'receive' });

		expect(boardMarker()).toBeNull();
		expect(board.props).toBeNull();
	});
});
