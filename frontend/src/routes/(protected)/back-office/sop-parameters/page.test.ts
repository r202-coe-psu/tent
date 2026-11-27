import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	requireWarehouseAccess: vi.fn(),
	requireAuth: vi.fn()
}));

vi.mock('$lib/guards/auth', () => ({
	requireWarehouseAccess: mocks.requireWarehouseAccess,
	requireAuth: mocks.requireAuth
}));

import { load } from './+page';

describe('/back-office/sop-parameters page guard (#845)', () => {
	beforeEach(() => {
		mocks.requireWarehouseAccess.mockClear();
		mocks.requireAuth.mockClear();
	});

	it('runs the warehouse guard — SA, SM, warehouse_staff and supply_coordinator only', async () => {
		const fetchFn = vi.fn() as unknown as typeof fetch;

		await load({ fetch: fetchFn } as Parameters<typeof load>[0]);

		expect(mocks.requireWarehouseAccess).toHaveBeenCalledWith(fetchFn);
	});

	it('lets the guard refusal through, so a denied role is redirected', async () => {
		const redirect = new Error('redirect');
		mocks.requireWarehouseAccess.mockRejectedValueOnce(redirect);

		await expect(load({ fetch } as Parameters<typeof load>[0])).rejects.toBe(redirect);
	});
});
