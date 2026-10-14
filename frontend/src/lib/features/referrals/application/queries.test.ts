// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$lib/db/shelter', () => ({
	getShelterDb: () => 'shelter_sh001',
	getShelterCode: () => 'SH001'
}));

const { bulkTransitionReferrals } = vi.hoisted(() => ({ bulkTransitionReferrals: vi.fn() }));
vi.mock('../data/referral.remote', () => ({
	bulkTransitionReferrals,
	createReferralBatch: vi.fn(),
	referralRepository: () => ({
		list: vi.fn(),
		listPage: vi.fn(),
		get: vi.fn(),
		getBatch: vi.fn(),
		create: vi.fn(),
		transition: vi.fn()
	})
}));

vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: { user: { name: 'sm_user' } }
}));

const subscribeCalls: Array<{ keysForType: (t: string, docId?: string) => unknown }> = [];
vi.mock('$lib/db/subscribe-data-changes', () => ({
	subscribeDataChanges: (
		_qc: unknown,
		_db: unknown,
		keysForType: (t: string, docId?: string) => unknown
	) => {
		subscribeCalls.push({ keysForType });
		return { stop: vi.fn() };
	}
}));

vi.mock('@tanstack/svelte-query', () => ({
	createQuery: (fn: () => unknown) => fn(),
	createInfiniteQuery: (fn: () => unknown) => fn(),
	createMutation: (fn: () => unknown) => fn(),
	useQueryClient: () => ({})
}));

import {
	findCachedReferral,
	getNextReferralPageParam,
	referralKeys,
	replaceReferralInPages,
	patchReferralCaches,
	referralKeysForChange,
	startReferralsLiveQuery,
	useBulkTransition,
	useReferralPages
} from './queries';
import type { Referral, ReferralPage, ReferralStatus } from '../domain/referral.schema';

beforeEach(() => {
	vi.clearAllMocks();
	subscribeCalls.length = 0;
});

describe('startReferralsLiveQuery', () => {
	it('maps a referral event to list, batch and that one detail — never referralKeys.all (F-09)', () => {
		startReferralsLiveQuery({} as never);

		expect(subscribeCalls).toHaveLength(1);
		const { keysForType } = subscribeCalls[0]!;
		const keys = keysForType('referral', 'referral:abc') as unknown[][];
		expect(keys).toEqual([
			referralKeys.lists(),
			referralKeys.batches(),
			referralKeys.detail('referral:abc')
		]);
		expect(keys).not.toContainEqual(referralKeys.all);
	});

	it('invalidates every detail (but still not everything) when the doc id is unknown', () => {
		expect(referralKeysForChange(undefined)).toEqual([
			referralKeys.lists(),
			referralKeys.batches(),
			referralKeys.details()
		]);
		expect(referralKeysForChange('')).toContainEqual(referralKeys.details());
	});

	it('ignores other doc types', () => {
		startReferralsLiveQuery({} as never);
		const { keysForType } = subscribeCalls[0]!;
		expect(keysForType('evacuee', 'evacuee:1')).toEqual([]);
		expect(keysForType('donation', 'donation:1')).toEqual([]);
	});
});

describe('patchReferralCaches', () => {
	it('writes each doc to its detail, list pages and batch caches', () => {
		const detail = vi.fn();
		const setQueriesData = vi.fn();
		const qc = { setQueryData: detail, setQueriesData } as never;
		const docs = [ref('referral:1', 'sent'), ref('referral:2', 'sent')];
		patchReferralCaches(qc, docs);

		expect(detail).toHaveBeenCalledTimes(2);
		expect(detail).toHaveBeenCalledWith(referralKeys.detail('referral:1'), docs[0]);
		// list + batch per doc
		expect(setQueriesData).toHaveBeenCalledTimes(4);
		const batchCall = setQueriesData.mock.calls.find(
			([filter]) => JSON.stringify(filter.queryKey) === JSON.stringify(referralKeys.batches())
		)!;
		const updater = batchCall[1] as (old: Referral[] | undefined) => Referral[] | undefined;
		expect(updater([ref('referral:1', 'draft'), ref('referral:9', 'draft')])).toEqual([
			docs[0],
			ref('referral:9', 'draft')
		]);
		expect(updater(undefined)).toBeUndefined();
	});
});

describe('useBulkTransition', () => {
	const make = (count: number) => Array.from({ length: count }, (_, i) => `referral:${i}`);
	const okSend = async (ids: string[]) => ({
		succeeded: ids.map((id) => ref(id, 'closed')),
		failed: []
	});

	function setup() {
		const qc = {
			setQueryData: vi.fn(),
			setQueriesData: vi.fn(),
			invalidateQueries: vi.fn()
		};
		const hook = useBulkTransition(qc as never) as unknown as {
			progress: ReturnType<typeof useBulkTransition>['progress'];
			// createMutation is mocked to hand back its options object
			mutation: {
				mutationFn: (v: { ids: string[]; to: ReferralStatus; reason?: string }) => Promise<{
					succeeded: Referral[];
					failed: { id: string; error: string }[];
				}>;
				onSuccess: (r: { succeeded: Referral[]; failed: unknown[] }) => void;
			};
		};
		return { qc, ...hook };
	}

	it('sends 150 ids in one request and 450 in three', async () => {
		const { mutation, progress } = setup();
		bulkTransitionReferrals.mockImplementation(okSend);
		progress.start(150, 'closed');
		await mutation.mutationFn({ ids: make(150), to: 'closed' });
		expect(bulkTransitionReferrals).toHaveBeenCalledTimes(1);

		bulkTransitionReferrals.mockClear();
		progress.start(450, 'closed');
		await mutation.mutationFn({ ids: make(450), to: 'closed' });
		expect(bulkTransitionReferrals.mock.calls.map((c) => (c[0] as string[]).length)).toEqual([
			200, 200, 50
		]);
		expect(progress.succeeded).toBe(450);
	});

	it('records per-item failures and a retry resends only those ids with the same target and reason', async () => {
		const { mutation, progress } = setup();
		bulkTransitionReferrals.mockImplementationOnce(async (ids: string[]) => ({
			succeeded: ids.filter((id) => id !== 'referral:1').map((id) => ref(id, 'closed')),
			failed: [{ id: 'referral:1', error: 'ปลายทางไม่รับ' }]
		}));
		progress.start(3, 'closed', 'เหตุผล');
		await mutation.mutationFn({ ids: make(3), to: 'closed', reason: 'เหตุผล' });
		expect(progress.succeeded).toBe(2);
		expect(progress.failed).toEqual([{ id: 'referral:1', error: 'ปลายทางไม่รับ' }]);

		bulkTransitionReferrals.mockClear();
		bulkTransitionReferrals.mockImplementation(okSend);
		const failedIds = progress.failed.map((f) => f.id);
		progress.beginRetry();
		await mutation.mutationFn({ ids: failedIds, to: progress.to!, reason: progress.reason });
		expect(bulkTransitionReferrals).toHaveBeenCalledTimes(1);
		expect(bulkTransitionReferrals).toHaveBeenCalledWith(['referral:1'], 'closed', 'เหตุผล');
		expect(progress.succeeded).toBe(3);
		expect(progress.failed).toEqual([]);
	});

	it('patches caches and invalidates exactly once per run, not per item', () => {
		const { mutation, qc } = setup();
		mutation.onSuccess({ succeeded: make(5).map((id) => ref(id, 'closed')), failed: [] });
		expect(qc.setQueryData).toHaveBeenCalledTimes(5);
		expect(qc.invalidateQueries).toHaveBeenCalledTimes(1);
		expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: referralKeys.all });
	});
});

const ref = (id: string, status: string) => ({ _id: id, status }) as unknown as Referral;

describe('getNextReferralPageParam', () => {
	it('returns the bookmark when more pages exist', () => {
		expect(getNextReferralPageParam({ items: [], bookmark: 'bm-1', hasMore: true })).toBe('bm-1');
	});

	it('returns undefined on the last page even when a bookmark is present', () => {
		expect(
			getNextReferralPageParam({ items: [], bookmark: 'bm-2', hasMore: false })
		).toBeUndefined();
	});

	it('returns undefined when hasMore but the bookmark is missing', () => {
		expect(getNextReferralPageParam({ items: [], bookmark: null, hasMore: true })).toBeUndefined();
	});
});

describe('useReferralPages', () => {
	it('keys under referralKeys.lists() and starts without a bookmark', () => {
		const opts = useReferralPages(() => ({ direction: 'incoming', status: 'sent' })) as unknown as {
			queryKey: unknown[];
			initialPageParam: unknown;
		};
		expect(opts.queryKey.slice(0, referralKeys.lists().length)).toEqual([...referralKeys.lists()]);
		expect(opts.initialPageParam).toBeUndefined();
	});

	it('uses a different key per direction and status', () => {
		const key = (d: 'outgoing' | 'incoming', status?: 'sent') =>
			(useReferralPages(() => ({ direction: d, status })) as unknown as { queryKey: unknown[] })
				.queryKey;
		expect(key('outgoing')).not.toEqual(key('incoming'));
		expect(key('outgoing')).not.toEqual(key('outgoing', 'sent'));
	});
});

describe('replaceReferralInPages (transition updater)', () => {
	const pages: ReferralPage[] = [
		{ items: [ref('a', 'sent'), ref('b', 'sent')], bookmark: 'x', hasMore: true },
		{ items: [ref('c', 'sent')], bookmark: 'y', hasMore: false }
	];
	const old = { pages, pageParams: [undefined, 'x'] };

	it('replaces the matching doc on any page and keeps the page shape', () => {
		const next = replaceReferralInPages(old, ref('c', 'accepted'))!;
		expect(next.pages[1]!.items[0]!.status).toBe('accepted');
		expect(next.pages[0]!.items.map((r) => r.status)).toEqual(['sent', 'sent']);
		expect(next.pages[0]!.bookmark).toBe('x');
		expect(next.pageParams).toEqual([undefined, 'x']);
	});

	it('passes undefined through', () => {
		expect(replaceReferralInPages(undefined, ref('a', 'closed'))).toBeUndefined();
	});
});

describe('findCachedReferral', () => {
	const row = (id: string) => ({ _id: id }) as Referral;
	const page = (...ids: string[]) => ({
		pages: [{ items: ids.map(row), bookmark: null, hasMore: false }],
		pageParams: [undefined]
	});

	function fakeClient(entries: [unknown[], unknown, number][]) {
		return {
			getQueriesData: ({ queryKey }: { queryKey: unknown[] }) => {
				expect(queryKey).toEqual(referralKeys.lists());
				return entries.map(([key, data]) => [key, data]);
			},
			getQueryState: (key: unknown[]) => ({
				dataUpdatedAt: entries.find(([k]) => k === key)![2]
			})
		} as never;
	}

	it('returns the referral with the freshest list timestamp that contains it', () => {
		const k1 = ['a'];
		const k2 = ['b'];
		const client = fakeClient([
			[k1, page('referral:1'), 100],
			[k2, page('referral:1', 'referral:2'), 300]
		]);
		expect(findCachedReferral(client, 'referral:1')?.updatedAt).toBe(300);
		expect(findCachedReferral(client, 'referral:2')?.data._id).toBe('referral:2');
	});

	it('returns undefined when no cached page has the id', () => {
		const client = fakeClient([[['a'], page('referral:1'), 100]]);
		expect(findCachedReferral(client, 'referral:9')).toBeUndefined();
		expect(findCachedReferral(fakeClient([[['a'], undefined, 0]]), 'referral:1')).toBeUndefined();
	});
});
