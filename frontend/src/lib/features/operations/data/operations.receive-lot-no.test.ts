// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupplyItem } from '$lib/features/supply';
import { ConflictError } from '$lib/utils/errors';

vi.mock('$lib/db/shelter', () => ({
	SHELTER_CODE: 'SH001',
	SHELTER_DB: 'shelter_sh001',
	getShelterDb: () => 'shelter_sh001',
	getShelterCode: () => 'SH001'
}));
vi.mock('$lib/features/supply', () => ({
	supplyRepository: () => ({ getItem: async () => ({ unit: 'kg' }) as SupplyItem })
}));

type Doc = { _id: string } & Record<string, unknown>;
const docs = new Map<string, Doc>();
const find = vi.hoisted(() => vi.fn());
const bulkWritten: Doc[][] = [];
/** `lot_no`s already on the ledger, as the day-range lookup returns them. */
let existingLotNos: string[] = [];
const lotLookups = () =>
	find.mock.calls.filter(([q]) => 'lot.lot_no' in (q as { selector: object }).selector);

vi.mock('$lib/db/repository', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/db/repository')>();
	return {
		...actual,
		createRemoteRepository: () => ({
			async get(id: string) {
				return docs.get(id) ?? null;
			},
			async put(doc: Doc) {
				docs.set(doc._id, doc);
				return doc;
			},
			find
		})
	};
});
vi.mock('$lib/db/couch-db', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/db/couch-db')>()),
	getDoc: async (_db: string, id: string) => docs.get(id) ?? null,
	// lot_counter reads/writes (CR-244): a tiny `_rev` compare-and-swap store over `docs`.
	getDocWithConflicts: async (_db: string, id: string) => docs.get(id) ?? null,
	putDocStrict: async (_db: string, doc: Doc & { _rev?: string }) => {
		const current = docs.get(doc._id) as (Doc & { _rev?: string }) | undefined;
		if (current?._rev !== doc._rev) throw new ConflictError();
		const saved = { ...doc, _rev: `${Number.parseInt(doc._rev ?? '0', 10) + 1}-t` };
		docs.set(doc._id, saved);
		return saved;
	},
	findDocs: async (_db: string, q: { selector: object }) => find(q),
	bulkDocs: async (_db: string, batch: Doc[]) => {
		bulkWritten.push(batch);
		return batch.map((d) => ({ ...d, _rev: '1-t' }));
	},
	bulkDocsDetailed: async (_db: string, batch: Doc[]) => {
		bulkWritten.push(batch);
		for (const d of batch) docs.set(d._id, d);
		return batch.map((d) => ({ id: d._id, ok: true as const, rev: '1-t' }));
	}
}));

import { OperationsRemoteRepository } from './operations.remote';
import {
	LOT_NO_PATTERN,
	createWalkInDonation,
	lotDateStamp,
	type StockLedger
} from '../domain/operations';
import type { AuthorContext } from '$lib/db/model';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'tester' };
const stamp = lotDateStamp(new Date());
const rice = { item_id: 'item:rice', qty: 5, unit: 'kg', source: 'manual' as const };

let repo: OperationsRemoteRepository;
beforeEach(() => {
	docs.clear();
	bulkWritten.length = 0;
	find.mockReset();
	existingLotNos = [];
	find.mockImplementation(async (q: { selector: Record<string, unknown> }) =>
		'lot.lot_no' in q.selector ? existingLotNos.map((lot_no) => ({ lot: { lot_no } })) : []
	);
	repo = new OperationsRemoteRepository('shelter_sh001');
});

describe('stock-page receive — optional lot number', () => {
	it('reserves from the day counter doc and advances it (CR-244)', async () => {
		await repo.receiveStock(rice, ctx, { issueLotNo: true });
		const second = await repo.receiveStock(rice, ctx, { issueLotNo: true });
		expect(second.lot?.lot_no).toBe(`L-${stamp}-002`);
		expect(docs.get(`lot_counter:L-${stamp}`)).toMatchObject({ type: 'lot_counter', last: 2 });
		expect(lotLookups()).toHaveLength(1); // seeded once, not per receive
	});

	it('receiveStock with issueLotNo continues after the day’s existing numbers', async () => {
		existingLotNos = [`L-${stamp}-007`];

		const entry = await repo.receiveStock(rice, ctx, { issueLotNo: true });

		expect(entry.lot?.lot_no).toBe(`L-${stamp}-008`);
		expect(entry.lot?.lot_no).toMatch(LOT_NO_PATTERN);
		expect(lotLookups()[0][0].selector['lot.lot_no']).toEqual({
			$gte: `L-${stamp}-`,
			$lt: `L-${stamp}-￰`
		});
	});

	it('keeps the other lot fields when it adds the number', async () => {
		const entry = await repo.receiveStock(
			{ ...rice, lot: { expiry: '2099-01-01', note: 'n' } },
			ctx,
			{ issueLotNo: true }
		);
		expect(entry.lot).toMatchObject({ expiry: '2099-01-01', note: 'n', lot_no: `L-${stamp}-001` });
	});

	it('receiveStock without the flag, or with it off, mints nothing and does not look up', async () => {
		const omitted = await repo.receiveStock(rice, ctx);
		const off = await repo.receiveStock(rice, ctx, { issueLotNo: false });
		expect(omitted.lot?.lot_no).toBeUndefined();
		expect(off.lot?.lot_no).toBeUndefined();
		expect(lotLookups()).toHaveLength(0);
	});

	it('a failed lookup throws a Thai error and writes nothing', async () => {
		find.mockImplementation(async () => {
			throw new Error('boom');
		});
		await expect(repo.receiveStock(rice, ctx, { issueLotNo: true })).rejects.toThrow(
			'ออกเลขล็อตไม่สำเร็จ'
		);
		expect(docs.size).toBe(0);
	});

	it('receiveWalkInDonation mints for its one ledger row only when asked', async () => {
		const donationInput = {
			donor: { name: 'ผู้ใจบุญ', phone: null, phone_hash: 'h' },
			kind: 'items' as const,
			items: [{ item_id: 'item:rice', qty: '5', unit: 'kg' }],
			campaign_id: null,
			tracking_token_hash: 'tok'
		};
		const on = await repo.receiveWalkInDonation(donationInput, rice, ctx, { issueLotNo: true });
		expect(on.entry.lot?.lot_no).toBe(`L-${stamp}-001`);
		const off = await repo.receiveWalkInDonation(donationInput, rice, ctx);
		expect(off.entry.lot?.lot_no).toBeUndefined();
	});
});

describe('receiveDonationBatch — optional lot number', () => {
	const items = [
		{ item_id: 'item:rice', qty: '10', unit: 'kg' },
		{ item_id: 'item:oil', qty: '6', unit: 'kg' }
	];
	const lines = items.map((item, line_no) => ({ ...item, line_no }));
	const makeDonation = () =>
		createWalkInDonation(
			{
				donor: { name: 'ผู้ใจบุญ', phone: null, phone_hash: 'h' },
				kind: 'items',
				items,
				campaign_id: null,
				tracking_token_hash: 'tok'
			},
			ctx
		);
	const written = () =>
		[...docs.values()].filter((d) => d.type === 'stock_ledger') as unknown as StockLedger[];

	it('gives each written row its own consecutive number', async () => {
		const donation = makeDonation();
		docs.set(donation._id, donation as unknown as Doc);
		existingLotNos = [`L-${stamp}-004`];

		await repo.receiveDonationBatch(donation, lines, ctx, { issueLotNo: true });

		const lotNos = written()
			.map((r) => r.lot?.lot_no)
			.sort();
		expect(lotNos).toEqual([`L-${stamp}-005`, `L-${stamp}-006`]);
	});

	it('mints nothing without the flag', async () => {
		const donation = makeDonation();
		docs.set(donation._id, donation as unknown as Doc);

		await repo.receiveDonationBatch(donation, lines, ctx);

		expect(written().every((r) => r.lot?.lot_no === undefined)).toBe(true);
		expect(lotLookups()).toHaveLength(0);
	});

	it('a retry whose rows already landed burns no numbers', async () => {
		const donation = makeDonation();
		docs.set(donation._id, donation as unknown as Doc);
		await repo.receiveDonationBatch(donation, lines, ctx, { issueLotNo: true });
		find.mockClear();

		await repo.receiveDonationBatch(donation, lines, ctx, { issueLotNo: true });

		expect(lotLookups()).toHaveLength(0);
		expect(bulkWritten).toHaveLength(1);
	});
});
