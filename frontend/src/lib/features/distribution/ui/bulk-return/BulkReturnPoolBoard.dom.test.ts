// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type { ComponentProps } from 'svelte';
import type {
	BulkReturnEntry,
	BulkReturnPoolOverviewRow,
	BulkReturnPoolV3
} from '../../domain/food-supplies';
import { compoundCapabilityRole } from '$lib/auth/roles';
import { WORK_QUEUE_COPY } from '../model/bulk-return-work-queue';
import { myPoolPointKey } from '../model/my-pool-point-storage';
import BulkReturnPoolBoard from './BulkReturnPoolBoard.svelte';

type EntryRow = BulkReturnPoolOverviewRow['entries'][number];
type ItemRow = BulkReturnPoolOverviewRow['items'][number];

type OverviewState = {
	data?: BulkReturnPoolOverviewRow[];
	isLoading: boolean;
	isError: boolean;
	error: unknown;
	refetch: () => void;
};

const state = vi.hoisted(() => ({
	overview: {
		data: [],
		isLoading: false,
		isError: false,
		error: null,
		refetch: () => {}
	} as OverviewState,
	// `null` makes resolveAuthenticatedAuthorContext throw (the board must fail closed).
	authContext: null as { shelterCode: string; createdBy: string; roles: string[] } | null,
	evacuees: [] as unknown[],
	skippedDocs: [] as unknown[],
	// Props the board passed to the (mocked) detail sheet; read lazily, they are getter-backed.
	detailProps: null as { row?: BulkReturnPoolOverviewRow | null } | null
}));
// Records the shelter code the board resolves the author context for.
const authorContextCalls = vi.hoisted(() => vi.fn<(shelterCode?: string) => void>());

vi.mock('../../application/queries', () => ({
	useBulkReturnPoolOverview: () => state.overview,
	useBulkReturnSkippedDocs: () => ({ data: state.skippedDocs }),
	resolveAuthenticatedAuthorContext: (shelterCode?: string) => {
		authorContextCalls(shelterCode);
		if (!state.authContext) throw new Error('Unauthenticated');
		return state.authContext;
	}
}));
vi.mock('$lib/features/catalog', () => ({
	useItemMasters: () => ({
		data: [
			{ _id: 'item_master:blanket', name: 'ผ้าห่ม', base_unit: 'ผืน' },
			{ _id: 'item_master:rice', name: 'ข้าวสาร', base_unit: 'ถุง' }
		]
	})
}));
// Signature-agnostic on purpose: the board's call arguments for useEvacuees may change.
vi.mock('$lib/features/people', () => ({
	useEvacuees: () => ({ data: state.evacuees })
}));
vi.mock('$lib/features/volunteers', () => ({ useVolunteers: () => ({ data: [] }) }));
vi.mock('$lib/features/operations', () => ({ useStoragePoints: () => ({ points: [] }) }));
vi.mock('$lib/db/shelter', () => ({ getShelterCode: () => 'SH001' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

// Heavy children (own queries, sheets, dialogs) are out of scope for the board test.
// Svelte 5 calls a component as `Component(anchor, props)`.
vi.mock('./BulkReturnPoolDetail.svelte', () => ({
	default: (_anchor: unknown, props: { row?: BulkReturnPoolOverviewRow | null }) => {
		state.detailProps = props;
	}
}));
vi.mock('./BulkReturnPoolLifecycleActions.svelte', () => ({ default: () => {} }));
vi.mock('./OpenBulkReturnPoolDialog.svelte', () => ({ default: () => {} }));
vi.mock('./AddBulkReturnEntriesDialog.svelte', () => ({ default: () => {} }));

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();

function makePool(id: string, overrides: Partial<BulkReturnPoolV3> = {}): BulkReturnPoolV3 {
	return {
		_id: `bulk_return_pool:${id}`,
		type: 'bulk_return_pool',
		schema_v: 3,
		shelter_code: 'SH001',
		created_at: daysAgo(1),
		updated_at: daysAgo(1),
		created_by: 'staff',
		name: `Pool ${id}`,
		status: 'OPEN',
		...overrides
	} as BulkReturnPoolV3;
}

function makeEntry(id: string, overrides: Partial<BulkReturnEntry> = {}): BulkReturnEntry {
	return {
		_id: `bulk_return_entry:${id}`,
		type: 'bulk_return_entry',
		schema_v: 1,
		shelter_code: 'SH001',
		created_at: daysAgo(1),
		updated_at: daysAgo(1),
		created_by: 'staff',
		pool_id: 'bulk_return_pool:a',
		item_id: 'item_master:blanket',
		qty: '3',
		returner_type: 'unspecified',
		returner_id: null,
		loan_refs: [],
		...overrides
	} as BulkReturnEntry;
}

const resolved = (entry: BulkReturnEntry): EntryRow => ({
	entry,
	pool_id: entry.pool_id,
	voided: false
});

function makeRow(
	pool: BulkReturnPoolV3,
	opts: { items?: ItemRow[]; entries?: EntryRow[]; late?: EntryRow[] } = {}
): BulkReturnPoolOverviewRow {
	const entries = opts.entries ?? [];
	return {
		pool,
		entry_count: entries.length,
		items: opts.items ?? [],
		entries,
		late_entries: opts.late ?? [],
		snapshot_conflicts: [],
		unresolved_refs: [],
		closed_loan_refs: [],
		is_empty: entries.length === 0
	};
}

const item = (item_id: string, qty: string) => ({ item_id, qty }) as ItemRow;

function sampleRows(): BulkReturnPoolOverviewRow[] {
	return [
		makeRow(
			makePool('a', {
				name: 'กองผ้าห่ม',
				status: 'OPEN',
				location_storage_point_id: 'sp:1',
				location_storage_zone: 'โซน A'
			}),
			{
				items: [item('item_master:blanket', '3')],
				entries: [
					resolved(makeEntry('e1', { returner_type: 'evacuee', returner_id: 'evacuee:somchai' }))
				]
			}
		),
		makeRow(
			makePool('b', {
				name: 'กองอาหาร',
				status: 'SUBMITTED',
				submitted_at: daysAgo(1),
				location_storage_point_id: 'sp:2',
				location_storage_zone: 'โซน B'
			}),
			{
				items: [item('item_master:rice', '5')],
				late: [
					resolved(makeEntry('e2', { pool_id: 'bulk_return_pool:b', item_id: 'item_master:rice' }))
				]
			}
		),
		makeRow(makePool('c', { name: 'กองตรวจรับแล้ว', status: 'RECEIVED', received_at: daysAgo(1) })),
		makeRow(
			makePool('d', { name: 'กองตรวจรับเก่า', status: 'RECEIVED', received_at: daysAgo(30) })
		),
		makeRow(makePool('e', { name: 'กองยกเลิก', status: 'CANCELLED' }))
	];
}

const ADMIN = { shelterCode: 'SH001', createdBy: 'staff', roles: ['system_admin'] };
const NO_ROLE = { shelterCode: 'SH001', createdBy: 'staff', roles: [] };
const withCapability = (capability: Parameters<typeof compoundCapabilityRole>[1]) => ({
	shelterCode: 'SH001',
	createdBy: 'staff',
	roles: ['shelter:SH001', compoundCapabilityRole('SH001', capability)]
});

let instance: ReturnType<typeof mount> | null = null;

async function settle() {
	flushSync();
	await tick();
	flushSync();
}

async function render(
	overview: Partial<OverviewState> = {},
	props: ComponentProps<typeof BulkReturnPoolBoard> = {}
) {
	state.overview = {
		data: sampleRows(),
		isLoading: false,
		isError: false,
		error: null,
		refetch: vi.fn(),
		...overview
	};
	instance = mount(BulkReturnPoolBoard, {
		target: document.body,
		props: { shelterCode: 'SH001', ...props }
	});
	await settle();
}

const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';

/**
 * Pool names currently listed as cards on the board (not the work queues).
 * Layout-coupled: the card has no test id, so this relies on `ul.grid > li > button` and the
 * `span.font-semibold` name element.
 */
function cardNames(): string[] {
	return [...document.body.querySelectorAll('ul.grid > li > button')].map(
		(button) => button.querySelector('span.font-semibold')?.textContent?.trim() ?? ''
	);
}

/** The pool card button whose name span is exactly `name`. */
function cardByName(name: string): HTMLButtonElement {
	const card = [...document.body.querySelectorAll<HTMLButtonElement>('ul.grid > li > button')].find(
		(button) => button.querySelector('span.font-semibold')?.textContent?.trim() === name
	);
	if (!card) throw new Error(`pool card not found: ${name}`);
	return card;
}

function buttonByText(root: ParentNode, label: string): HTMLButtonElement | undefined {
	return [...root.querySelectorAll('button')].find((b) => b.textContent?.includes(label));
}

/** Normalized, trimmed text of a status chip, e.g. "ทั้งหมด 3". */
const chipText = (label: string) => statusChip(label).textContent?.replace(/\s+/g, ' ').trim();

const queryByTestId = (id: string) => document.body.querySelector(`[data-testid="${id}"]`);

function statusChip(label: string): HTMLButtonElement {
	const group = document.body.querySelector('[role="group"][aria-label="กรองกองรับคืนตามสถานะ"]');
	const chip = group && buttonByText(group, label);
	if (!chip) throw new Error(`status chip not found: ${label}`);
	return chip;
}

async function typeSearch(value: string) {
	const input = document.body.querySelector('input[type="search"]') as HTMLInputElement;
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	await settle();
}

async function clickSwitch(id: string) {
	const toggle = document.getElementById(id);
	if (!toggle) throw new Error(`switch not found: ${id}`);
	toggle.click();
	await settle();
}

beforeEach(() => {
	state.authContext = ADMIN;
	state.evacuees = [];
	state.skippedDocs = [];
	state.detailProps = null;
	authorContextCalls.mockClear();
	localStorage.clear();
});

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
	localStorage.clear();
});

describe('BulkReturnPoolBoard mount and selection', () => {
	// Smoke: mount and first paint through the full derived chain (rows -> filter -> view state).
	// Note: the 6aec2cd98 declaration-order bug is caught by svelte-check, not by this runtime mount.
	it('mounts with realistic data and renders the headings and pool cards', async () => {
		await render();

		const headings = [...document.body.querySelectorAll('h2')].map((h) => h.textContent?.trim());
		expect(headings).toContain('กองรับคืน');
		expect(text()).toContain('ศูนย์ SH001');
		expect(document.body.querySelector('[data-testid="bulk-return-work-queues"]')).not.toBeNull();
		// Default view: open, submitted and recently received pools; cancelled and old received hidden.
		expect(cardNames().sort()).toEqual(['กองตรวจรับแล้ว', 'กองผ้าห่ม', 'กองอาหาร'].sort());
		// Scoped to pool a's item row: the pool name 'กองผ้าห่ม' alone also contains 'ผ้าห่ม'.
		const itemRow = cardByName('กองผ้าห่ม').querySelector('ul > li');
		expect(itemRow).not.toBeNull();
		expect(itemRow?.querySelector(':scope > span:first-child')?.textContent?.trim()).toBe('ผ้าห่ม');
		expect(itemRow?.textContent?.replace(/\s+/g, ' ')).toContain('3 ผืน');
		expect(authorContextCalls).toHaveBeenCalledWith('SH001');
	});

	it('passes the deep-linked pool row to the detail sheet', async () => {
		await render({}, { initialPoolId: 'bulk_return_pool:a' });

		expect(cardNames()).toContain('กองผ้าห่ม');
		expect(state.detailProps?.row?.pool._id).toBe('bulk_return_pool:a');
	});

	it('passes no row to the detail sheet without an initial pool id', async () => {
		await render();

		expect(state.detailProps).not.toBeNull();
		expect(state.detailProps?.row ?? null).toBeNull();
	});

	it('mounts while the overview data is still undefined', async () => {
		await render({ data: undefined, isLoading: true });

		const loading = [...document.body.querySelectorAll('[role="status"]')].find((el) =>
			el.textContent?.includes('กำลังโหลดข้อมูลกองรับคืน')
		);
		expect(loading).toBeDefined();
		expect(cardNames()).toEqual([]);
	});

	it('calls onSelectedPoolChange with the pool id when a card is clicked', async () => {
		const onSelectedPoolChange = vi.fn();
		await render({}, { onSelectedPoolChange });

		cardByName('กองผ้าห่ม').click();
		await settle();

		expect(onSelectedPoolChange).toHaveBeenCalledWith('bulk_return_pool:a');
		// Detail is re-rendered in a {#key selectedPoolId} block with row={selectedRow}.
		expect(state.detailProps?.row?.pool._id).toBe('bulk_return_pool:a');
	});
});

describe('BulkReturnPoolBoard filters', () => {
	it('status chip counts exclude cancelled and old received pools by default', async () => {
		await render();

		expect(chipText('ทั้งหมด')).toBe('ทั้งหมด 3');
		expect(chipText('เปิดรับ')).toBe('เปิดรับ 1');
		expect(chipText('รอตรวจสอบ')).toBe('รอตรวจสอบ 1');
		expect(chipText('ตรวจรับแล้ว')).toBe('ตรวจรับแล้ว 1');
	});

	it('narrows the list to one status when a status chip is clicked', async () => {
		await render();

		statusChip('เปิดรับ').click();
		await settle();

		expect(cardNames()).toEqual(['กองผ้าห่ม']);
		expect(statusChip('เปิดรับ').getAttribute('aria-pressed')).toBe('true');
		expect(statusChip('ทั้งหมด').getAttribute('aria-pressed')).toBe('false');

		statusChip('ทั้งหมด').click();
		await settle();
		expect(cardNames()).toHaveLength(3);
	});

	it('filters by pool name from the search box', async () => {
		await render();

		await typeSearch('อาหาร');

		expect(cardNames()).toEqual(['กองอาหาร']);
	});

	it('filters by returner name through the loaded evacuee roster', async () => {
		state.evacuees = [
			{ _id: 'evacuee:somchai', first_name: 'สมชาย', last_name: 'ใจดี', nickname: 'ชาย' }
		];
		await render();

		await typeSearch('สมชาย');

		expect(cardNames()).toEqual(['กองผ้าห่ม']);
	});

	it('finds no card by returner name when the evacuee roster is empty (negative control)', async () => {
		state.evacuees = [];
		await render();

		await typeSearch('สมชาย');

		expect(cardNames()).toEqual([]);
	});

	it('shows cancelled pools only when the cancelled toggle is on', async () => {
		await render();
		expect(cardNames()).not.toContain('กองยกเลิก');

		await clickSwitch('bulk-pool-show-cancelled');

		expect(cardNames()).toContain('กองยกเลิก');
	});

	it('hides old received pools until the old-received toggle is on', async () => {
		await render();
		expect(cardNames()).not.toContain('กองตรวจรับเก่า');

		await clickSwitch('bulk-pool-show-old-received');

		expect(cardNames()).toContain('กองตรวจรับเก่า');
	});

	it('keeps only pools needing attention with the "ต้องจัดการ" toggle', async () => {
		await render();

		await clickSwitch('bulk-pool-needs-attention');

		expect(cardNames()).toEqual(['กองอาหาร']);
	});

	it('offers the item filter and, with two storage zones, the storage filter', async () => {
		await render();

		expect(document.body.querySelector('[aria-label="กรองตามชนิดสินค้า"]')).not.toBeNull();
		expect(document.body.querySelector('[aria-label="กรองตามที่เก็บ"]')).not.toBeNull();
	});

	it('hides the storage filter when there are fewer than two storage options', async () => {
		await render({
			data: [
				makeRow(makePool('a', { location_storage_point_id: 'sp:1' })),
				makeRow(makePool('b', { location_storage_point_id: 'sp:1' }))
			]
		});

		expect(cardNames()).toHaveLength(2);
		expect(document.body.querySelector('[aria-label="กรองตามที่เก็บ"]')).toBeNull();
	});

	it('shows the reset button only while a filter is active and clears all filters', async () => {
		await render();
		expect(buttonByText(document.body, 'ล้างตัวกรอง')).toBeUndefined();

		statusChip('เปิดรับ').click();
		await settle();
		await typeSearch('อาหาร');
		expect(cardNames()).toEqual([]);

		buttonByText(document.body, 'ล้างตัวกรอง')?.click();
		await settle();

		expect(cardNames()).toHaveLength(3);
		expect(buttonByText(document.body, 'ล้างตัวกรอง')).toBeUndefined();
		expect((document.body.querySelector('input[type="search"]') as HTMLInputElement).value).toBe(
			''
		);
	});
});

describe('BulkReturnPoolBoard empty and error states', () => {
	it('shows the empty state with the open-pool hint for a manager when there are no pools', async () => {
		await render({ data: [] });

		expect(text()).toContain('ยังไม่มีกองรับคืน');
		expect(text()).toContain('กด "เปิดกองใหม่" เพื่อเริ่มรวบรวมของที่รับคืน');
		expect(buttonByText(document.body, 'เปิดกองใหม่')).toBeDefined();
	});

	it('shows the read-only empty copy and no open button without a manage role', async () => {
		state.authContext = NO_ROLE;
		await render({ data: [] });

		expect(text()).toContain('ยังไม่มีกองรับคืน');
		expect(text()).toContain('ยังไม่มีกองที่เปิดในศูนย์นี้');
		expect(buttonByText(document.body, 'เปิดกองใหม่')).toBeUndefined();
	});

	it('fails closed (no write actions, still renders) when the session context cannot resolve', async () => {
		state.authContext = null;
		await render();

		expect(cardNames()).toHaveLength(3);
		expect(buttonByText(document.body, 'เปิดกองใหม่')).toBeUndefined();
		expect(buttonByText(document.body, 'รับของเข้ากอง')).toBeUndefined();
		expect(queryByTestId('bulk-return-work-queues')).toBeNull();
	});

	it('shows the receive action for an admin when an open pool exists (positive control)', async () => {
		await render();

		expect(buttonByText(document.body, 'รับของเข้ากอง')).toBeDefined();
		expect(buttonByText(document.body, 'เปิดกองใหม่')).toBeDefined();
	});

	it('treats a list with only cancelled pools as empty while the cancelled toggle is off', async () => {
		await render({ data: sampleRows().filter((r) => r.pool.status === 'CANCELLED') });

		expect(text()).toContain('ยังไม่มีกองรับคืน');
		expect(text()).not.toContain('ไม่พบกองที่ตรงกับการค้นหา');
	});

	it('shows the search-empty state (not the empty state) when filters match nothing', async () => {
		await render();

		await typeSearch('ไม่มีกองนี้แน่นอน');

		expect(text()).toContain('ไม่พบกองที่ตรงกับการค้นหา');
		expect(text()).not.toContain('ยังไม่มีกองรับคืน');
		expect(cardNames()).toEqual([]);
	});

	it('shows an alert instead of the empty state when the load fails', async () => {
		await render({ data: undefined, isError: true, error: new Error('boom') });

		const alert = document.body.querySelector('[role="alert"]');
		expect(alert?.textContent).toContain('ไม่สามารถโหลดข้อมูลกองรับคืนได้');
		expect(text()).not.toContain('ยังไม่มีกองรับคืน');
	});

	it('refetches the overview when the retry button is clicked', async () => {
		await render({ data: undefined, isError: true, error: new Error('boom') });

		const retry = buttonByText(document.body.querySelector('[role="alert"]')!, 'ลองใหม่');
		expect(retry).toBeDefined();
		retry?.click();
		await settle();

		expect(state.overview.refetch).toHaveBeenCalledTimes(1);
	});
});

describe('BulkReturnPoolBoard skipped docs banner', () => {
	it('shows the banner with the skipped count', async () => {
		state.skippedDocs = [{ _id: 'bulk_return_pool:x' }, { _id: 'bulk_return_entry:y' }];
		await render();

		const banner = queryByTestId('bulk-return-board-skipped-docs');
		expect(banner).not.toBeNull();
		// Layout-coupled: the count has no test id in the component, so select by its class.
		expect(banner?.querySelector('.tabular-nums')?.textContent?.trim()).toBe('2');
	});

	it('hides the banner when nothing was skipped', async () => {
		await render();

		expect(queryByTestId('bulk-return-board-skipped-docs')).toBeNull();
	});
});

describe('BulkReturnPoolBoard role wiring of the work queues', () => {
	const waitingHeading = () => document.body.querySelector('#bulk-queue-waiting');
	// The flagged title equals the "needs attention" switch label, so match the queue heading.
	const flaggedHeading = () => document.body.querySelector('#bulk-queue-flagged');

	it('gives an admin the waiting and flagged queues', async () => {
		await render();

		expect(waitingHeading()?.textContent).toContain(WORK_QUEUE_COPY.waitingTitle);
		expect(flaggedHeading()?.textContent).toContain(WORK_QUEUE_COPY.flaggedTitle);
	});

	it('gives warehouse staff the waiting queue only', async () => {
		state.authContext = withCapability('warehouse_staff');
		await render();

		expect(queryByTestId('bulk-return-work-queues')).not.toBeNull();
		expect(waitingHeading()?.textContent).toContain(WORK_QUEUE_COPY.waitingTitle);
		expect(flaggedHeading()).toBeNull();
		expect(queryByTestId('bulk-return-queue-my-point')).toBeNull();
	});

	it('gives distribution staff the my-point queue only', async () => {
		state.authContext = withCapability('distribution_staff');
		await render();

		expect(queryByTestId('bulk-return-queue-my-point')).not.toBeNull();
		expect(waitingHeading()).toBeNull();
		expect(flaggedHeading()).toBeNull();
	});

	it('wires the stored my-point selection into the my-point queue', async () => {
		// The board reads the stored point once at mount, so seed it before render.
		localStorage.setItem(myPoolPointKey('SH001'), 'sp:1');
		state.authContext = withCapability('distribution_staff');
		await render();

		const queue = queryByTestId('bulk-return-queue-my-point');
		expect(queue).not.toBeNull();
		expect(buttonByText(queue!, 'กองผ้าห่ม')).toBeDefined();
	});
});
