import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { SHELTER_CLOSE_LEASE_MS: '61000' } }));
vi.mock('./couch-admin', () => ({ adminRaw: vi.fn() }));

import { getShelterCloseStore } from './shelter-close-job-runtime';

describe('getShelterCloseStore', () => {
	it('is one store per process, so ensureDesign runs once instead of on every request', () => {
		const a = getShelterCloseStore();
		expect(getShelterCloseStore()).toBe(a);
	});

	it('reads the SHELTER_CLOSE_* config from $env', () => {
		expect(getShelterCloseStore().config.leaseMs).toBe(61_000);
	});
});
