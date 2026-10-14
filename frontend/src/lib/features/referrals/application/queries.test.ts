// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$lib/db/shelter', () => ({
	getShelterDb: () => 'shelter_sh001',
	getShelterCode: () => 'SH001'
}));

vi.mock('../data/referral.remote', () => ({
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

const subscribeCalls: Array<{ keysForType: (t: string) => unknown }> = [];
vi.mock('$lib/db/subscribe-data-changes', () => ({
	subscribeDataChanges: (_qc: unknown, _db: unknown, keysForType: (t: string) => unknown) => {
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
	startReferralsLiveQuery,
	useReferralPages
} from './queries';
import type { Referral, ReferralPage } from '../domain/referral.schema';

beforeEach(() => {
	vi.clearAllMocks();
	subscribeCalls.length = 0;
});

describe('startReferralsLiveQuery', () => {
	it('maps type === referral → referralKeys.all and ignores other types', () => {
		startReferralsLiveQuery({} as never);

		expect(subscribeCalls).toHaveLength(1);
		const { keysForType } = subscribeCalls[0]!;
		expect(keysForType('referral')).toEqual([referralKeys.all]);
		expect(keysForType('evacuee')).toEqual([]);
		expect(keysForType('donation')).toEqual([]);
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
