import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$lib/features/catalog', () => ({
	catalogRepository: () => ({
		listItemMasters: async () =>
			[
				'item:a',
				'item:b',
				'item:blanket',
				'item:c',
				'item:curry',
				'item:lamp',
				'item:mat',
				'item:other',
				'item:rice',
				'item:soup',
				'item:water'
			].map((_id) => ({ _id, base_unit: _id === 'item:rice' ? 'kg' : 'piece' })),
		listUnitsOfMeasure: async () => []
	}),
	itemMasterUnit: (item: { base_unit?: string; unit?: string }) =>
		item.base_unit ?? item.unit ?? 'piece',
	canonicalizeUnitCode: (value: unknown) => (value === 'ชิ้น' ? 'piece' : value)
}));
import { ulid } from '$lib/db/ulid';
import type { AuthorContext } from '$lib/db/model';
import { ConflictError } from '$lib/utils/errors';
import { qtyNeg } from '$lib/utils/qty';
import type {
	Flow2RequisitionTicket,
	RequisitionTicket,
	RequisitionTicketInput
} from '../../domain/food-supplies';
import type { RequisitionTicketRepository } from '../../data/food-supplies';
import {
	createStockLedger,
	deriveDeterministicLedgerId,
	type OperationsRepository,
	type StockLedger
} from '$lib/features/operations';
import { amendActiveTicket, dispatchTicket } from './dispatch-workflow';
import { StockIntegrityError, WorkflowValidationError } from './errors';

class InMemoryTicketRepository implements RequisitionTicketRepository {
	tickets = new Map<string, RequisitionTicket>();
	casConflictCount = 0;

	async create(
		input: RequisitionTicketInput | Flow2RequisitionTicket,
		ctx: AuthorContext
	): Promise<Flow2RequisitionTicket> {
		const id = `requisition_ticket:${ulid()}`;

		const doc = {
			_id: id,
			type: 'requisition_ticket',
			schema_v: 1,
			shelter_code: ctx.shelterCode,
			ticket_no: `TKT-${input.requisition_type.toUpperCase()}-0001`,
			requisition_type: input.requisition_type,
			meal: 'meal' in input ? input.meal : undefined,
			source_location: input.source_location,
			destination_location: input.destination_location,
			status: 'READY_FOR_DISPATCH' as const,
			requested_by: ctx.createdBy,
			items: input.items.map((i) => {
				const item = i as { requested_qty: string; allocated_qty?: string };
				return {
					...i,
					allocated_qty: item.allocated_qty ?? item.requested_qty
				};
			}),
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
			created_by: ctx.createdBy
		} as unknown as Flow2RequisitionTicket;
		this.tickets.set(id, doc);
		return doc;
	}

	async get(ticketId: string): Promise<RequisitionTicket | null> {
		return this.tickets.get(ticketId) ?? null;
	}

	async list(): Promise<RequisitionTicket[]> {
		return Array.from(this.tickets.values());
	}

	async mutateTicketCAS(
		ticketId: string,
		mutator: (current: RequisitionTicket) => RequisitionTicket,
		_ctx: AuthorContext
	): Promise<RequisitionTicket> {
		void _ctx;
		const current = this.tickets.get(ticketId);
		if (!current) throw new Error('Not found');
		if (this.casConflictCount > 0) {
			this.casConflictCount--;
			mutator(current);
		}
		const updated = mutator(current);
		this.tickets.set(ticketId, updated);
		return updated;
	}

	async transitionTicket(
		ticketId: string,
		toStatus: RequisitionTicket['status'],
		_ctx: AuthorContext,
		patch?: Partial<RequisitionTicket>
	): Promise<RequisitionTicket> {
		void _ctx;
		const current = this.tickets.get(ticketId);
		if (!current) throw new Error('Not found');
		const updated = {
			...current,
			...patch,
			status: toStatus,
			updated_at: new Date().toISOString()
		};
		this.tickets.set(ticketId, updated);
		return updated;
	}
}

class InMemoryOperationsRepository implements Partial<OperationsRepository> {
	ledger: StockLedger[] = [];
	throwConflictOnNext = false;
	throwNonConflictErrorOnNext: Error | null = null;
	throwNonConflictForItemOnce: string | null = null;
	beforeAdd: ((entry: StockLedger) => void) | null = null;
	getLedgerEntryCalls: string[] = [];
	dispatchWriteBarrier: {
		target: number;
		arrived: number;
		release: () => void;
		resolveAllArrived: () => void;
		waitForRelease: Promise<void>;
		allArrived: Promise<void>;
	} | null = null;

	holdDispatchWrites(target = 2): { allArrived: Promise<void>; release: () => void } {
		let release = () => {};
		let resolveAllArrived = () => {};
		const waitForRelease = new Promise<void>((resolve) => {
			release = resolve;
		});
		const allArrived = new Promise<void>((resolve) => {
			resolveAllArrived = resolve;
		});
		this.dispatchWriteBarrier = {
			target,
			arrived: 0,
			release,
			resolveAllArrived,
			waitForRelease,
			allArrived
		};
		return { allArrived, release };
	}

	async addLedgerEntry(entry: StockLedger): Promise<StockLedger> {
		const barrier = this.dispatchWriteBarrier;
		if (barrier) {
			barrier.arrived++;
			if (barrier.arrived === barrier.target) {
				barrier.resolveAllArrived();
			}
			await barrier.waitForRelease;
		}
		if (this.beforeAdd) {
			const beforeAdd = this.beforeAdd;
			this.beforeAdd = null;
			beforeAdd(entry);
		}
		if (this.throwNonConflictErrorOnNext) {
			const err = this.throwNonConflictErrorOnNext;
			this.throwNonConflictErrorOnNext = null;
			throw err;
		}
		if (this.throwNonConflictForItemOnce === entry.item_id) {
			this.throwNonConflictForItemOnce = null;
			throw new Error(`Transient write failure for ${entry.item_id}`);
		}
		if (this.throwConflictOnNext) {
			this.throwConflictOnNext = false;
			throw new ConflictError();
		}
		const existing = this.ledger.find((candidate) => candidate._id === entry._id);
		if (existing) {
			throw new ConflictError();
		}
		this.ledger.push(entry);
		return entry;
	}

	async getLedgerEntry(id: string): Promise<StockLedger | null> {
		this.getLedgerEntryCalls.push(id);
		return this.ledger.find((entry) => entry._id === id) ?? null;
	}

	async listLedger(): Promise<StockLedger[]> {
		return [...this.ledger];
	}

	async listLedgerByItem(itemId: string): Promise<StockLedger[]> {
		return this.ledger.filter((l) => l.item_id === itemId);
	}
}

describe('dispatch-workflow', () => {
	let ticketRepo: InMemoryTicketRepository;
	let opsRepo: InMemoryOperationsRepository;
	const WH_CTX: AuthorContext = {
		shelterCode: 'SH001',
		createdBy: 'wh_user',
		roles: ['shelter:SH001', 'warehouse_staff']
	};
	const SC_CTX: AuthorContext = {
		shelterCode: 'SH001',
		createdBy: 'sc_user',
		roles: ['shelter:SH001', 'supply_coordinator']
	};
	const UNAUTH_CTX: AuthorContext = {
		shelterCode: 'SH001',
		createdBy: 'med_user',
		roles: ['shelter:SH001', 'medical_staff']
	};

	beforeEach(() => {
		ticketRepo = new InMemoryTicketRepository();
		opsRepo = new InMemoryOperationsRepository();
	});

	/** Seeds a received physical lot into the ledger and returns its lot_ref. */
	function seedLot(
		itemId: string,
		qty: string,
		opts: { expiry?: string; receivedAt?: string } = {}
	): string {
		const entry = createStockLedger(
			{
				item_id: itemId,
				qty,
				unit: itemId === 'item:rice' ? 'kg' : 'piece',
				reason: 'receive',
				ref_id: 'requisition_ticket:tkt_receive_001',
				...(opts.expiry ? { lot: { expiry: opts.expiry } } : {}),
				occurred_at: opts.receivedAt ?? '2026-01-01T00:00:00.000Z'
			},
			WH_CTX
		);
		opsRepo.ledger.push(entry);
		return entry._id;
	}

	const distributeRows = () => opsRepo.ledger.filter((l) => l.reason === 'distribute');
	const deps = () => ({
		ticketRepo,
		operationsRepo: opsRepo as unknown as OperationsRepository
	});

	it('dispatches multi-item ticket with exact negative stock ledger entries and lot_ref', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-FOOD-0001',
				requisition_type: 'food',
				meal: 'lunch',
				source_location: 'warehouse:main',
				destination_location: 'point:a',
				items: [
					{
						item_id: 'item:curry',
						item_name: 'Chicken Curry',
						category: 'item_category:ready_meal',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '50',
						allocated_qty: '50'
					},
					{
						item_id: 'item:water',
						item_name: 'Water Bottle',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '100',
						allocated_qty: '100'
					}
				]
			},
			WH_CTX
		);

		const curryLot = seedLot('item:curry', '60');
		const waterLot = seedLot('item:water', '100');

		const result = await dispatchTicket(
			ticket._id,
			{
				driver_name: 'Somchai',
				license_plate: '1AB-1234',
				item_lots: {
					'item:curry': [{ lot_ref: curryLot, qty: '50' }],
					'item:water': [{ lot_ref: waterLot, qty: '100' }]
				}
			},
			WH_CTX,
			{ ticketRepo, operationsRepo: opsRepo as unknown as OperationsRepository }
		);

		expect(result.ticket.status).toBe('IN_TRANSIT');
		expect(result.ticket.dispatched_by).toBe(WH_CTX.createdBy);
		expect(result.ticket.driver_name).toBe('Somchai');
		expect(result.ticket.license_plate).toBe('1AB-1234');
		expect(result.ledgerEntriesCreated).toBe(2);

		// Assert StockLedger entries (the two seeded receive rows come first)
		const outbound = opsRepo.ledger.filter((l) => l.reason === 'distribute');
		expect(outbound).toHaveLength(2);
		const curryEntry = outbound.find((l) => l.item_id === 'item:curry')!;
		expect(curryEntry.reason).toBe('distribute');
		expect(curryEntry.ref_id).toBe(ticket._id);
		expect(curryEntry.qty).toBe('-50');
		expect(curryEntry.unit).toBe('piece');
		expect(curryEntry.lot_ref).toBe(curryLot);

		const waterEntry = outbound.find((l) => l.item_id === 'item:water')!;
		expect(waterEntry.lot_ref).toBe(waterLot);
		expect(waterEntry.reason).toBe('distribute');
		expect(waterEntry.ref_id).toBe(ticket._id);
		expect(waterEntry.qty).toBe('-100');
		expect(waterEntry.unit).toBe('piece');
	});

	it("uses an item master's non-piece canonical unit for the dispatch ledger", async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-SUPPLIES-RICE-0001',
				requisition_type: 'supplies',
				source_location: 'warehouse:main',
				destination_location: 'point:a',
				items: [
					{
						item_id: 'item:rice',
						item_name: 'Rice',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '2',
						allocated_qty: '2'
					}
				]
			},
			WH_CTX
		);

		const riceLot = seedLot('item:rice', '5');
		await dispatchTicket(
			ticket._id,
			{ item_lots: { 'item:rice': [{ lot_ref: riceLot, qty: '2' }] } },
			WH_CTX,
			deps()
		);

		expect(distributeRows()).toHaveLength(1);
		expect(distributeRows()[0]?.unit).toBe('kg');
	});

	it('authorizes supply_coordinator for ticket dispatch (CR-121 FR-SEC-01 Step 3)', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-SUPPLIES-0001',
				requisition_type: 'supplies',
				source_location: 'warehouse:main',
				destination_location: 'point:b',
				items: [
					{
						item_id: 'item:blanket',
						item_name: 'Blanket',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '25',
						allocated_qty: '25'
					}
				]
			},
			WH_CTX
		);

		const blanketLot = seedLot('item:blanket', '25');
		const result = await dispatchTicket(
			ticket._id,
			{ item_lots: { 'item:blanket': [{ lot_ref: blanketLot, qty: '25' }] } },
			SC_CTX,
			deps()
		);

		expect(result.ticket.status).toBe('IN_TRANSIT');
		expect(result.ticket.dispatched_by).toBe(SC_CTX.createdBy);
	});

	it('rejects dispatch from unauthorized role', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-SUPPLIES-0002',
				requisition_type: 'supplies',
				source_location: 'warehouse:main',
				destination_location: 'point:b',
				items: [
					{
						item_id: 'item:blanket',
						item_name: 'Blanket',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '25',
						allocated_qty: '25'
					}
				]
			},
			WH_CTX
		);

		await expect(
			dispatchTicket(ticket._id, undefined, UNAUTH_CTX, {
				ticketRepo,
				operationsRepo: opsRepo as unknown as OperationsRepository
			})
		).rejects.toThrow(/Unauthorized/);
	});

	it('does not duplicate ledger entries on dispatch retry', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-FOOD-0002',
				requisition_type: 'food',
				meal: 'lunch',
				source_location: 'warehouse:main',
				destination_location: 'point:a',
				items: [
					{
						item_id: 'item:soup',
						item_name: 'Soup',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '30',
						allocated_qty: '30'
					}
				]
			},
			WH_CTX
		);

		const soupLot = seedLot('item:soup', '30');
		const options = { item_lots: { 'item:soup': [{ lot_ref: soupLot, qty: '30' }] } };

		// First dispatch succeeds
		await dispatchTicket(ticket._id, options, WH_CTX, deps());
		expect(distributeRows()).toHaveLength(1);

		// Reset ticket status to READY_FOR_DISPATCH to simulate retry after network blip
		ticketRepo.tickets.get(ticket._id)!.status = 'READY_FOR_DISPATCH';

		// Second dispatch retry (lot is now fully drawn, own rows must not count against it)
		const retryResult = await dispatchTicket(ticket._id, options, WH_CTX, deps());
		expect(retryResult.ledgerEntriesCreated).toBe(0); // Detected existing ledger row
		expect(distributeRows()).toHaveLength(1); // No duplicate ledger entry
		expect(opsRepo.getLedgerEntryCalls).toEqual([distributeRows()[0]._id]);
	});

	it('serializes concurrent dispatches through one deterministic ledger identity', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-SUPPLIES-CONCURRENT-0001',
				requisition_type: 'supplies',
				source_location: 'warehouse:main',
				destination_location: 'point:b',
				items: [
					{
						item_id: 'item:blanket',
						item_name: 'Blanket',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '25',
						allocated_qty: '25'
					}
				]
			},
			WH_CTX
		);
		const blanketLot = seedLot('item:blanket', '25');
		const options = { item_lots: { 'item:blanket': [{ lot_ref: blanketLot, qty: '25' }] } };
		const barrier = opsRepo.holdDispatchWrites();

		const first = dispatchTicket(ticket._id, options, WH_CTX, deps());
		const second = dispatchTicket(ticket._id, options, WH_CTX, deps());

		await barrier.allArrived;
		barrier.release();
		await Promise.allSettled([first, second]);

		expect(distributeRows()).toHaveLength(1);
		expect(distributeRows()[0]).toMatchObject({
			item_id: 'item:blanket',
			qty: '-25',
			reason: 'distribute',
			ref_id: ticket._id
		});
		expect(distributeRows()[0]._id).toMatch(/^stock_ledger:[0-9A-HJKMNP-TV-Z]{26}$/);
		expect(ticketRepo.tickets.get(ticket._id)?.status).toBe('IN_TRANSIT');
	});

	it('fails closed when a deterministic dispatch ledger has a mismatched quantity', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-SUPPLIES-MISMATCH-0001',
				requisition_type: 'supplies',
				source_location: 'warehouse:main',
				destination_location: 'point:b',
				items: [
					{
						item_id: 'item:mat',
						item_name: 'Mat',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '10',
						allocated_qty: '10'
					}
				]
			},
			WH_CTX
		);
		const matLot = seedLot('item:mat', '10');
		opsRepo.beforeAdd = (entry) => {
			opsRepo.ledger.push({ ...entry, qty: '-9' });
		};

		await expect(
			dispatchTicket(
				ticket._id,
				{ item_lots: { 'item:mat': [{ lot_ref: matLot, qty: '10' }] } },
				WH_CTX,
				deps()
			)
		).rejects.toThrow(StockIntegrityError);

		expect(distributeRows()).toHaveLength(1);
		expect(distributeRows()[0].qty).toBe('-9');
		expect(ticketRepo.tickets.get(ticket._id)?.status).toBe('READY_FOR_DISPATCH');
	});

	it('fails closed when a deterministic dispatch replay changes lot_ref', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-SUPPLIES-LOT-0001',
				requisition_type: 'supplies',
				source_location: 'warehouse:main',
				destination_location: 'point:b',
				items: [
					{
						item_id: 'item:lamp',
						item_name: 'Lamp',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '5',
						allocated_qty: '5'
					}
				]
			},
			WH_CTX
		);
		const lampLot = seedLot('item:lamp', '5');
		opsRepo.beforeAdd = (entry) => {
			opsRepo.ledger.push({ ...entry, lot_ref: 'stock_ledger:01JOTHERLOT000000000000000' });
		};

		await expect(
			dispatchTicket(
				ticket._id,
				{ item_lots: { 'item:lamp': [{ lot_ref: lampLot, qty: '5' }] } },
				WH_CTX,
				deps()
			)
		).rejects.toThrow(StockIntegrityError);

		expect(distributeRows()).toHaveLength(1);
		expect(ticketRepo.tickets.get(ticket._id)?.status).toBe('READY_FOR_DISPATCH');
	});

	it('recovers a partial multi-item dispatch without duplicating completed deductions', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-SUPPLIES-PARTIAL-0001',
				requisition_type: 'supplies',
				source_location: 'warehouse:main',
				destination_location: 'point:b',
				items: [
					{
						item_id: 'item:a',
						item_name: 'Item A',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '2',
						allocated_qty: '2'
					},
					{
						item_id: 'item:b',
						item_name: 'Item B',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '3',
						allocated_qty: '3'
					},
					{
						item_id: 'item:c',
						item_name: 'Item C',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '4',
						allocated_qty: '4'
					}
				]
			},
			WH_CTX
		);
		const options = {
			item_lots: {
				'item:a': [{ lot_ref: seedLot('item:a', '2'), qty: '2' }],
				'item:b': [{ lot_ref: seedLot('item:b', '3'), qty: '3' }],
				'item:c': [{ lot_ref: seedLot('item:c', '4'), qty: '4' }]
			}
		};
		opsRepo.throwNonConflictForItemOnce = 'item:c';

		await expect(dispatchTicket(ticket._id, options, WH_CTX, deps())).rejects.toThrow(
			'Transient write failure for item:c'
		);
		expect(distributeRows().map((entry) => entry.item_id)).toEqual(['item:a', 'item:b']);
		expect(ticketRepo.tickets.get(ticket._id)?.status).toBe('READY_FOR_DISPATCH');

		const recovered = await dispatchTicket(ticket._id, options, WH_CTX, deps());

		expect(recovered.ledgerEntriesCreated).toBe(1);
		expect(distributeRows()).toHaveLength(3);
		expect(new Set(distributeRows().map((entry) => entry._id)).size).toBe(3);
		expect(ticketRepo.tickets.get(ticket._id)?.status).toBe('IN_TRANSIT');
	});

	describe('multi-lot dispatch (#655)', () => {
		async function readyTicket(itemId: string, qty: string): Promise<RequisitionTicket> {
			return ticketRepo.create(
				{
					ticket_no: 'TKT-SUPPLIES-MULTI-0001',
					requisition_type: 'supplies',
					source_location: 'warehouse:main',
					destination_location: 'point:a',
					items: [
						{
							item_id: itemId,
							item_name: 'Water Bottle',
							type_class: 'CONSUMABLE',
							returnable: false,
							requested_qty: qty,
							allocated_qty: qty
						}
					]
				},
				WH_CTX
			);
		}

		it('splits 5 across lot 3 + lot 2 into two distribute rows with the same ref_id', async () => {
			const ticket = await readyTicket('item:water', '5');
			const lotA = seedLot('item:water', '3', { expiry: '2030-01-01' });
			const lotB = seedLot('item:water', '2', { expiry: '2031-01-01' });

			const result = await dispatchTicket(
				ticket._id,
				{
					item_lots: {
						'item:water': [
							// given out of expiry order on purpose
							{ lot_ref: lotB, qty: '2' },
							{ lot_ref: lotA, qty: '3' }
						]
					}
				},
				WH_CTX,
				deps()
			);

			expect(result.ticket.status).toBe('IN_TRANSIT');
			expect(result.ledgerEntriesCreated).toBe(2);
			const rows = distributeRows();
			expect(rows).toHaveLength(2);
			expect(rows.every((r) => r.ref_id === ticket._id && r.item_id === 'item:water')).toBe(true);
			// Earliest-expiry lot is written first and keeps the legacy dispatch id
			const legacyId = await deriveDeterministicLedgerId('dispatch', ticket._id, 'item:water');
			expect(rows[0]).toMatchObject({ _id: legacyId, lot_ref: lotA, qty: '-3' });
			expect(rows[1]).toMatchObject({ lot_ref: lotB, qty: '-2' });
			expect(rows[1]._id).not.toBe(legacyId);
		});

		it('writes a noon datetime expiry before a bare date of the same Bangkok day (CR-195)', async () => {
			const ticket = await readyTicket('item:water', '5');
			const bareDate = seedLot('item:water', '3', { expiry: '2030-06-01' });
			const noon = seedLot('item:water', '2', { expiry: '2030-06-01T12:00:00+07:00' });

			await dispatchTicket(
				ticket._id,
				{
					item_lots: {
						'item:water': [
							{ lot_ref: bareDate, qty: '3' },
							{ lot_ref: noon, qty: '2' }
						]
					}
				},
				WH_CTX,
				deps()
			);

			expect(distributeRows().map((r) => r.lot_ref)).toEqual([noon, bareDate]);
		});

		it('rejects dispatch when an item has no lot and writes nothing', async () => {
			const ticket = await readyTicket('item:water', '5');
			seedLot('item:water', '5');

			await expect(dispatchTicket(ticket._id, undefined, WH_CTX, deps())).rejects.toThrow(
				WorkflowValidationError
			);
			await expect(
				dispatchTicket(ticket._id, { item_lots: { 'item:water': [] } }, WH_CTX, deps())
			).rejects.toThrow(/no physical lot/);
			expect(distributeRows()).toHaveLength(0);
			expect(ticketRepo.tickets.get(ticket._id)?.status).toBe('READY_FOR_DISPATCH');
		});

		it('validates every item before writing any row', async () => {
			const ticket = await ticketRepo.create(
				{
					ticket_no: 'TKT-SUPPLIES-MULTI-0002',
					requisition_type: 'supplies',
					source_location: 'warehouse:main',
					destination_location: 'point:a',
					items: ['item:a', 'item:b'].map((item_id) => ({
						item_id,
						item_name: item_id,
						type_class: 'CONSUMABLE' as const,
						returnable: false,
						requested_qty: '2',
						allocated_qty: '2'
					}))
				},
				WH_CTX
			);
			const lotA = seedLot('item:a', '2');

			await expect(
				dispatchTicket(
					ticket._id,
					{ item_lots: { 'item:a': [{ lot_ref: lotA, qty: '2' }] } },
					WH_CTX,
					deps()
				)
			).rejects.toThrow(WorkflowValidationError);
			expect(distributeRows()).toHaveLength(0);
		});

		it('rejects a short or over lot total', async () => {
			const ticket = await readyTicket('item:water', '5');
			const lotA = seedLot('item:water', '10');
			const lotB = seedLot('item:water', '10');

			for (const qtys of [
				['2', '2'],
				['3', '3']
			]) {
				await expect(
					dispatchTicket(
						ticket._id,
						{
							item_lots: {
								'item:water': [
									{ lot_ref: lotA, qty: qtys[0] },
									{ lot_ref: lotB, qty: qtys[1] }
								]
							}
						},
						WH_CTX,
						deps()
					)
				).rejects.toThrow(/add up to the allocated quantity/);
			}
			expect(distributeRows()).toHaveLength(0);
		});

		it('rejects a qty above the lot remaining balance', async () => {
			const ticket = await readyTicket('item:water', '5');
			const lotA = seedLot('item:water', '3');
			const lotB = seedLot('item:water', '2');

			await expect(
				dispatchTicket(
					ticket._id,
					{
						item_lots: {
							'item:water': [
								{ lot_ref: lotA, qty: '4' },
								{ lot_ref: lotB, qty: '1' }
							]
						}
					},
					WH_CTX,
					deps()
				)
			).rejects.toThrow(/exceeds the lot remaining balance/);
			expect(distributeRows()).toHaveLength(0);
		});

		it('rejects an expired lot', async () => {
			const ticket = await readyTicket('item:water', '2');
			const expired = seedLot('item:water', '5', { expiry: '2020-01-01' });

			await expect(
				dispatchTicket(
					ticket._id,
					{ item_lots: { 'item:water': [{ lot_ref: expired, qty: '2' }] } },
					WH_CTX,
					deps()
				)
			).rejects.toThrow(/lot is expired/);
			expect(distributeRows()).toHaveLength(0);
		});

		it('retries after a partial write without duplicating rows', async () => {
			const ticket = await readyTicket('item:water', '5');
			const lotA = seedLot('item:water', '3', { expiry: '2030-01-01' });
			const lotB = seedLot('item:water', '2', { expiry: '2031-01-01' });
			const options = {
				item_lots: {
					'item:water': [
						{ lot_ref: lotA, qty: '3' },
						{ lot_ref: lotB, qty: '2' }
					]
				}
			};

			await dispatchTicket(ticket._id, options, WH_CTX, deps());
			// Simulate a crash after the first row: drop the second row, reopen the ticket
			opsRepo.ledger = opsRepo.ledger.filter(
				(entry) => !(entry.reason === 'distribute' && entry.lot_ref === lotB)
			);
			ticketRepo.tickets.get(ticket._id)!.status = 'READY_FOR_DISPATCH';

			const retry = await dispatchTicket(ticket._id, options, WH_CTX, deps());

			expect(retry.ledgerEntriesCreated).toBe(1);
			expect(distributeRows()).toHaveLength(2);
			expect(new Set(distributeRows().map((entry) => entry._id)).size).toBe(2);
			expect(retry.ticket.status).toBe('IN_TRANSIT');
		});
	});

	it('amends active ticket with in-flight top-up deduction and amendment record', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-FOOD-0003',
				requisition_type: 'food',
				meal: 'lunch',
				source_location: 'warehouse:main',
				destination_location: 'point:a',
				items: [
					{
						item_id: 'item:soup',
						item_name: 'Soup',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '30',
						allocated_qty: '30'
					}
				]
			},
			WH_CTX
		);

		// Move to DISTRIBUTING
		ticketRepo.tickets.get(ticket._id)!.status = 'DISTRIBUTING';

		const amended = await amendActiveTicket(
			ticket._id,
			{
				amendmentId: ulid(),
				item_id: 'item:soup',
				added_qty: '20',
				reason: 'Emergency bus arrived'
			},
			WH_CTX,
			{ ticketRepo, operationsRepo: opsRepo as unknown as OperationsRepository }
		);

		expect(amended.items[0].allocated_qty).toBe('50'); // 30 + 20
		expect(amended.amendments).toHaveLength(1);
		expect(amended.amendments![0].added_qty).toBe('20');
		expect(amended.amendments![0].reason).toBe('Emergency bus arrived');

		// In-flight outbound stock deduction written
		const amendmentLedger = opsRepo.ledger[opsRepo.ledger.length - 1];
		expect(amendmentLedger.reason).toBe('distribute');
		expect(amendmentLedger.qty).toBe('-20');
		expect(amendmentLedger.ref_id).toBe(ticket._id);
	});

	describe('P1-04 amendActiveTicket retry-safety', () => {
		async function createDistributingTicket(initialAllocated = '30'): Promise<RequisitionTicket> {
			const ticket = await ticketRepo.create(
				{
					ticket_no: 'TKT-FOOD-0004',
					requisition_type: 'food',
					meal: 'lunch',
					source_location: 'warehouse:main',
					destination_location: 'point:a',
					items: [
						{
							item_id: 'item:soup',
							item_name: 'Soup',
							type_class: 'CONSUMABLE',
							returnable: false,
							requested_qty: initialAllocated,
							allocated_qty: initialAllocated
						}
					]
				},
				WH_CTX
			);
			ticketRepo.tickets.get(ticket._id)!.status = 'DISTRIBUTING';
			return ticketRepo.tickets.get(ticket._id)!;
		}

		it('A. Normal amendment: creates one outbound ledger, one amendment, increments allocated_qty once', async () => {
			const ticket = await createDistributingTicket('30');
			const amendmentId = ulid();

			const amended = await amendActiveTicket(
				ticket._id,
				{ amendmentId, item_id: 'item:soup', added_qty: '20', reason: 'Normal top-up' },
				WH_CTX,
				{ ticketRepo, operationsRepo: opsRepo as unknown as OperationsRepository }
			);

			expect(amended.items[0].allocated_qty).toBe('50');
			expect(amended.amendments).toHaveLength(1);
			expect(amended.amendments![0].amendment_id).toBe(amendmentId);
			expect(amended.amendments![0].added_qty).toBe('20');
			expect(amended.amendments![0].reason).toBe('Normal top-up');

			// Outbound ledger entry created with deterministic _id
			expect(opsRepo.ledger).toHaveLength(1);
			expect(opsRepo.ledger[0]._id).toBe(`stock_ledger:${amendmentId}`);
			expect(opsRepo.ledger[0].reason).toBe('distribute');
			expect(opsRepo.ledger[0].qty).toBe('-20');
			expect(opsRepo.ledger[0].ref_id).toBe(ticket._id);
		});

		it('B. LEDGER_ONLY recovery: recovers when ledger exists (409 Conflict), exact-ID fetches it, appends amendment without second debit', async () => {
			const ticket = await createDistributingTicket('30');
			const amendmentId = ulid();

			// Pre-existing deterministic ledger already persisted on a previous attempt
			const existingLedger = createStockLedger(
				{
					item_id: 'item:soup',
					qty: qtyNeg('20'),
					unit: 'piece',
					reason: 'distribute',
					ref_id: ticket._id,
					lot_ref: `stock_ledger:${amendmentId}`,
					occurred_at: '2026-09-17T12:00:00.000Z'
				},
				WH_CTX,
				amendmentId
			);
			opsRepo.ledger.push(existingLedger);

			// Calling amendActiveTicket with same amendmentId hits conflict and recovers
			const amended = await amendActiveTicket(
				ticket._id,
				{ amendmentId, item_id: 'item:soup', added_qty: '20', reason: 'Top-up retry' },
				WH_CTX,
				{ ticketRepo, operationsRepo: opsRepo as unknown as OperationsRepository }
			);

			expect(amended.items[0].allocated_qty).toBe('50');
			expect(amended.amendments).toHaveLength(1);
			expect(amended.amendments![0].amendment_id).toBe(amendmentId);
			// No duplicate ledger entry created!
			expect(opsRepo.ledger).toHaveLength(1);
		});

		it('C. COMPLETE replay: returns idempotent success without new ledger or second allocated_qty increment', async () => {
			const ticket = await createDistributingTicket('30');
			const amendmentId = ulid();

			// First execution completes fully
			const first = await amendActiveTicket(
				ticket._id,
				{ amendmentId, item_id: 'item:soup', added_qty: '20', reason: 'Top-up first' },
				WH_CTX,
				{ ticketRepo, operationsRepo: opsRepo as unknown as OperationsRepository }
			);
			expect(first.items[0].allocated_qty).toBe('50');
			expect(opsRepo.ledger).toHaveLength(1);

			// Second execution (sequential retry with same amendmentId)
			const second = await amendActiveTicket(
				ticket._id,
				{ amendmentId, item_id: 'item:soup', added_qty: '20', reason: 'Top-up first' },
				WH_CTX,
				{ ticketRepo, operationsRepo: opsRepo as unknown as OperationsRepository }
			);

			expect(second.items[0].allocated_qty).toBe('50');
			expect(second.amendments).toHaveLength(1);
			expect(opsRepo.ledger).toHaveLength(1); // No second debit
		});

		it('D. Ledger replay mismatch: fails closed if existing deterministic ledger has different semantics', async () => {
			const ticket = await createDistributingTicket('30');
			const amendmentId = ulid();

			// Pre-existing ledger has conflicting item_id
			const conflictingLedger = createStockLedger(
				{
					item_id: 'item:other',
					qty: qtyNeg('20'),
					unit: 'piece',
					reason: 'distribute',
					ref_id: ticket._id,
					lot_ref: `stock_ledger:${amendmentId}`,
					occurred_at: '2026-09-17T12:00:00.000Z'
				},
				WH_CTX,
				amendmentId
			);
			opsRepo.ledger.push(conflictingLedger);

			await expect(
				amendActiveTicket(
					ticket._id,
					{ amendmentId, item_id: 'item:soup', added_qty: '20' },
					WH_CTX,
					{ ticketRepo, operationsRepo: opsRepo as unknown as OperationsRepository }
				)
			).rejects.toThrow(StockIntegrityError);

			// Ticket remains unmutated
			const freshTicket = await ticketRepo.get(ticket._id);
			expect(freshTicket?.items[0].allocated_qty).toBe('30');
			expect(freshTicket?.amendments ?? []).toHaveLength(0);
		});

		it('E. Amendment replay mismatch: fails closed if same amendment_id exists with different semantics', async () => {
			const ticket = await createDistributingTicket('30');
			const amendmentId = ulid();

			// First execution
			await amendActiveTicket(
				ticket._id,
				{ amendmentId, item_id: 'item:soup', added_qty: '20', reason: 'Reason 1' },
				WH_CTX,
				{ ticketRepo, operationsRepo: opsRepo as unknown as OperationsRepository }
			);

			// Caller tries same amendmentId with different added_qty
			await expect(
				amendActiveTicket(
					ticket._id,
					{ amendmentId, item_id: 'item:soup', added_qty: '40', reason: 'Reason 1' },
					WH_CTX,
					{ ticketRepo, operationsRepo: opsRepo as unknown as OperationsRepository }
				)
			).rejects.toThrow(StockIntegrityError);
		});

		it('F. Ordinary non-ConflictError: propagates error and does not mutate ticket', async () => {
			const ticket = await createDistributingTicket('30');
			const amendmentId = ulid();

			opsRepo.throwNonConflictErrorOnNext = new Error('Database disk full');

			await expect(
				amendActiveTicket(
					ticket._id,
					{ amendmentId, item_id: 'item:soup', added_qty: '20' },
					WH_CTX,
					{ ticketRepo, operationsRepo: opsRepo as unknown as OperationsRepository }
				)
			).rejects.toThrow('Database disk full');

			// Ticket not mutated
			const freshTicket = await ticketRepo.get(ticket._id);
			expect(freshTicket?.items[0].allocated_qty).toBe('30');
			expect(freshTicket?.amendments ?? []).toHaveLength(0);
		});

		it('G. CAS retry: ticket CAS retry reuses same amendmentId without duplicate amendment or allocated_qty', async () => {
			const ticket = await createDistributingTicket('30');
			const amendmentId = ulid();

			// Instruct mock ticket repo to retry CAS once
			ticketRepo.casConflictCount = 1;

			const amended = await amendActiveTicket(
				ticket._id,
				{ amendmentId, item_id: 'item:soup', added_qty: '20' },
				WH_CTX,
				{ ticketRepo, operationsRepo: opsRepo as unknown as OperationsRepository }
			);

			expect(amended.items[0].allocated_qty).toBe('50');
			expect(amended.amendments).toHaveLength(1);
			expect(amended.amendments![0].amendment_id).toBe(amendmentId);
			expect(opsRepo.ledger).toHaveLength(1);
		});

		it('AMENDMENT_ONLY recovery: fails closed if amendment exists on ticket but ledger is missing', async () => {
			const ticket = await createDistributingTicket('30');
			const amendmentId = ulid();

			// Manually inject amendment on ticket without corresponding ledger entry
			ticketRepo.tickets.get(ticket._id)!.amendments = [
				{
					amendment_id: amendmentId,
					item_id: 'item:soup',
					added_qty: '20',
					amended_at: '2026-09-17T12:00:00.000Z',
					amended_by: WH_CTX.createdBy,
					reason: 'Orphan amendment'
				}
			];

			await expect(
				amendActiveTicket(
					ticket._id,
					{ amendmentId, item_id: 'item:soup', added_qty: '20', reason: 'Orphan amendment' },
					WH_CTX,
					{ ticketRepo, operationsRepo: opsRepo as unknown as OperationsRepository }
				)
			).rejects.toThrow(StockIntegrityError);
		});

		it('rejects an untyped caller that omits the required stable amendmentId before writing', async () => {
			const ticket = await createDistributingTicket('30');

			await expect(
				amendActiveTicket(
					ticket._id,
					{ item_id: 'item:soup', added_qty: '20' } as unknown as Parameters<
						typeof amendActiveTicket
					>[1],
					WH_CTX,
					{ ticketRepo, operationsRepo: opsRepo as unknown as OperationsRepository }
				)
			).rejects.toBeInstanceOf(WorkflowValidationError);
			expect(opsRepo.ledger).toHaveLength(0);
			expect(ticketRepo.tickets.get(ticket._id)?.amendments ?? []).toHaveLength(0);
		});
	});
});
