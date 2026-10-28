// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount, type ComponentProps } from 'svelte';
import { compoundCapabilityRole } from '$lib/auth/roles';
import type {
	BulkReturnEntry,
	BulkReturnPoolOverviewRow,
	BulkReturnPoolV3,
	BulkReturnPoolV3Status
} from '../../domain/food-supplies';
import { MY_POOL_POINT_UNSPECIFIED } from '../model/my-pool-point-storage';
import { WORK_QUEUE_COPY, workQueuesFor } from '../model/bulk-return-work-queue';
import BulkReturnPoolWorkQueue from './BulkReturnPoolWorkQueue.svelte';

const NOW = new Date('2026-01-10T12:00:00.000Z');
const SHELTER = 'SH1';

function row(
	id: string,
	status: BulkReturnPoolV3Status,
	opts: {
		point?: string;
		submitted_at?: string;
		late?: number;
		entry_count?: number;
		loanRefsUnavailable?: boolean;
	} = {}
): BulkReturnPoolOverviewRow {
	return {
		pool: {
			_id: id,
			status,
			name: `pool-${id}`,
			submitted_at: opts.submitted_at,
			location_storage_point_id: opts.point,
			created_at: '2026-01-01T00:00:00.000Z'
		} satisfies Partial<BulkReturnPoolV3> as BulkReturnPoolV3,
		entry_count: opts.entry_count ?? 0,
		items: [],
		entries: [],
		late_entries: Array.from({ length: opts.late ?? 0 }, (_, i) => ({
			entry: { _id: `${id}-late-${i}` } as BulkReturnEntry,
			pool_id: id,
			voided: false
		})),
		is_empty: (opts.entry_count ?? 0) === 0,
		unresolved_refs: [],
		closed_loan_refs: [],
		loan_refs_unavailable: opts.loanRefsUnavailable ?? false,
		snapshot_conflicts: []
	};
}

const ROWS = [
	row('w1', 'SUBMITTED', { submitted_at: '2026-01-10T09:00:00.000Z' }),
	row('f1', 'OPEN', { late: 2, point: 'P1', entry_count: 3 }),
	row('o1', 'OPEN', { point: 'P1', entry_count: 5 })
];
const POINTS = [
	{ id: 'P1', name: 'Warehouse A' },
	{ id: 'P2', name: 'Gate B' }
];

type WorkQueueProps = ComponentProps<typeof BulkReturnPoolWorkQueue>;
type Props = Partial<WorkQueueProps> & Pick<WorkQueueProps, 'queues'>;

// `onMyPointChange` (the my-point picker) is not exercised here: picking from the bits-ui Select
// portal is unreliable in happy-dom, and there is no e2e spec covering it either.

let instance: ReturnType<typeof mount> | null = null;

async function render(props: Props) {
	instance = mount(BulkReturnPoolWorkQueue, {
		target: document.body,
		props: { rows: ROWS, now: NOW, onOpenPool: vi.fn(), ...props }
	});
	flushSync();
	await tick();
	flushSync();
}

const normalize = (s: string | null | undefined) => s?.replace(/\s+/g, ' ') ?? '';
const text = () => normalize(document.body.textContent);
const myPointSection = () =>
	document.body.querySelector('[data-testid="bulk-return-queue-my-point"]') as HTMLElement | null;
const waitingHeading = () => document.getElementById('bulk-queue-waiting');
const flaggedHeading = () => document.getElementById('bulk-queue-flagged');
const myPointHeading = () => document.getElementById('bulk-queue-my-point');
const buttonsIn = (el: ParentNode) => [...el.querySelectorAll('button')];
const poolNamesIn = (headingId: string) =>
	[...document.body.querySelectorAll(`section[aria-labelledby="${headingId}"] li > button`)].map(
		(b) => b.querySelector('span')?.textContent?.trim()
	);

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('BulkReturnPoolWorkQueue', () => {
	it('mounts and renders the wrapper when at least one queue is given', async () => {
		await render({ queues: ['waiting_receive'] });
		expect(document.body.querySelector('[data-testid="bulk-return-work-queues"]')).not.toBeNull();
	});

	it('renders nothing when there are no queues', async () => {
		await render({ queues: [] });
		expect(document.body.querySelector('[data-testid="bulk-return-work-queues"]')).toBeNull();
	});

	describe('queues per role', () => {
		const roleQueues = (...capabilities: string[]) =>
			workQueuesFor({
				roles: [
					`shelter:${SHELTER}`,
					...capabilities.map((c) => compoundCapabilityRole(SHELTER, c))
				],
				shelterCode: SHELTER
			});
		const myPointSelect = () => document.body.querySelector('#bulk-queue-my-point-select');

		function expectAllThreeQueues() {
			expect(waitingHeading()).not.toBeNull();
			expect(flaggedHeading()).not.toBeNull();
			expect(myPointSection()).not.toBeNull();
			expect(normalize(myPointHeading()?.textContent)).toContain(WORK_QUEUE_COPY.myPointTitle);
			expect(myPointSelect()).not.toBeNull();
		}

		it('shelter_manager sees all three queues including my point', async () => {
			await render({ queues: roleQueues('shelter_manager'), points: POINTS, myPoint: null });
			expectAllThreeQueues();
		});

		it('system_admin sees all three queues including my point', async () => {
			await render({
				queues: workQueuesFor({ roles: ['system_admin'], shelterCode: SHELTER }),
				points: POINTS,
				myPoint: null
			});
			expectAllThreeQueues();
		});

		it('shelter_manager + distribution_staff sees all three queues with the picker', async () => {
			await render({
				queues: roleQueues('shelter_manager', 'distribution_staff'),
				points: POINTS,
				myPoint: null
			});
			expectAllThreeQueues();
		});

		it('warehouse_staff + distribution_staff sees waiting + my point, not flagged', async () => {
			await render({
				queues: roleQueues('warehouse_staff', 'distribution_staff'),
				points: POINTS,
				myPoint: null
			});
			expect(waitingHeading()).not.toBeNull();
			expect(flaggedHeading()).toBeNull();
			expect(myPointSection()).not.toBeNull();
			expect(myPointSelect()).not.toBeNull();
		});

		it('warehouse_staff sees only the waiting queue', async () => {
			await render({ queues: roleQueues('warehouse_staff') });
			expect(waitingHeading()).not.toBeNull();
			expect(flaggedHeading()).toBeNull();
			expect(myPointHeading()).toBeNull();
			expect(myPointSection()).toBeNull();
		});

		it('distribution_staff sees only the my point queue', async () => {
			await render({ queues: roleQueues('distribution_staff'), points: POINTS, myPoint: null });
			expect(waitingHeading()).toBeNull();
			expect(flaggedHeading()).toBeNull();
			expect(myPointSection()).not.toBeNull();
			expect(myPointHeading()).not.toBeNull();
			expect(normalize(myPointHeading()?.textContent)).toContain(WORK_QUEUE_COPY.myPointTitle);
		});
	});

	describe('waiting and flagged queues', () => {
		it('lists waiting pools with age and opens the pool on click', async () => {
			const onOpenPool = vi.fn();
			await render({ queues: ['waiting_receive'], onOpenPool });
			const btn = buttonsIn(document.body).find((b) => b.textContent?.includes('pool-w1'));
			expect(btn).toBeDefined();
			expect(btn?.textContent).toContain('3 ชม.');
			expect(poolNamesIn('bulk-queue-waiting')).toEqual(['pool-w1']);
			expect(normalize(waitingHeading()?.textContent)).toContain(
				`${WORK_QUEUE_COPY.waitingTitle} 1`
			);
			btn?.click();
			expect(onOpenPool).toHaveBeenCalledWith('w1');
		});

		it('lists flagged pools with reason badge and count', async () => {
			const onOpenPool = vi.fn();
			await render({ queues: ['flagged'], onOpenPool });
			expect(poolNamesIn('bulk-queue-flagged')).toEqual(['pool-f1']);
			expect(normalize(flaggedHeading()?.textContent)).toContain(
				`${WORK_QUEUE_COPY.flaggedTitle} 1`
			);
			const btn = buttonsIn(document.body).find((b) => b.textContent?.includes('pool-f1'));
			expect(normalize(btn?.textContent)).toContain(`${WORK_QUEUE_COPY.reasonLabels.late} 2`);
			btn?.click();
			expect(onOpenPool).toHaveBeenCalledWith('f1');
		});

		it('flags a pool whose loan refs could not be read with the loan-unknown reason', async () => {
			await render({
				queues: ['flagged'],
				rows: [row('lu', 'OPEN', { entry_count: 1, loanRefsUnavailable: true })]
			});
			expect(poolNamesIn('bulk-queue-flagged')).toEqual(['pool-lu']);
			const btn = buttonsIn(document.body).find((b) => b.textContent?.includes('pool-lu'));
			expect(normalize(btn?.textContent)).toContain(WORK_QUEUE_COPY.reasonLabels.loan_unknown);
		});

		it('shows empty-state copy when nothing qualifies', async () => {
			await render({ queues: ['waiting_receive', 'flagged'], rows: [row('x', 'OPEN')] });
			expect(text()).toContain(WORK_QUEUE_COPY.waitingEmpty);
			expect(text()).toContain(WORK_QUEUE_COPY.flaggedEmpty);
		});
	});

	describe('my point queue', () => {
		it('shows the hint and a placeholder when no point is stored', async () => {
			await render({ queues: ['my_point'], points: POINTS, myPoint: null });
			const section = myPointSection();
			expect(section).not.toBeNull();
			expect(section!.textContent).toContain(WORK_QUEUE_COPY.myPointHint);
			expect(section!.textContent).toContain(WORK_QUEUE_COPY.myPointPlaceholder);
			expect(buttonsIn(section!).some((b) => b.textContent?.includes('pool-o1'))).toBe(false);
		});

		it('shows the selected point name and its open pools', async () => {
			const onOpenPool = vi.fn();
			await render({ queues: ['my_point'], points: POINTS, myPoint: 'P1', onOpenPool });
			const section = myPointSection();
			expect(section).not.toBeNull();
			expect(section!.textContent).toContain('Warehouse A');
			expect(normalize(section!.textContent)).toContain(`${WORK_QUEUE_COPY.myPointTitle} 2`);
			const btn = buttonsIn(section!).find((b) => b.textContent?.includes('pool-o1'));
			expect(normalize(btn?.textContent)).toContain('5 รายการ');
			const f1 = buttonsIn(section!).find((b) => b.textContent?.includes('pool-f1'));
			expect(normalize(f1?.textContent)).toContain('3 รายการ');
			expect(buttonsIn(section!).some((b) => b.textContent?.includes('pool-w1'))).toBe(false);
			btn?.click();
			expect(onOpenPool).toHaveBeenCalledWith('o1');
		});

		it('shows the empty copy when the point has no open pools', async () => {
			await render({ queues: ['my_point'], points: POINTS, myPoint: 'P2' });
			expect(myPointSection()?.textContent).toContain('Gate B');
			expect(myPointSection()?.textContent).toContain(WORK_QUEUE_COPY.myPointEmpty);
		});

		it('labels the unspecified choice and lists pools without a storage point', async () => {
			await render({
				queues: ['my_point'],
				points: POINTS,
				myPoint: MY_POOL_POINT_UNSPECIFIED,
				rows: [row('nopoint', 'OPEN', { entry_count: 1 })]
			});
			const section = myPointSection();
			expect(section).not.toBeNull();
			expect(section!.textContent).toContain(WORK_QUEUE_COPY.myPointUnspecified);
			expect(buttonsIn(section!).some((b) => b.textContent?.includes('pool-nopoint'))).toBe(true);
		});

		// Owner decision: a deleted saved point resets to the placeholder. The board resolves it to
		// null before passing it down (covered by the board DOM test and the resolveMyPoolPoint unit
		// tests), so this component-level case only checks that a stale id still renders safely.
		it.each([
			['points list without the saved point', POINTS],
			['empty points list', []]
		])(
			'deleted saved point (%s): renders, lists no pools, shows the empty copy',
			async (_n, points) => {
				await render({ queues: ['my_point'], points, myPoint: 'P-gone' });
				const section = myPointSection();
				expect(section).not.toBeNull();
				// Default ROWS have OPEN pools o1/f1 at P1, but none at 'P-gone'.
				expect(buttonsIn(section!).some((b) => b.textContent?.includes('pool-o1'))).toBe(false);
				expect(buttonsIn(section!).some((b) => b.textContent?.includes('pool-f1'))).toBe(false);
				expect(section!.textContent).toContain(WORK_QUEUE_COPY.myPointEmpty);
			}
		);
	});
});
