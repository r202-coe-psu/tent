import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/db/shelter', () => ({
	SHELTER_CODE: 'SH001',
	SHELTER_DB: 'shelter_sh001',
	getShelterDb: () => 'shelter_sh001',
	getShelterCode: () => 'SH001'
}));
vi.mock('$lib/features/supply', () => ({ supplyRepository: () => ({ getItem: vi.fn() }) }));

const find = vi.hoisted(() => vi.fn());
const findDocsPage = vi.hoisted(() => vi.fn());

vi.mock('$lib/db/repository', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/db/repository')>();
	return { ...actual, createRemoteRepository: () => ({ find }) };
});
vi.mock('$lib/db/couch-db', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/db/couch-db')>()),
	findDocsPage
}));

import { OperationsRemoteRepository } from './operations.remote';

const ledger = (n: number, item = 'item_master:rice') => ({
	_id: `stock_ledger:${String(n).padStart(4, '0')}`,
	type: 'stock_ledger',
	item_id: item,
	qty: '1',
	unit: 'kg',
	reason: 'donation',
	ref_id: 'donation:w001'
});

describe('OperationsRemoteRepository ledger reads for a donation (#821 FR-12)', () => {
	let repo: OperationsRemoteRepository;
	beforeEach(() => {
		find.mockReset();
		findDocsPage.mockReset();
		repo = new OperationsRemoteRepository('shelter_sh001');
	});

	it('listDonationLedger asks the ref_id index for the donation rows, with an explicit limit', async () => {
		find.mockResolvedValue([ledger(1), { _id: 'noise', type: 'donation' }]);

		const rows = await repo.listDonationLedger('donation:w001');

		expect(find).toHaveBeenCalledWith({
			selector: {
				type: 'stock_ledger',
				ref_id: 'donation:w001',
				item_id: { $gt: null },
				reason: 'donation'
			},
			limit: 1000
		});
		expect(rows.map((r) => r._id)).toEqual(['stock_ledger:0001']);
	});

	it('listLedgerByItems reads each item by equality (index-usable, no $in), following the bookmark to the end', async () => {
		const full = Array.from({ length: 1000 }, (_, i) => ledger(i));
		findDocsPage.mockImplementation(
			async (_db: string, query: { selector: { item_id: unknown } }) => {
				if (query.selector.item_id === 'item_master:rice') {
					return (query as { bookmark?: string }).bookmark
						? { docs: [ledger(2000)], bookmark: 'b2' }
						: { docs: full, bookmark: 'b1' };
				}
				return { docs: [ledger(3000)], bookmark: 'x' };
			}
		);

		const rows = await repo.listLedgerByItems(['item_master:rice', 'item_master:salt']);

		expect(rows).toHaveLength(1002);
		const selectors = findDocsPage.mock.calls.map((c) => c[1].selector);
		expect(selectors).toContainEqual({ type: 'stock_ledger', item_id: 'item_master:rice' });
		expect(selectors).toContainEqual({ type: 'stock_ledger', item_id: 'item_master:salt' });
		expect(JSON.stringify(selectors)).not.toContain('$in');
		expect(findDocsPage).toHaveBeenCalledTimes(3);
		expect(findDocsPage.mock.calls.find((c) => c[1].bookmark === 'b1')?.[1]).toMatchObject({
			limit: 1000
		});
	});

	it('listLedgerByItems stops when the bookmark does not move, and reads nothing for no items', async () => {
		const full = Array.from({ length: 1000 }, (_, i) => ledger(i));
		findDocsPage.mockResolvedValue({ docs: full, bookmark: 'same' });

		await repo.listLedgerByItems(['item_master:rice']);
		expect(findDocsPage).toHaveBeenCalledTimes(2);

		findDocsPage.mockClear();
		expect(await repo.listLedgerByItems([])).toEqual([]);
		expect(findDocsPage).not.toHaveBeenCalled();
	});
});
