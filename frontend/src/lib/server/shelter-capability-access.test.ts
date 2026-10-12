import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: { COUCHDB_ADMIN_URL: 'http://admin:password@couchdb.test' }
}));
import { requireShelterCapabilityCaller, scopedShelterFilter } from './shelter-capability-access';

const fetchMock = vi.fn();

function sessionIs(name: string | null, roles: string[]) {
	fetchMock.mockResolvedValue({ json: async () => ({ userCtx: { name, roles } }) });
}

beforeEach(() => {
	vi.stubGlobal('fetch', fetchMock);
	fetchMock.mockReset();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('requireShelterCapabilityCaller', () => {
	it('rejects an anonymous session as unauthenticated (401)', async () => {
		sessionIs(null, []);

		await expect(requireShelterCapabilityCaller(null, ['shelter_manager'])).rejects.toMatchObject({
			code: 'UNAUTHENTICATED'
		});
	});

	it('rejects a registration_staff-only user as forbidden (403)', async () => {
		sessionIs('reg', ['shelter:A', 'A:registration_staff']);

		await expect(requireShelterCapabilityCaller('c=1', ['shelter_manager'])).rejects.toMatchObject({
			code: 'FORBIDDEN'
		});
	});

	it('scopes a shelter_manager to their shelter', async () => {
		sessionIs('mgr', ['shelter:A', 'A:shelter_manager']);

		await expect(requireShelterCapabilityCaller('c=1', ['shelter_manager'])).resolves.toMatchObject(
			{ name: 'mgr', isSA: false, scope: ['A'] }
		);
	});

	it('gives a system admin the unrestricted scope (null)', async () => {
		sessionIs('boss', ['system_admin']);

		await expect(requireShelterCapabilityCaller('c=1', ['shelter_manager'])).resolves.toMatchObject(
			{ name: 'boss', isSA: true, scope: null }
		);
	});
});

describe('scopedShelterFilter', () => {
	async function callerWith(roles: string[]) {
		sessionIs('someone', roles);
		return requireShelterCapabilityCaller('c=1', ['shelter_manager']);
	}

	it('applies no filter for a system admin who requested none', async () => {
		const sa = await callerWith(['system_admin']);

		expect(scopedShelterFilter(sa, null)).toBeNull();
	});

	it('narrows a system admin to the requested shelter', async () => {
		const sa = await callerWith(['system_admin']);

		expect(scopedShelterFilter(sa, 'B')).toEqual(['B']);
	});

	it('keeps an in-scope shelter requested by a shelter_manager', async () => {
		const mgr = await callerWith([
			'shelter:A',
			'shelter:B',
			'A:shelter_manager',
			'B:shelter_manager'
		]);

		expect(scopedShelterFilter(mgr, 'B')).toEqual(['B']);
	});

	it('yields an empty filter for a shelter outside the manager scope', async () => {
		const mgr = await callerWith(['shelter:A', 'A:shelter_manager']);

		expect(scopedShelterFilter(mgr, 'B')).toEqual([]);
	});

	it('falls back to the whole manager scope when no shelter was requested', async () => {
		const mgr = await callerWith([
			'shelter:A',
			'shelter:B',
			'A:shelter_manager',
			'B:shelter_manager'
		]);

		expect(scopedShelterFilter(mgr, null)).toEqual(['A', 'B']);
	});
});
