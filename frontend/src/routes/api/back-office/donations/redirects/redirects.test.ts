import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './+server';
import { adminRaw, requireShelterScopeOrSA } from '$lib/server/couch-admin';

type GetEvent = Parameters<typeof GET>[0];

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: vi.fn(),
	requireShelterScopeOrSA: vi.fn()
}));

/**
 * Incoming redirect tickets are read from the caller's shelter db(s). Since #477 that is the
 * shelters where the caller holds a donation capability — or the one they name with
 * `shelter_code` — not their first `shelter:` membership.
 */

const event = (search = '') =>
	({
		url: new URL(`http://localhost/api/back-office/donations/redirects${search}`),
		request: { headers: { get: () => 'session-cookie' } }
	}) as unknown as GetEvent;

const asCaller = (roles: string[]) =>
	vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
		name: 'multi',
		roles: ['shelter:SH001', 'shelter:SH002', ...roles],
		isSA: false,
		shelterCode: 'SH001'
	});

const readShelters = () =>
	vi
		.mocked(adminRaw)
		.mock.calls.map((c) => String(c[0]).match(/\/shelter_(sh\d+)\//)?.[1])
		.filter(Boolean);

describe('GET /api/back-office/donations/redirects (#477)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(adminRaw).mockResolvedValue({ status: 200, data: { rows: [] } });
	});

	it('without shelter_code, reads every shelter where the caller holds a capability', async () => {
		asCaller(['SH001:warehouse_staff', 'SH002:donation_staff']);

		const response = await GET(event());

		expect(response.status).toBe(200);
		expect(readShelters()).toEqual(['sh001', 'sh002']);
	});

	it('reads the shelter the capability is held in, not the first membership', async () => {
		asCaller(['SH002:warehouse_staff']);

		await GET(event());

		expect(readShelters()).toEqual(['sh002']);
	});

	it('with shelter_code, reads only that shelter', async () => {
		asCaller(['SH001:warehouse_staff', 'SH002:warehouse_staff']);

		const response = await GET(event('?shelter_code=SH002'));

		expect(response.status).toBe(200);
		expect(readShelters()).toEqual(['sh002']);
	});

	it('403 naming the shelter, reading nothing, for a shelter without a capability', async () => {
		asCaller(['SH001:warehouse_staff']);

		const response = await GET(event('?shelter_code=SH002'));

		expect(response.status).toBe(403);
		expect((await response.json()).error).toContain('SH002');
		expect(readShelters()).toEqual([]);
	});

	it('403 for a member of shelters without any donation capability', async () => {
		asCaller(['SH001:registration_staff']);

		const response = await GET(event());

		expect(response.status).toBe(403);
		expect(readShelters()).toEqual([]);
	});
});
