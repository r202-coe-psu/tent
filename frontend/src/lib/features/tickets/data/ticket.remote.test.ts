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

// dispatchTicket writes the ticket + stock_ledger + gas_ledger via bulkDocs,
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
	const gasLedger = await import('../../kitchen/domain/gas-ledger');
	const kitchen = await import('../../kitchen/domain/kitchen');
	return {
		createGasLedgerEntry: gasLedger.createGasLedgerEntry,
		isGasLedgerEntry: gasLedger.isGasLedgerEntry,
		gasCylinderBalance: gasLedger.gasCylinderBalance,
		isFuelCylinder: kitchen.isFuelCylinder,
		isMealPlan: kitchen.isMealPlan
	};
});

import { TicketRemoteRepository } from './ticket.remote';
import { isStockLedger, type StockLedger } from '../../operations/domain/operations';
import { isGasLedgerEntry, type GasLedgerEntry } from '../../kitchen/domain/gas-ledger';

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

async function seedFuelCylinder(id: string, capacityKg: string) {
	await memoryRepo.put({
		_id: id,
		type: 'fuel_cylinder',
		schema_v: 1,
		item_master_id: 'item_master:lpg_15kg',
		cylinder_code: 'LPG-01',
		name: 'ถังทดสอบ',
		capacity_kg: capacityKg,
		burn_rate_kg_per_hour: '0.5',
		time_multiplier: '1',
		shelter_code: 'SH001',
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		created_by: 'seed'
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

	it('skips gas drawdown and gas ledger while LPG dispatch is paused', async () => {
		await seedStock('item_master:rice', '100');
		await seedFuelCylinder('fuel_cylinder:01J', '15');
		const created = await repo.createTicket(
			{ ...baseInput(), gas_drawdown: [{ cylinder_id: 'fuel_cylinder:01J', qty_kg: '2' }] },
			ctx
		);
		const allocated = await repo.allocateTicketItem(created, 'item_master:rice', '30');
		const approved = await repo.approveTicket(allocated, managerCtx);

		const dispatched = await repo.dispatchTicket(approved, warehouseCtx);
		expect(dispatched.status).toBe('IN_TRANSIT');
		expect(dispatched.gas_drawdown).toEqual([]);

		const gasLedger = await memoryRepo.allByType<GasLedgerEntry>('gas_ledger', isGasLedgerEntry);
		expect(gasLedger).toHaveLength(0);
	});

	it('dispatches even when gas drawdown exceeds cylinder balance', async () => {
		await seedStock('item_master:rice', '100');
		await seedFuelCylinder('fuel_cylinder:01J', '1'); // less than the 2 kg drawn
		const created = await repo.createTicket(
			{ ...baseInput(), gas_drawdown: [{ cylinder_id: 'fuel_cylinder:01J', qty_kg: '2' }] },
			ctx
		);
		const allocated = await repo.allocateTicketItem(created, 'item_master:rice', '30');
		const approved = await repo.approveTicket(allocated, managerCtx);

		const dispatched = await repo.dispatchTicket(approved, warehouseCtx);
		expect(dispatched.status).toBe('IN_TRANSIT');
		expect(dispatched.gas_drawdown).toEqual([]);
		const ledger = await memoryRepo.allByType<StockLedger>('stock_ledger', isStockLedger);
		expect(ledger.filter((l) => l.reason === 'requisition')).toHaveLength(1);
	});
});

describe('oneStepApproveTicket', () => {
	it('auto-allocates to requested_qty, writes stock_ledger, and jumps PENDING_PICK → COMPLETED', async () => {
		await seedStock('item_master:rice', '100');
		const created = await repo.createTicket(baseInput(), ctx);
		const completed = await repo.oneStepApproveTicket(created, managerCtx);

		expect(completed.status).toBe('COMPLETED');
		expect(completed.approved_by).toBe('shelter_manager');
		expect(completed.dispatched_by).toBe('shelter_manager');
		expect(completed.received_by).toBe('shelter_manager');
		expect(completed.items[0].allocated_qty).toBe('30');

		const ledger = await memoryRepo.allByType<StockLedger>('stock_ledger', isStockLedger);
		const requisitionRows = ledger.filter((l) => l.reason === 'requisition');
		expect(requisitionRows).toHaveLength(1);
		expect(requisitionRows[0].qty).toBe('-30');
		expect(requisitionRows[0].ref_id).toBe(completed._id);
	});

	it('throws and writes nothing when stock is insufficient (all-or-nothing)', async () => {
		await seedStock('item_master:rice', '10'); // less than the 30 requested
		const created = await repo.createTicket(baseInput(), ctx);
		await expect(repo.oneStepApproveTicket(created, managerCtx)).rejects.toThrow(/only 10 on hand/);
		const ledger = await memoryRepo.allByType<StockLedger>('stock_ledger', isStockLedger);
		expect(ledger.filter((l) => l.reason === 'requisition')).toHaveLength(0);
		const reloaded = await repo.getTicketById(created._id);
		expect(reloaded?.status).toBe('PENDING_PICK');
	});

	it('rejects a ticket that already moved past PENDING_PICK', async () => {
		await seedStock('item_master:rice', '100');
		const created = await repo.createTicket(baseInput(), ctx);
		const completed = await repo.oneStepApproveTicket(created, managerCtx);
		await expect(repo.oneStepApproveTicket(completed, managerCtx)).rejects.toThrow(
			/ticket is COMPLETED/
		);
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
