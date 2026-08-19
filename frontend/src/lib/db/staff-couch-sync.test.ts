import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueryClient } from '@tanstack/svelte-query';
import { CHANGES_FEED_START_DELAY_MS, startStaffCouchSync } from './staff-couch-sync';

const probe = vi.fn();
const startChangesSubscriberMock = vi.fn((dbNames: string[]) => {
	void dbNames;
	return { stop: vi.fn() };
});
const getShelterDbMock = vi.fn(() => 'shelter_sh001');

vi.mock('$lib/stores/endpoint.svelte', () => ({
	endpointStore: {
		probe: () => probe()
	}
}));

vi.mock('./changes-subscriber', () => ({
	startChangesSubscriber: (dbNames: string[]) => startChangesSubscriberMock(dbNames)
}));

vi.mock('./shelter', () => ({
	getShelterDb: () => getShelterDbMock()
}));

vi.mock('$lib/features/shelters', () => ({
	SHELTER_REGISTRY_DB: 'registry',
	startSheltersLiveQuery: vi.fn(() => ({ stop: vi.fn() }))
}));

vi.mock('$lib/features/shelter-import', () => ({
	startShelterImportLiveQuery: vi.fn(() => ({ stop: vi.fn() }))
}));

vi.mock('$lib/features/supply', () => ({
	CATALOG_DB: 'catalog',
	startCatalogLiveQuery: vi.fn(() => ({ stop: vi.fn() }))
}));

vi.mock('$lib/features/catalog', () => ({
	startCatalogMasterLiveQuery: vi.fn(() => ({ stop: vi.fn() }))
}));

vi.mock('$lib/features/people', () => ({
	startPeopleLiveQuery: vi.fn(() => ({ stop: vi.fn() }))
}));

vi.mock('$lib/features/operations', () => ({
	startOperationsLiveQuery: vi.fn(() => ({ stop: vi.fn() }))
}));

vi.mock('$lib/features/kitchen', () => ({
	startKitchenLiveQuery: vi.fn(() => ({ stop: vi.fn() }))
}));

vi.mock('$lib/features/sop-ratios', () => ({
	startSopRatioLiveQuery: vi.fn(() => ({ stop: vi.fn() }))
}));

vi.mock('$lib/features/resource-calc', () => ({
	startDailyCalcLiveQuery: vi.fn(() => ({ stop: vi.fn() }))
}));

vi.mock('$lib/features/referrals', () => ({
	startReferralsLiveQuery: vi.fn(() => ({ stop: vi.fn() }))
}));

const queryClient = {} as QueryClient;

describe('startStaffCouchSync', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		probe.mockReset();
		startChangesSubscriberMock.mockReset();
		startChangesSubscriberMock.mockReturnValue({ stop: vi.fn() });
		getShelterDbMock.mockReturnValue('shelter_sh001');
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('probes central immediately and defers _changes until the delay', () => {
		startStaffCouchSync(queryClient);

		expect(probe).toHaveBeenCalledTimes(1);
		expect(startChangesSubscriberMock).not.toHaveBeenCalled();

		vi.advanceTimersByTime(CHANGES_FEED_START_DELAY_MS - 1);
		expect(startChangesSubscriberMock).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		expect(startChangesSubscriberMock).toHaveBeenCalledWith([
			'registry',
			'catalog',
			'shelter_sh001'
		]);
	});

	it('starts injected live queries and stops them with the handle', () => {
		const stopLive = vi.fn();
		const startLive = vi.fn(() => ({ stop: stopLive }));

		const handle = startStaffCouchSync(queryClient, { liveQueryStarters: [startLive] });
		expect(startLive).toHaveBeenCalledWith(queryClient);

		handle.stop();
		expect(stopLive).toHaveBeenCalledTimes(1);
	});

	it('does not start _changes if stopped before the delay', () => {
		const handle = startStaffCouchSync(queryClient);
		handle.stop();
		vi.advanceTimersByTime(CHANGES_FEED_START_DELAY_MS);
		expect(startChangesSubscriberMock).not.toHaveBeenCalled();
	});

	it('stops the changes subscriber after it has started', () => {
		const stopSubscriber = vi.fn();
		startChangesSubscriberMock.mockReturnValue({ stop: stopSubscriber });

		const handle = startStaffCouchSync(queryClient);
		vi.advanceTimersByTime(CHANGES_FEED_START_DELAY_MS);
		handle.stop();

		expect(stopSubscriber).toHaveBeenCalledTimes(1);
	});
});
