import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthorContext } from '$lib/db/model';

const mocks = vi.hoisted(() => ({
	roles: [] as string[],
	createItemMaster: vi.fn()
}));

vi.mock('@tanstack/svelte-query', () => ({
	createMutation: (options: () => unknown) => options(),
	createQuery: (options: () => unknown) => options(),
	useQueryClient: () => ({ setQueryData: vi.fn(), invalidateQueries: vi.fn() })
}));
vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: {
		get user() {
			return { roles: mocks.roles };
		}
	}
}));
vi.mock('$lib/db/subscribe-data-changes', () => ({ subscribeDataChanges: vi.fn() }));
vi.mock('$lib/db/shelter', () => ({ getShelterDb: vi.fn() }));
vi.mock('../data/catalog.remote', () => ({
	CATALOG_DB: 'catalog',
	catalogRepository: () => ({ createItemMaster: mocks.createItemMaster })
}));

import { useCreateItemMaster } from './queries';

type CreateOptions = {
	mutationFn: (arg: { input: never; ctx: AuthorContext; shelterCode?: string }) => unknown;
};

const create = (shelterCode?: string) =>
	(useCreateItemMaster() as unknown as CreateOptions).mutationFn({
		input: {} as never,
		ctx: { userId: 'u' } as unknown as AuthorContext,
		shelterCode
	});

describe('item_master write access on the client (CR-227)', () => {
	beforeEach(() => {
		mocks.createItemMaster.mockReset();
		mocks.createItemMaster.mockResolvedValue({ _id: 'item_master:x' });
	});

	it.each([
		['donation_staff', ['shelter:SH001', 'SH001:donation_staff']],
		['warehouse_staff', ['shelter:SH001', 'SH001:warehouse_staff']],
		['shelter_manager', ['shelter:SH001', 'SH001:shelter_manager']]
	])('lets %s create an item in its own shelter', async (_cap, roles) => {
		mocks.roles = roles;

		await create('SH001');

		expect(mocks.createItemMaster).toHaveBeenCalledOnce();
	});

	it('refuses donation_staff in another shelter and in the central catalog', () => {
		mocks.roles = ['shelter:SH001', 'SH001:donation_staff'];

		expect(() => create('SH002')).toThrow();
		expect(() => create(undefined)).toThrow();
		expect(mocks.createItemMaster).not.toHaveBeenCalled();
	});

	it('refuses staff that never had catalog write', () => {
		mocks.roles = ['shelter:SH001', 'SH001:distribution_staff'];

		expect(() => create('SH001')).toThrow();
	});
});
