// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeCouchFetch } from '$lib/testing/fake-couch-fetch';

// CR-260 FR-C3: with a user logged in, couch-db stamps `updated_by` on every shelter write.
// The other repository tests mock couch-db away (and run with no user), so they never see it.
const auth = vi.hoisted(() => ({ user: { name: 'manager' } as { name: string } | null }));
vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: {
		get user() {
			return auth.user;
		},
		handleAuthFailure: vi.fn()
	}
}));
vi.mock('$lib/stores/endpoint.svelte', () => ({
	endpointStore: { markConnected: vi.fn(), markDisconnected: vi.fn() }
}));

import { runSimulation } from '../application/use-run-simulation';
import { ScenarioRemoteRepository } from './scenario.remote';
import { scenarioSnapshotFixture } from './scenario.fixture';

const DB = 'shelter_sh001';

describe('ScenarioRemoteRepository with the writer stamp (CR-260)', () => {
	const couch = createFakeCouchFetch();

	beforeEach(() => {
		couch.reset();
		vi.stubGlobal('fetch', couch.fetch);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('saves, lists and opens a scenario that carries updated_by', async () => {
		const result = await runSimulation(
			{ name: 'น้ำท่วมต่อเนื่อง 14 วัน', occupancy: 2000, days: 14, ratio_overrides: {} },
			'SH001',
			async () => structuredClone(scenarioSnapshotFixture)
		);
		const repository = new ScenarioRemoteRepository(DB);

		const saved = await repository.save(result, { shelterCode: 'SH001', createdBy: 'manager' });
		expect(saved.updated_by).toBe('manager');
		expect(couch.get(DB, saved._id)?.updated_by).toBe('manager');

		expect((await repository.listPage()).items.map((item) => item.id)).toEqual([saved._id]);
		expect(await repository.get(saved._id)).toMatchObject({
			_id: saved._id,
			updated_by: 'manager'
		});
	});
});
