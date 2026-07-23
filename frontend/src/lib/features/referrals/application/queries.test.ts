// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$lib/db/shelter', () => ({
	getShelterDb: () => 'shelter_sh001',
	getShelterCode: () => 'SH001'
}));

vi.mock('../data/referral.remote', () => ({
	referralRepository: () => ({
		list: vi.fn(),
		get: vi.fn(),
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
	createMutation: (fn: () => unknown) => fn()
}));

import { referralKeys, startReferralsLiveQuery } from './queries';

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
