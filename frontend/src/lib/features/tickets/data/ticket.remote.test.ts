// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createInMemoryRepository } from '$lib/db/in-memory-repository';

vi.mock('$lib/db/shelter', () => ({
	SHELTER_CODE: 'SH001',
	SHELTER_DB: 'shelter_sh001',
	getShelterDb: () => 'shelter_sh001'
}));

let memoryRepo = createInMemoryRepository();
vi.mock('$lib/db/repository', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/db/repository')>();
	return { ...actual, createRemoteRepository: () => memoryRepo };
});

// Real domain logic, bypassing each barrel's UI/Svelte exports so this pure
// data-layer test doesn't transitively load .svelte files (same technique as
// kitchen.remote.test.ts).
vi.mock('$lib/features/operations', async () => {
	const domain = await import('../../operations/domain/operations');
	const lotPriority = await import('../../operations/domain/lot-priority');
	const deterministic = await import('../../operations/domain/deterministic-ledger-id');
	return {
		createStockLedger: domain.createStockLedger,
		stockBalance: domain.stockBalance,
		isStockLedger: domain.isStockLedger,
		projectStockLotBalances: domain.projectStockLotBalances,
		isLotExpired: lotPriority.isLotExpired,
		toLotPriorityItems: lotPriority.toLotPriorityItems,
		deriveDeterministicLedgerId: deterministic.deriveDeterministicLedgerId
	};
});
vi.mock('$lib/features/catalog', () => ({
	catalogRepository: () => ({ listItemMasters: async () => [] })
}));
vi.mock('$lib/features/distribution', async () => {
	const lots = await import('../../distribution/domain/food-supplies/dispatch-lots');
	return { validateDispatchLotAllocations: lots.validateDispatchLotAllocations };
});
vi.mock('$lib/features/kitchen', async () => {
	const kitchen = await import('../../kitchen/domain/kitchen');
	return {
		isMealPlan: kitchen.isMealPlan
	};
});

import { TicketRemoteRepository } from './ticket.remote';
import { isStockLedger, type StockLedger } from '../../operations/domain/operations';

const ctx = { shelterCode: 'SH001', createdBy: 'kitchen_staff' };
const managerCtx = { shelterCode: 'SH001', createdBy: 'shelter_manager' };
const warehouseCtx = { shelterCode: 'SH001', createdBy: 'warehouse_staff' };

let seedCounter = 0;

/** Seeds one inbound lot; returns its lot_ref (= the inbound row's own _id). */
async function seedStock(
	item_id: string,
	qty: string | number,
	unit = 'kg',
	expiry?: string
): Promise<string> {
	const id = `stock_ledger:seed-${item_id}-${++seedCounter}`;
	await memoryRepo.put({
		_id: id,
		type: 'stock_ledger',
		schema_v: 4,
		item_id,
		qty: String(qty),
		unit,
		reason: 'receive',
		ref_id: null,
		...(expiry ? { lot: { expiry } } : {}),
		shelter_code: 'SH001',
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		created_by: 'seed',
		occurred_at: new Date().toISOString()
	});
	return id;
}

function baseInput() {
	return {
		meal_plan_id: 'meal_plan:01J',
		items: [{ item_id: 'item_master:rice', item_name: 'ข้าวสาร', unit: 'kg', requested_qty: '30' }]
	};
}

let repo: TicketRemoteRepository;

beforeEach(() => {
	memoryRepo = createInMemoryRepository();
	repo = new TicketRemoteRepository('shelter_sh001');
});

describe('createTicket', () => {
	it('mints TKT-KITCHEN-0001 on the first ticket', async () => {
		const ticket = await repo.createTicket(baseInput(), ctx);
		expect(ticket.ticket_no).toBe('TKT-KITCHEN-0001');
		expect(ticket.status).toBe('PENDING_PICK');
	});

	it('continues the sequence across shelters worth of tickets', async () => {
		await repo.createTicket(baseInput(), ctx);
		const second = await repo.createTicket({ ...baseInput(), meal_plan_id: 'meal_plan:02J' }, ctx);
		expect(second.ticket_no).toBe('TKT-KITCHEN-0002');
	});

	it('is idempotent on meal_plan_id — a second call returns the same ticket', async () => {
		const first = await repo.createTicket(baseInput(), ctx);
		const second = await repo.createTicket(baseInput(), ctx);
		expect(second._id).toBe(first._id);
		const all = await repo.listTickets();
		expect(all).toHaveLength(1);
	});

	it('confirms a linked draft meal_plan (no longer freely editable/deletable once ticketed)', async () => {
		await memoryRepo.put({
			_id: 'meal_plan:01J',
			type: 'meal_plan',
			schema_v: 2,
			shelter_code: 'SH001',
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
			created_by: 'kitchen_staff',
			date: '2026-07-15',
			meal: 'lunch',
			headcount: { total: 10, halal: 0, soft_food: 0, infant: 0 },
			recipes: [{ recipe_id: 'ingredient:rice', planned_qty: 1000 }],
			status: 'draft'
		});
		await repo.createTicket(baseInput(), ctx);
		const plan = await memoryRepo.get<{ _id: string; status: string }>('meal_plan:01J');
		expect(plan?.status).toBe('confirmed');
	});

	it('allows a new ticket once the prior one for that plan was cancelled', async () => {
		const first = await repo.createTicket(baseInput(), ctx);
		await repo.cancelTicket(first, 'เปลี่ยนแผน');
		const second = await repo.createTicket(baseInput(), ctx);
		expect(second._id).not.toBe(first._id);
		const all = await repo.listTickets();
		expect(all).toHaveLength(2);
	});
});

describe('dispatchTicket (per-lot, CR-178)', () => {
	async function readyTicket() {
		const created = await repo.createTicket(baseInput(), ctx);
		const allocated = await repo.allocateTicketItem(created, 'item_master:rice', '30');
		return repo.approveTicket(allocated, managerCtx);
	}
	const ledgerRows = async () =>
		(await memoryRepo.allByType<StockLedger>('stock_ledger', isStockLedger)).filter(
			(l) => l.reason === 'requisition'
		);
	const FUTURE = '2099-01-01';
	const PAST = '2020-01-01';

	it('writes one requisition row per lot with lot_ref and moves to IN_TRANSIT', async () => {
		const lotA = await seedStock('item_master:rice', '20', 'kg', FUTURE);
		const lotB = await seedStock('item_master:rice', '50', 'kg', FUTURE);
		const dispatched = await repo.dispatchTicket(
			await readyTicket(),
			{
				'item_master:rice': [
					{ lot_ref: lotA, qty: '20' },
					{ lot_ref: lotB, qty: '10' }
				]
			},
			warehouseCtx
		);
		expect(dispatched.status).toBe('IN_TRANSIT');
		expect(dispatched.dispatched_by).toBe('warehouse_staff');
		expect((await repo.getTicketById(dispatched._id))?.status).toBe('IN_TRANSIT');

		const rows = await ledgerRows();
		expect(rows).toHaveLength(2);
		expect(rows.map((r) => [r.lot_ref, r.qty]).sort()).toEqual(
			[
				[lotA, '-20'],
				[lotB, '-10']
			].sort()
		);
		for (const row of rows) {
			expect(row.ref_id).toBe(dispatched._id);
			expect(row.item_id).toBe('item_master:rice');
		}
	});

	it('uses deterministic ids so a retry writes no duplicate rows', async () => {
		const lot = await seedStock('item_master:rice', '100', 'kg', FUTURE);
		const ticket = await readyTicket();
		const lots = { 'item_master:rice': [{ lot_ref: lot, qty: '30' }] };
		await repo.dispatchTicket(ticket, lots, warehouseCtx);
		const firstIds = (await ledgerRows()).map((r) => r._id);

		// Retry from the same (still READY_FOR_DISPATCH) ticket: e.g. the ticket write failed.
		await repo.dispatchTicket(ticket, lots, warehouseCtx);
		const rows = await ledgerRows();
		expect(rows.map((r) => r._id)).toEqual(firstIds);
		expect(rows).toHaveLength(1);
		expect(rows[0].qty).toBe('-30');
	});

	it('recovers from a ConflictError on an already-written row and still finishes the ticket', async () => {
		const lot = await seedStock('item_master:rice', '100', 'kg', FUTURE);
		const ticket = await readyTicket();
		const lots = { 'item_master:rice': [{ lot_ref: lot, qty: '30' }] };
		await repo.dispatchTicket(ticket, lots, warehouseCtx);
		const { ConflictError } = await import('$lib/utils/errors');
		const realPut = memoryRepo.put.bind(memoryRepo);
		vi.spyOn(memoryRepo, 'put').mockImplementation(async (doc) => {
			if ((doc as { type?: string }).type === 'stock_ledger') throw new ConflictError();
			return realPut(doc);
		});
		const dispatched = await repo.dispatchTicket(ticket, lots, warehouseCtx);
		expect(dispatched.status).toBe('IN_TRANSIT');
		expect(await ledgerRows()).toHaveLength(1);
	});

	it('rejects an expired lot and writes nothing', async () => {
		const lot = await seedStock('item_master:rice', '100', 'kg', PAST);
		await expect(
			repo.dispatchTicket(
				await readyTicket(),
				{ 'item_master:rice': [{ lot_ref: lot, qty: '30' }] },
				warehouseCtx
			)
		).rejects.toThrow(/หมดอายุ/);
		expect(await ledgerRows()).toHaveLength(0);
	});

	it('rejects a sum mismatch and writes nothing', async () => {
		const lot = await seedStock('item_master:rice', '100', 'kg', FUTURE);
		await expect(
			repo.dispatchTicket(
				await readyTicket(),
				{ 'item_master:rice': [{ lot_ref: lot, qty: '25' }] },
				warehouseCtx
			)
		).rejects.toThrow(/ผลรวม/);
		expect(await ledgerRows()).toHaveLength(0);
	});

	it('rejects a quantity above the lot balance and a missing selection', async () => {
		const lot = await seedStock('item_master:rice', '10', 'kg', FUTURE);
		const ticket = await readyTicket();
		await expect(
			repo.dispatchTicket(
				ticket,
				{ 'item_master:rice': [{ lot_ref: lot, qty: '30' }] },
				warehouseCtx
			)
		).rejects.toThrow(/เกินยอดคงเหลือ/);
		await expect(repo.dispatchTicket(ticket, {}, warehouseCtx)).rejects.toThrow(
			/ยังไม่ได้เลือก lot/
		);
		expect(await ledgerRows()).toHaveLength(0);
	});

	it('writes nothing for any line when one line is invalid (all-or-nothing)', async () => {
		const rice = await seedStock('item_master:rice', '100', 'kg', FUTURE);
		const salt = await seedStock('item_master:salt', '100', 'kg', PAST);
		const created = await repo.createTicket(
			{
				...baseInput(),
				items: [
					...baseInput().items,
					{ item_id: 'item_master:salt', item_name: 'เกลือ', unit: 'kg', requested_qty: '5' }
				]
			},
			ctx
		);
		const ready = await repo.approveTicketWithAllocations(
			created,
			{ 'item_master:rice': '30', 'item_master:salt': '5' },
			managerCtx
		);
		await expect(
			repo.dispatchTicket(
				ready,
				{
					'item_master:rice': [{ lot_ref: rice, qty: '30' }],
					'item_master:salt': [{ lot_ref: salt, qty: '5' }]
				},
				warehouseCtx
			)
		).rejects.toThrow(/เกลือ/);
		expect(await ledgerRows()).toHaveLength(0);
		expect((await repo.getTicketById(ready._id))?.status).toBe('READY_FOR_DISPATCH');
	});
});

describe('dispatchTicket with zero-allocated lines', () => {
	async function mixedReadyTicket() {
		const created = await repo.createTicket(
			{
				...baseInput(),
				items: [
					...baseInput().items,
					{ item_id: 'item_master:salt', item_name: 'เกลือ', unit: 'kg', requested_qty: '5' }
				]
			},
			ctx
		);
		return repo.approveTicketWithAllocations(
			created,
			{ 'item_master:rice': '30', 'item_master:salt': '0' },
			managerCtx
		);
	}

	it('skips 0 lines: no lot needed and no stock_ledger row for them', async () => {
		const lot = await seedStock('item_master:rice', '100', 'kg', '2099-01-01'); // salt has no stock at all
		const dispatched = await repo.dispatchTicket(
			await mixedReadyTicket(),
			{ 'item_master:rice': [{ lot_ref: lot, qty: '30' }] },
			warehouseCtx
		);
		expect(dispatched.status).toBe('IN_TRANSIT');
		const ledger = await memoryRepo.allByType<StockLedger>('stock_ledger', isStockLedger);
		const rows = ledger.filter((l) => l.reason === 'requisition');
		expect(rows).toHaveLength(1);
		expect(rows[0].item_id).toBe('item_master:rice');
		expect(rows[0].qty).toBe('-30');
		expect(rows[0].lot_ref).toBe(lot);
	});
});

describe('receiveTicket', () => {
	it('moves IN_TRANSIT → COMPLETED and rejects a double-receive', async () => {
		const lot = await seedStock('item_master:rice', '100', 'kg', '2099-01-01');
		const created = await repo.createTicket(baseInput(), ctx);
		const allocated = await repo.allocateTicketItem(created, 'item_master:rice', '30');
		const approved = await repo.approveTicket(allocated, managerCtx);
		const dispatched = await repo.dispatchTicket(
			approved,
			{ 'item_master:rice': [{ lot_ref: lot, qty: '30' }] },
			warehouseCtx
		);

		const received = await repo.receiveTicket(dispatched, ctx);
		expect(received.status).toBe('COMPLETED');
		expect(received.received_by).toBe('kitchen_staff');

		await expect(repo.receiveTicket(received, ctx)).rejects.toThrow(/ticket is COMPLETED/);
	});
});

describe('TicketRemoteRepository.approveTicketWithAllocations', () => {
	it('saves allocations and approves with a single write', async () => {
		const created = await repo.createTicket(baseInput(), ctx);
		const putSpy = vi.spyOn(memoryRepo, 'put');
		const approved = await repo.approveTicketWithAllocations(
			created,
			{ 'item_master:rice': '20' },
			managerCtx
		);
		expect(putSpy).toHaveBeenCalledTimes(1);
		expect(approved.status).toBe('READY_FOR_DISPATCH');
		expect(approved.items[0].allocated_qty).toBe('20');
		const stored = await repo.getTicketById(created._id);
		expect(stored?.status).toBe('READY_FOR_DISPATCH');
		expect(stored?.items[0].allocated_qty).toBe('20');
	});

	it('approves when some lines are 0 but at least one is > 0', async () => {
		const created = await repo.createTicket(
			{
				...baseInput(),
				items: [
					...baseInput().items,
					{ item_id: 'item_master:salt', item_name: 'เกลือ', unit: 'kg', requested_qty: '5' }
				]
			},
			ctx
		);
		const approved = await repo.approveTicketWithAllocations(
			created,
			{ 'item_master:rice': '20', 'item_master:salt': '0' },
			managerCtx
		);
		expect(approved.status).toBe('READY_FOR_DISPATCH');
		expect(approved.items.map((i) => i.allocated_qty)).toEqual(['20', '0']);
	});

	it('throws and writes nothing when every allocation is 0', async () => {
		const created = await repo.createTicket(baseInput(), ctx);
		await expect(
			repo.approveTicketWithAllocations(created, { 'item_master:rice': '0' }, managerCtx)
		).rejects.toThrow(/at least one item must have allocated_qty > 0/);
		expect((await repo.getTicketById(created._id))?.status).toBe('PENDING_PICK');
	});
});
