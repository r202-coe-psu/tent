// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createInMemoryRepository } from '$lib/db/in-memory-repository';
import type { SupplyItem } from '$lib/features/supply';
import type { ItemMaster } from '$lib/features/catalog';
import { isAuditEntry } from '$lib/features/shared';

vi.mock('$lib/db/shelter', () => ({
	SHELTER_CODE: 'SH001',
	SHELTER_DB: 'shelter_sh001',
	getShelterDb: () => 'shelter_sh001'
}));

const mockGetItem = vi.fn<(itemId: string) => Promise<SupplyItem | null>>();
vi.mock('$lib/features/supply', () => ({
	supplyRepository: () => ({ getItem: mockGetItem })
}));

let memoryRepo = createInMemoryRepository();
vi.mock('$lib/db/repository', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/db/repository')>();
	return { ...actual, createRemoteRepository: () => memoryRepo };
});

// bulkDocs (used by receivePurchase to write a whole receipt in one request)
// bypasses the Repository abstraction and hits couch-db.ts directly — route it
// through the same in-memory store so the rows are readable via the repo.
vi.mock('$lib/db/couch-db', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/db/couch-db')>();
	return {
		...actual,
		bulkDocs: async (_dbName: string, docs: { _id: string }[]) => {
			const saved = [];
			for (const doc of docs) saved.push(await memoryRepo.put(doc));
			return saved;
		}
	};
});

import { OperationsRemoteRepository, assertReceiveAgainstCatalog } from './operations.remote';
import { createReceiveEntry } from '../domain/operations';
import type { AuthorContext } from '$lib/db/model';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'tester' };

// CR-055 R2: a 'donation' receipt must point at a real donation doc, so fixtures
// that only need stock on hand still have to name one.
const DONATION_REF = 'donation:01JFIXTUREDONATION';

describe('assertReceiveAgainstCatalog', () => {
	const entry = createReceiveEntry(
		{ item_id: 'item:rice', qty: 10, unit: 'kg', source: 'donation', ref_id: DONATION_REF },
		ctx
	);

	it('throws for a missing catalog item', () => {
		expect(() => assertReceiveAgainstCatalog(entry, null)).toThrow('Unknown item: item:rice');
	});

	it('throws on unit mismatch', () => {
		expect(() => assertReceiveAgainstCatalog(entry, { unit: 'bag' } as SupplyItem)).toThrow(
			'Unit mismatch for item item:rice: expected bag, got kg'
		);
	});

	it('throws when a perishable item is missing lot.expiry', () => {
		expect(() =>
			assertReceiveAgainstCatalog(entry, { unit: 'kg', perishable: true } as SupplyItem)
		).toThrow('Perishable item item:rice requires lot.expiry to be set');
	});

	it('passes for a matching, non-perishable item', () => {
		expect(() => assertReceiveAgainstCatalog(entry, { unit: 'kg' } as SupplyItem)).not.toThrow();
	});

	// CR-013 transition: the `catalog` DB also holds `item_master:{ulid}` docs, whose
	// stock unit is `base_unit`. Reading the bare `unit` field failed every receipt
	// for one with `expected undefined, got <unit>`.
	it('resolves an item_master unit from base_unit', () => {
		const masterEntry = createReceiveEntry(
			{
				item_id: 'item_master:01M0Y3R8JEJBW4HB8E9C4KX5N',
				qty: 30,
				unit: 'เม็ด',
				source: 'donation',
				ref_id: DONATION_REF
			},
			ctx
		);
		const master = { type: 'item_master', base_unit: 'เม็ด' } as unknown as ItemMaster;

		expect(() => assertReceiveAgainstCatalog(masterEntry, master)).not.toThrow();
		expect(() =>
			assertReceiveAgainstCatalog(masterEntry, {
				type: 'item_master',
				base_unit: 'แผง'
			} as unknown as ItemMaster)
		).toThrow(
			'Unit mismatch for item item_master:01M0Y3R8JEJBW4HB8E9C4KX5N: expected แผง, got เม็ด'
		);
	});

	it('falls back to the legacy `unit` field on an item_master without base_unit', () => {
		const masterEntry = createReceiveEntry(
			{
				item_id: 'item_master:legacy',
				qty: 1,
				unit: 'ขวด',
				source: 'donation',
				ref_id: DONATION_REF
			},
			ctx
		);
		expect(() =>
			assertReceiveAgainstCatalog(masterEntry, { type: 'item_master', unit: 'ขวด' } as ItemMaster)
		).not.toThrow();
	});

	it('never demands lot.expiry for an item_master (no perishable flag on that shape)', () => {
		const masterEntry = createReceiveEntry(
			{ item_id: 'item_master:milk', qty: 1, unit: 'l', source: 'donation', ref_id: DONATION_REF },
			ctx
		);
		expect(() =>
			assertReceiveAgainstCatalog(masterEntry, {
				type: 'item_master',
				base_unit: 'l',
				perishable: true
			} as unknown as ItemMaster)
		).not.toThrow();
	});

	it('passes for a perishable item with lot.expiry set', () => {
		const perishableEntry = createReceiveEntry(
			{
				item_id: 'item:milk',
				qty: 5,
				unit: 'l',
				source: 'donation',
				ref_id: DONATION_REF,
				lot: { expiry: '2026-12-31T00:00:00Z' }
			},
			ctx
		);
		expect(() =>
			assertReceiveAgainstCatalog(perishableEntry, { unit: 'l', perishable: true } as SupplyItem)
		).not.toThrow();
	});
});

describe('OperationsRemoteRepository', () => {
	let repo: OperationsRemoteRepository;

	beforeEach(() => {
		memoryRepo = createInMemoryRepository();
		repo = new OperationsRemoteRepository('shelter_sh001');
	});

	it('persists a stock ledger entry and lists them', async () => {
		const entry = createReceiveEntry(
			{
				item_id: 'item:rice',
				qty: 100,
				unit: 'kg',
				source: 'donation',
				ref_id: DONATION_REF
			},
			ctx
		);

		await repo.addLedgerEntry(entry);
		const list = await repo.listLedger();

		expect(list).toHaveLength(1);
		expect(list[0]._id).toBe(entry._id);
		expect(list[0].item_id).toBe('item:rice');
		expect(list[0].qty).toBe('100');
	});

	it('filters ledger entries by item ID', async () => {
		const entry1 = createReceiveEntry(
			{
				item_id: 'item:rice',
				qty: 50,
				unit: 'kg',
				source: 'donation',
				ref_id: DONATION_REF
			},
			ctx
		);
		const entry2 = createReceiveEntry(
			{
				item_id: 'item:water',
				qty: 200,
				unit: 'bottle',
				source: 'donation',
				ref_id: 'donation:123'
			},
			ctx
		);

		await repo.addLedgerEntry(entry1);
		await repo.addLedgerEntry(entry2);

		const riceLedger = await repo.listLedgerByItem('item:rice');
		expect(riceLedger).toHaveLength(1);
		expect(riceLedger[0].item_id).toBe('item:rice');

		const waterLedger = await repo.listLedgerByItem('item:water');
		expect(waterLedger).toHaveLength(1);
		expect(waterLedger[0].item_id).toBe('item:water');
	});

	it('calculates the stock balance accurately', async () => {
		const entries = [
			createReceiveEntry(
				{ item_id: 'item:rice', qty: 100, unit: 'kg', source: 'donation', ref_id: DONATION_REF },
				ctx
			),
			createReceiveEntry(
				{
					item_id: 'item:water',
					qty: 50,
					unit: 'bottle',
					source: 'donation',
					ref_id: DONATION_REF
				},
				ctx
			),
			{
				_id: 'stock_ledger:01J20000000000000000000002',
				schema_v: 3,
				shelter_code: 'SH001',
				type: 'stock_ledger' as const,
				item_id: 'item:rice',
				qty: '-30',
				unit: 'kg',
				reason: 'distribute' as const,
				ref_id: null,
				occurred_at: new Date().toISOString(),
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				created_by: 'tester'
			}
		];

		for (const entry of entries) {
			await repo.addLedgerEntry(entry);
		}

		const balance = await repo.getBalance();
		expect(balance.get('item:rice')).toBe('70');
		expect(balance.get('item:water')).toBe('50');
	});

	describe('distributeStock', () => {
		it('distributes stock and reduces balance when sufficient stock exists', async () => {
			mockGetItem.mockResolvedValue({ unit: 'bar' } as SupplyItem);
			await repo.receiveStock(
				{ item_id: 'item:soap', qty: 50, unit: 'bar', source: 'donation', ref_id: DONATION_REF },
				ctx
			);

			const distributeEntry = await repo.distributeStock(
				{ item_id: 'item:soap', qty: 20, unit: 'bar', ref_id: null, note: 'Tent A' },
				ctx
			);

			expect(distributeEntry.item_id).toBe('item:soap');
			expect(distributeEntry.qty).toBe('-20');
			expect(distributeEntry.reason).toBe('distribute');
			expect(distributeEntry.lot?.note).toBe('Tent A');

			const balance = await repo.getBalance();
			expect(balance.get('item:soap')).toBe('30');
		});

		it('throws an error if attempting to distribute more than available stock', async () => {
			mockGetItem.mockResolvedValue({ unit: 'bar' } as SupplyItem);
			await repo.receiveStock(
				{ item_id: 'item:soap', qty: 10, unit: 'bar', source: 'donation', ref_id: DONATION_REF },
				ctx
			);

			await expect(
				repo.distributeStock({ item_id: 'item:soap', qty: 15, unit: 'bar', ref_id: null }, ctx)
			).rejects.toThrow('Insufficient stock');
		});

		it('throws an error if attempting to distribute stock for item with zero balance', async () => {
			await expect(
				repo.distributeStock({ item_id: 'item:unknown', qty: 5, unit: 'bar', ref_id: null }, ctx)
			).rejects.toThrow('Insufficient stock');
		});
	});

	it('maintains correct balance under concurrent writes (T-11 DoD)', async () => {
		const writes = Array.from({ length: 10 }).map(() =>
			repo.addLedgerEntry(
				createReceiveEntry(
					{
						item_id: 'item:concurrent',
						qty: 10,
						unit: 'box',
						source: 'donation',
						ref_id: DONATION_REF
					},
					ctx
				)
			)
		);
		await Promise.all(writes);

		const balance = await repo.getBalance();
		expect(balance.get('item:concurrent')).toBe('100');
	});

	describe('receiveStock', () => {
		beforeEach(() => {
			mockGetItem.mockReset();
		});

		it('throws for an unknown item_id', async () => {
			mockGetItem.mockResolvedValue(null);

			await expect(
				repo.receiveStock(
					{
						item_id: 'item:missing',
						qty: 10,
						unit: 'kg',
						source: 'donation',
						ref_id: DONATION_REF
					},
					ctx
				)
			).rejects.toThrow('Unknown item: item:missing');
		});

		it('throws on unit mismatch against the catalog item', async () => {
			mockGetItem.mockResolvedValue({ unit: 'kg' } as SupplyItem);

			await expect(
				repo.receiveStock(
					{ item_id: 'item:rice', qty: 10, unit: 'bag', source: 'donation', ref_id: DONATION_REF },
					ctx
				)
			).rejects.toThrow('Unit mismatch for item item:rice: expected kg, got bag');
		});

		it('throws when a perishable item is missing lot.expiry', async () => {
			mockGetItem.mockResolvedValue({ unit: 'kg', perishable: true } as SupplyItem);

			await expect(
				repo.receiveStock(
					{ item_id: 'item:rice', qty: 10, unit: 'kg', source: 'donation', ref_id: DONATION_REF },
					ctx
				)
			).rejects.toThrow('Perishable item item:rice requires lot.expiry to be set');
		});

		it('persists the ledger entry when the item exists and units match', async () => {
			mockGetItem.mockResolvedValue({ unit: 'kg' } as SupplyItem);

			const result = await repo.receiveStock(
				{ item_id: 'item:rice', qty: 10, unit: 'kg', source: 'donation', ref_id: DONATION_REF },
				ctx
			);

			expect(result.item_id).toBe('item:rice');
			const list = await repo.listLedger();
			expect(list).toHaveLength(1);
		});
	});

	// CR-055 R4 / D-1 — walk-in goods have no donation doc to point at, so one is
	// minted WITH the ledger row. The pairing is the point: a donation written on
	// its own would sit at `declared` forever if the receipt never followed, and
	// `calculateReserved` counts those as reserved stock with nothing to sweep them.
	describe('receiveWalkInDonation (CR-055 D-1)', () => {
		const walkIn = {
			donor: { name: 'ผู้ใจบุญ', phone: '0800000000', phone_hash: 'hash' },
			kind: 'items' as const,
			items: [{ item_id: 'item:rice', qty: 10, unit: 'kg' }],
			campaign_id: null,
			tracking_token_hash: 'tok'
		};
		const receive = {
			item_id: 'item:rice',
			qty: 10,
			unit: 'kg',
			source: 'donation' as const,
			ref_id: null
		};

		beforeEach(() => {
			mockGetItem.mockReset();
		});

		it('writes the donation and the ledger row that references it', async () => {
			mockGetItem.mockResolvedValue({ unit: 'kg' } as SupplyItem);

			const { donation, entry } = await repo.receiveWalkInDonation(walkIn, receive, ctx);

			expect(donation._id).toMatch(/^donation:/);
			expect(donation.channel).toBe('walk_in');
			// the ledger points at the donation minted in the same call — this is
			// what makes the pair satisfy the R2 table
			expect(entry.reason).toBe('donation');
			expect(entry.ref_id).toBe(donation._id);

			expect(await repo.listDonations()).toHaveLength(1);
			expect(await repo.listLedger()).toHaveLength(1);
		});

		it('ignores any ref_id the caller passes — the fresh donation always wins', async () => {
			mockGetItem.mockResolvedValue({ unit: 'kg' } as SupplyItem);

			const { donation, entry } = await repo.receiveWalkInDonation(
				walkIn,
				{ ...receive, ref_id: 'donation:01JSOMEONEELSE' },
				ctx
			);

			expect(entry.ref_id).toBe(donation._id);
			expect(entry.ref_id).not.toBe('donation:01JSOMEONEELSE');
		});

		it('writes NOTHING when the catalog rejects the item', async () => {
			mockGetItem.mockResolvedValue(null);

			await expect(repo.receiveWalkInDonation(walkIn, receive, ctx)).rejects.toThrow(
				'Unknown item: item:rice'
			);

			// the guard runs before the write, so no orphan donation is left behind
			expect(await repo.listDonations()).toHaveLength(0);
			expect(await repo.listLedger()).toHaveLength(0);
		});

		it('receipts as a donation even if the caller names another source', async () => {
			mockGetItem.mockResolvedValue({ unit: 'kg' } as SupplyItem);

			// a walk-in IS a donation; a caller passing 'manual' would otherwise map
			// to reason 'adjust' and be rejected by R2 for carrying a ref_id
			const { entry } = await repo.receiveWalkInDonation(
				walkIn,
				{ ...receive, source: 'manual' as const },
				ctx
			);

			expect(entry.reason).toBe('donation');
		});

		it('writes NOTHING when the unit disagrees with the catalog', async () => {
			mockGetItem.mockResolvedValue({ unit: 'bag' } as SupplyItem);

			await expect(repo.receiveWalkInDonation(walkIn, receive, ctx)).rejects.toThrow();
			expect(await repo.listDonations()).toHaveLength(0);
		});
	});

	// CR-032 — procurement is two separate steps: the purchase doc is declared
	// first, the counted receipt is keyed later as plain ledger appends.
	describe('purchase (CR-032)', () => {
		beforeEach(() => {
			mockGetItem.mockReset();
		});

		const input = {
			vendor: 'ACME Trading',
			po_ref: 'PO-1',
			items: [{ item_id: 'item:rice', qty: 100, unit: 'kg' }]
		};

		it('creates a purchase doc that moves no stock on its own', async () => {
			const purchase = await repo.createPurchase(input, ctx);

			expect(purchase.type).toBe('purchase');
			expect(purchase.vendor).toBe('ACME Trading');
			expect(purchase.po_ref).toBe('PO-1');
			expect(await repo.listLedger()).toHaveLength(0);

			const list = await repo.listPurchases();
			expect(list).toHaveLength(1);
			expect(list[0]._id).toBe(purchase._id);
			expect((await repo.getPurchase(purchase._id))?.vendor).toBe('ACME Trading');
		});

		it('keys a counted receipt into ledger rows referencing the purchase', async () => {
			mockGetItem.mockResolvedValue({ unit: 'kg' } as SupplyItem);
			const purchase = await repo.createPurchase(input, ctx);

			// Counted short of the 100 kg declared — the ledger, not `items`, is the truth.
			const rows = await repo.receivePurchase(
				purchase,
				[{ item_id: 'item:rice', qty: '90', unit: 'kg' }],
				ctx
			);

			expect(rows).toHaveLength(1);
			expect(rows[0].reason).toBe('purchase');
			expect(rows[0].ref_id).toBe(purchase._id);

			const stored = await repo.listLedger();
			expect(stored).toHaveLength(1);
			expect(stored[0].qty).toBe('90');
			expect((await repo.getBalance()).get('item:rice')).toBe('90');
		});

		it('writes every counted line of a multi-item receipt', async () => {
			mockGetItem.mockImplementation(async () => ({ unit: 'kg' }) as SupplyItem);
			const purchase = await repo.createPurchase(
				{
					vendor: 'ACME Trading',
					items: [
						{ item_id: 'item:rice', qty: 100, unit: 'kg' },
						{ item_id: 'item:sugar', qty: 20, unit: 'kg' }
					]
				},
				ctx
			);

			await repo.receivePurchase(
				purchase,
				[
					{ item_id: 'item:rice', qty: '100', unit: 'kg' },
					{ item_id: 'item:sugar', qty: '20', unit: 'kg' }
				],
				ctx
			);

			const balance = await repo.getBalance();
			expect(balance.get('item:rice')).toBe('100');
			expect(balance.get('item:sugar')).toBe('20');
		});

		it('allows keying a second receipt against the same purchase (append-only)', async () => {
			mockGetItem.mockResolvedValue({ unit: 'kg' } as SupplyItem);
			const purchase = await repo.createPurchase(input, ctx);

			await repo.receivePurchase(purchase, [{ item_id: 'item:rice', qty: '60', unit: 'kg' }], ctx);
			await repo.receivePurchase(purchase, [{ item_id: 'item:rice', qty: '40', unit: 'kg' }], ctx);

			const stored = await repo.listLedger();
			expect(stored).toHaveLength(2);
			expect(stored.every((row) => row.ref_id === purchase._id)).toBe(true);
			expect((await repo.getBalance()).get('item:rice')).toBe('100');
		});

		it('rejects a receipt with no counted lines', async () => {
			const purchase = await repo.createPurchase(input, ctx);

			await expect(repo.receivePurchase(purchase, [], ctx)).rejects.toThrow(
				'needs at least one counted line'
			);
			expect(await repo.listLedger()).toHaveLength(0);
		});

		it('validates every line against the catalog before writing anything', async () => {
			mockGetItem.mockImplementation(async (itemId: string) =>
				itemId === 'item:rice' ? ({ unit: 'kg' } as SupplyItem) : null
			);
			const purchase = await repo.createPurchase(input, ctx);

			await expect(
				repo.receivePurchase(
					purchase,
					[
						{ item_id: 'item:rice', qty: '100', unit: 'kg' },
						{ item_id: 'item:ghost', qty: '5', unit: 'kg' }
					],
					ctx
				)
			).rejects.toThrow('Unknown item: item:ghost');

			// The valid first line must not have landed either.
			expect(await repo.listLedger()).toHaveLength(0);
		});

		it('corrects a purchase that has not been received yet', async () => {
			const purchase = await repo.createPurchase(input, ctx);

			const updated = await repo.updatePurchase({ ...purchase, vendor: 'ACME Trading (แก้ไข)' });

			expect(updated.vendor).toBe('ACME Trading (แก้ไข)');
			expect((await repo.getPurchase(purchase._id))?.vendor).toBe('ACME Trading (แก้ไข)');
		});

		it('refuses to correct a purchase once a receipt has been keyed', async () => {
			mockGetItem.mockResolvedValue({ unit: 'kg' } as SupplyItem);
			const purchase = await repo.createPurchase(input, ctx);
			// Partial receipt is enough — `items` is what the status compares against.
			await repo.receivePurchase(purchase, [{ item_id: 'item:rice', qty: '10', unit: 'kg' }], ctx);

			await expect(repo.updatePurchase({ ...purchase, vendor: 'Someone Else' })).rejects.toThrow(
				'has already been received'
			);

			expect((await repo.getPurchase(purchase._id))?.vendor).toBe('ACME Trading');
		});

		it('rejects a perishable line without lot.expiry', async () => {
			mockGetItem.mockResolvedValue({ unit: 'l', perishable: true } as SupplyItem);
			const purchase = await repo.createPurchase(
				{ vendor: 'ACME Trading', items: [{ item_id: 'item:milk', qty: 5, unit: 'l' }] },
				ctx
			);

			await expect(
				repo.receivePurchase(purchase, [{ item_id: 'item:milk', qty: '5', unit: 'l' }], ctx)
			).rejects.toThrow('Perishable item item:milk requires lot.expiry to be set');

			const ok = await repo.receivePurchase(
				purchase,
				[{ item_id: 'item:milk', qty: '5', unit: 'l', lot: { expiry: '2026-12-31T00:00:00Z' } }],
				ctx
			);
			expect(ok[0].lot?.expiry).toBe('2026-12-31T00:00:00Z');
		});
	});
});

describe('OperationsRemoteRepository.updateCampaign', () => {
	let repo: OperationsRemoteRepository;

	beforeEach(() => {
		memoryRepo = createInMemoryRepository();
		repo = new OperationsRemoteRepository('shelter_sh001');
	});

	it('should update campaign and create an audit log entry', async () => {
		const created = await repo.createCampaign(
			{
				title: 'น้ำดื่มและยารักษาโรค',
				needs: [{ item_id: 'item:water', qty_target: 100, unit: 'ขวด', status: 'open' }]
			},
			ctx
		);

		const updatedCampaign = {
			...created,
			title: 'น้ำดื่มและยารักษาโรค (ด่วนพิเศษ)'
		};

		const auditInput = {
			action: 'manual_adjust' as const,
			reason: 'อัปเดตชื่อแคมเปญเพื่อความชัดเจน',
			ctx
		};

		const result = await repo.updateCampaign(updatedCampaign, auditInput);

		expect(result.title).toBe('น้ำดื่มและยารักษาโรค (ด่วนพิเศษ)');
		const storedCampaign = await repo.getCampaign(created._id);
		expect(storedCampaign?.title).toBe('น้ำดื่มและยารักษาโรค (ด่วนพิเศษ)');

		const auditDocs = await memoryRepo.allByType('audit', isAuditEntry);
		expect(auditDocs).toHaveLength(1);
		expect(auditDocs[0]).toMatchObject({
			action: 'manual_adjust',
			target_type: 'donation_campaign',
			target_id: created._id,
			reason: 'อัปเดตชื่อแคมเปญเพื่อความชัดเจน',
			created_by: 'tester'
		});
	});
});
