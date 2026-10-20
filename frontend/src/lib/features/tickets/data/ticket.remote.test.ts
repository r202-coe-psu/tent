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

// dispatchTicket writes the ticket + stock_ledger via bulkDocs,
// which bypasses the Repository abstraction — route it through the same
// in-memory store so those rows are readable via repo.get/allByType.
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

// Real domain logic, bypassing each barrel's UI/Svelte exports so this pure
// data-layer test doesn't transitively load .svelte files (same technique as
// kitchen.remote.test.ts).
vi.mock('$lib/features/operations', async () => {
	const domain = await import('../../operations/domain/operations');
	return {
		createStockLedger: domain.createStockLedger,
		stockBalance: domain.stockBalance,
		isStockLedger: domain.isStockLedger
	};
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

async function seedStock(item_id: string, qty: string | number, unit = 'kg') {
	await memoryRepo.put({
		_id: `stock_ledger:seed-${item_id}-${Math.random().toString(36).slice(2)}`,
		type: 'stock_ledger',
		schema_v: 4,
		item_id,
		qty: String(qty),
		unit,
		reason: 'receive',
		ref_id: null,
		shelter_code: 'SH001',
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		created_by: 'seed',
		occurred_at: new Date().toISOString()
	});
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

describe('dispatchTicket', () => {
	async function readyTicket() {
		const created = await repo.createTicket(baseInput(), ctx);
		const allocated = await repo.allocateTicketItem(created, 'item_master:rice', '30');
		return repo.approveTicket(allocated, managerCtx);
	}

	it('writes stock_ledger rows and transitions to IN_TRANSIT when stock is sufficient', async () => {
		await seedStock('item_master:rice', '100');
		const dispatched = await repo.dispatchTicket(await readyTicket(), warehouseCtx);
		expect(dispatched.status).toBe('IN_TRANSIT');
		expect(dispatched.dispatched_by).toBe('warehouse_staff');

		const ledger = await memoryRepo.allByType<StockLedger>('stock_ledger', isStockLedger);
		const requisitionRows = ledger.filter((l) => l.reason === 'requisition');
		expect(requisitionRows).toHaveLength(1);
		expect(requisitionRows[0].qty).toBe('-30');
		expect(requisitionRows[0].ref_id).toBe(dispatched._id);
	});

	it('throws and writes nothing when stock is insufficient (all-or-nothing)', async () => {
		await seedStock('item_master:rice', '10'); // less than the 30 allocated
		await expect(repo.dispatchTicket(await readyTicket(), warehouseCtx)).rejects.toThrow(
			/only 10 on hand/
		);
		const ledger = await memoryRepo.allByType<StockLedger>('stock_ledger', isStockLedger);
		expect(ledger.filter((l) => l.reason === 'requisition')).toHaveLength(0);
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

	it('skips 0 lines: no stock check and no stock_ledger row for them', async () => {
		await seedStock('item_master:rice', '100'); // salt has no stock at all
		const dispatched = await repo.dispatchTicket(await mixedReadyTicket(), warehouseCtx);
		expect(dispatched.status).toBe('IN_TRANSIT');
		const ledger = await memoryRepo.allByType<StockLedger>('stock_ledger', isStockLedger);
		const rows = ledger.filter((l) => l.reason === 'requisition');
		expect(rows).toHaveLength(1);
		expect(rows[0].item_id).toBe('item_master:rice');
		expect(rows[0].qty).toBe('-30');
	});
});

describe('receiveTicket', () => {
	it('moves IN_TRANSIT → COMPLETED and rejects a double-receive', async () => {
		await seedStock('item_master:rice', '100');
		const created = await repo.createTicket(baseInput(), ctx);
		const allocated = await repo.allocateTicketItem(created, 'item_master:rice', '30');
		const approved = await repo.approveTicket(allocated, managerCtx);
		const dispatched = await repo.dispatchTicket(approved, warehouseCtx);

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
