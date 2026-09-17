import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AuthorContext } from '$lib/db/model';
import type {
	BulkReturnPool,
	BulkReturnPoolInput,
	DistributionLog,
	DistributionLogInput
} from '../../domain/food-supplies';
import {
	createBulkReturnPool as createBulkReturnPoolDoc,
	createDistributionLog
} from '../../domain/food-supplies';
import type {
	BulkReturnPoolRepository,
	DistributionLogRepository,
	RecordReturnInput,
	RecordClearInput
} from '../../data/food-supplies';
import type { OperationsRepository, StockLedger } from '$lib/features/operations';
import { StockIntegrityError } from './errors';
import {
	clearLoanNonPhysical,
	clearLoanViaBulkPool,
	createBulkReturnPool,
	returnLoanAtCounter
} from './return-workflow';

class InMemoryLogRepository implements DistributionLogRepository {
	logs = new Map<string, DistributionLog>();

	async create(
		input: DistributionLogInput | DistributionLog,
		ctx: AuthorContext
	): Promise<DistributionLog> {
		if ('_id' in input && input.type === 'distribution_log') {
			this.logs.set(input._id, input);
			return input;
		}
		const doc = createDistributionLog(input as DistributionLogInput, ctx);
		this.logs.set(doc._id, doc);
		return doc;
	}

	async get(logId: string): Promise<DistributionLog | null> {
		return this.logs.get(logId) ?? null;
	}

	async list(): Promise<DistributionLog[]> {
		return Array.from(this.logs.values());
	}

	async mutateLogCAS(
		logId: string,
		mutator: (current: DistributionLog) => DistributionLog
	): Promise<DistributionLog> {
		const current = this.logs.get(logId);
		if (!current) throw new Error('Not found');
		const updated = mutator(current);
		this.logs.set(logId, updated);
		return updated;
	}

	async recordReturn(
		logId: string,
		input: RecordReturnInput,
		ctx: AuthorContext
	): Promise<DistributionLog> {
		return this.mutateLogCAS(logId, (l) => ({
			...l,
			status: input.qty_returned === l.qty ? 'returned' : 'partially_returned',
			qty_returned: input.qty_returned,
			clear_reason: input.clear_reason,
			condition_on_return: input.condition_on_return,
			bulk_pool_id: input.bulk_pool_id,
			returned_at: new Date().toISOString(),
			returned_by: ctx.createdBy
		}));
	}

	async recordClear(
		logId: string,
		input: RecordClearInput,
		ctx: AuthorContext
	): Promise<DistributionLog> {
		return this.mutateLogCAS(logId, (l) => ({
			...l,
			status: input.clear_reason,
			clear_reason: input.clear_reason,
			returned_at: new Date().toISOString(),
			returned_by: ctx.createdBy,
			notes: input.notes
		}));
	}

	async recordVoid(logId: string, ctx: AuthorContext, notes?: string): Promise<DistributionLog> {
		return this.mutateLogCAS(logId, (l) => ({
			...l,
			status: 'voided',
			voided_at: new Date().toISOString(),
			voided_by: ctx.createdBy,
			notes
		}));
	}
}

class InMemoryOperationsRepository implements Partial<OperationsRepository> {
	ledger: StockLedger[] = [];

	async addLedgerEntry(entry: StockLedger): Promise<StockLedger> {
		this.ledger.push(entry);
		return entry;
	}

	async listLedger(): Promise<StockLedger[]> {
		return [...this.ledger];
	}
}

class InMemoryPoolRepository implements BulkReturnPoolRepository {
	pools = new Map<string, BulkReturnPool>();

	async create(
		input: BulkReturnPoolInput | BulkReturnPool,
		ctx: AuthorContext
	): Promise<BulkReturnPool> {
		if ('_id' in input && input.type === 'bulk_return_pool') {
			this.pools.set(input._id, input);
			return input;
		}
		const doc = createBulkReturnPoolDoc(input as BulkReturnPoolInput, ctx);
		this.pools.set(doc._id, doc);
		return doc;
	}

	async get(poolId: string): Promise<BulkReturnPool | null> {
		return this.pools.get(poolId) ?? null;
	}

	async list(): Promise<BulkReturnPool[]> {
		return Array.from(this.pools.values());
	}

	async claimQuota(
		poolId: string,
		qtyToClaim: string,
		_ctx?: AuthorContext
	): Promise<BulkReturnPool> {
		void _ctx;
		const current = this.pools.get(poolId);
		if (!current) throw new Error('Pool not found');
		const numClaim = parseInt(qtyToClaim, 10);
		const currentUnclaimed = parseInt(current.unclaimed_quota, 10);
		if (currentUnclaimed < numClaim) throw new Error('Quota exhausted');
		const currentClaimed = parseInt(current.claimed_qty, 10);

		const updated: BulkReturnPool = {
			...current,
			claimed_qty: String(currentClaimed + numClaim),
			unclaimed_quota: String(currentUnclaimed - numClaim),
			status: currentUnclaimed - numClaim === 0 ? 'CLOSED' : 'ACTIVE',
			updated_at: new Date().toISOString()
		};
		this.pools.set(poolId, updated);
		return updated;
	}

	async closePool(poolId: string, ctx: AuthorContext): Promise<BulkReturnPool> {
		const current = this.pools.get(poolId);
		if (!current) throw new Error('Pool not found');
		const updated: BulkReturnPool = {
			...current,
			status: 'CLOSED',
			closed_at: new Date().toISOString(),
			closed_by: ctx.createdBy,
			updated_at: new Date().toISOString()
		};
		this.pools.set(poolId, updated);
		return updated;
	}
}

describe('return-workflow', () => {
	let logRepo: InMemoryLogRepository;
	let opsRepo: InMemoryOperationsRepository;
	let poolRepo: InMemoryPoolRepository;
	const POS_CTX: AuthorContext = {
		shelterCode: 'SH001',
		createdBy: 'pos_user',
		roles: ['shelter:SH001', 'registration_staff']
	};

	beforeEach(() => {
		logRepo = new InMemoryLogRepository();
		opsRepo = new InMemoryOperationsRepository();
		poolRepo = new InMemoryPoolRepository();
	});

	it('handles counter loan return with inbound stock ledger entry', async () => {
		const log = await logRepo.create(
			{
				ticket_id: 'requisition_ticket:01J00000000000000000000001',
				item_id: 'item:fan',
				qty: '2',
				recipient_type: 'evacuee',
				recipient_id: 'evacuee:01J00000000000000000000001',
				is_returnable: true,
				status: 'active',
				is_override: false
			},
			POS_CTX
		);

		const result = await returnLoanAtCounter(
			log._id,
			{ qty_returned: '2', condition_on_return: 'READY', notes: 'Returned in good condition' },
			POS_CTX,
			{ logRepo, operationsRepo: opsRepo as unknown as OperationsRepository, poolRepo }
		);

		expect(result.log.status).toBe('returned');
		expect(result.ledgerEntryCreated).toBe(true);
		expect(opsRepo.ledger).toHaveLength(1);

		const ledgerEntry = opsRepo.ledger[0];
		expect(ledgerEntry.reason).toBe('receive');
		expect(ledgerEntry.ref_id).toBe(log._id);
		expect(ledgerEntry.qty).toBe('2');
	});

	it('does not duplicate inbound stock ledger entry on counter return retry', async () => {
		const log = await logRepo.create(
			{
				ticket_id: 'requisition_ticket:01J00000000000000000000001',
				item_id: 'item:fan',
				qty: '1',
				recipient_type: 'evacuee',
				recipient_id: 'evacuee:01J00000000000000000000001',
				is_returnable: true,
				status: 'active',
				is_override: false
			},
			POS_CTX
		);

		// First return
		await returnLoanAtCounter(log._id, { qty_returned: '1' }, POS_CTX, {
			logRepo,
			operationsRepo: opsRepo as unknown as OperationsRepository,
			poolRepo
		});
		expect(opsRepo.ledger).toHaveLength(1);

		// Retry
		const retry = await returnLoanAtCounter(log._id, { qty_returned: '1' }, POS_CTX, {
			logRepo,
			operationsRepo: opsRepo as unknown as OperationsRepository,
			poolRepo
		});
		expect(retry.ledgerEntryCreated).toBe(false);
		expect(opsRepo.ledger).toHaveLength(1);
	});

	it('recovers safely without duplicate stock when crash occurs after ledger write but before recordReturn', async () => {
		const log = await logRepo.create(
			{
				ticket_id: 'requisition_ticket:01J00000000000000000000001',
				item_id: 'item:fan',
				qty: '2',
				recipient_type: 'evacuee',
				recipient_id: 'evacuee:01J00000000000000000000001',
				is_returnable: true,
				status: 'active',
				is_override: false
			},
			POS_CTX
		);

		// Simulate partial failure: ledger was written, but crash happened before recordReturn updated the log
		opsRepo.ledger.push({
			_id: 'stock_ledger:01JPREVIOUSRECEIPT0000000000',
			type: 'stock_ledger',
			schema_v: 4,
			shelter_code: POS_CTX.shelterCode,
			item_id: 'item:fan',
			qty: '2',
			unit: 'ชิ้น',
			reason: 'receive',
			ref_id: log._id,
			lot_ref: 'stock_ledger:01JPREVIOUSRECEIPT0000000000',
			occurred_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
			created_by: POS_CTX.createdBy
		});
		expect(opsRepo.ledger).toHaveLength(1);
		expect(log.status).toBe('active'); // Still active in DB

		// Retry return operation
		const retryResult = await returnLoanAtCounter(log._id, { qty_returned: '2' }, POS_CTX, {
			logRepo,
			operationsRepo: opsRepo as unknown as OperationsRepository,
			poolRepo
		});

		expect(retryResult.ledgerEntryCreated).toBe(false); // Did NOT create duplicate stock entry
		expect(opsRepo.ledger).toHaveLength(1); // Exact single entry preserved
		expect(retryResult.log.status).toBe('returned'); // Successfully converged to returned
		expect(retryResult.log.qty_returned).toBe('2');
	});

	it('does not mark log returned when ledger write fails', async () => {
		const log = await logRepo.create(
			{
				ticket_id: 'requisition_ticket:01J00000000000000000000001',
				item_id: 'item:fan',
				qty: '2',
				recipient_type: 'evacuee',
				recipient_id: 'evacuee:01J00000000000000000000001',
				is_returnable: true,
				status: 'active',
				is_override: false
			},
			POS_CTX
		);

		const failingOpsRepo = {
			...opsRepo,
			addLedgerEntry: async () => {
				throw new Error('Database disk error');
			},
			listLedger: async () => []
		} as unknown as OperationsRepository;

		await expect(
			returnLoanAtCounter(log._id, { qty_returned: '2' }, POS_CTX, {
				logRepo,
				operationsRepo: failingOpsRepo,
				poolRepo
			})
		).rejects.toThrow('Database disk error');

		const fetchedLog = await logRepo.get(log._id);
		expect(fetchedLog?.status).toBe('active'); // Log remained unmutated
	});

	it('prevalidates domain state and rejects before creating any inventory receipt', async () => {
		const log = await logRepo.create(
			{
				ticket_id: 'requisition_ticket:01J00000000000000000000001',
				item_id: 'item:fan',
				qty: '2',
				recipient_type: 'evacuee',
				recipient_id: 'evacuee:01J00000000000000000000001',
				is_returnable: true,
				status: 'active',
				is_override: false
			},
			POS_CTX
		);

		// Attempt to return 5 items on a loan of 2 items
		await expect(
			returnLoanAtCounter(log._id, { qty_returned: '5' }, POS_CTX, {
				logRepo,
				operationsRepo: opsRepo as unknown as OperationsRepository,
				poolRepo
			})
		).rejects.toThrow(/cannot exceed issued qty/);

		expect(opsRepo.ledger).toHaveLength(0); // Zero stock ledger side effect
	});

	it('handles multiple partial returns correctly with delta stock tracking', async () => {
		const log = await logRepo.create(
			{
				ticket_id: 'requisition_ticket:01J00000000000000000000001',
				item_id: 'item:blanket',
				qty: '5',
				recipient_type: 'evacuee',
				recipient_id: 'evacuee:01J00000000000000000000001',
				is_returnable: true,
				status: 'active',
				is_override: false
			},
			POS_CTX
		);

		// Partial return 1: 2 items returned
		const res1 = await returnLoanAtCounter(log._id, { qty_returned: '2' }, POS_CTX, {
			logRepo,
			operationsRepo: opsRepo as unknown as OperationsRepository,
			poolRepo
		});
		expect(res1.ledgerEntryCreated).toBe(true);
		expect(res1.log.status).toBe('partially_returned');
		expect(res1.log.qty_returned).toBe('2');
		expect(opsRepo.ledger).toHaveLength(1);
		expect(opsRepo.ledger[0].qty).toBe('2');

		// Partial return 2: 2 more items returned (cumulative 4)
		const res2 = await returnLoanAtCounter(log._id, { qty_returned: '4' }, POS_CTX, {
			logRepo,
			operationsRepo: opsRepo as unknown as OperationsRepository,
			poolRepo
		});
		expect(res2.ledgerEntryCreated).toBe(true);
		expect(res2.log.status).toBe('partially_returned');
		expect(res2.log.qty_returned).toBe('4');
		expect(opsRepo.ledger).toHaveLength(2);
		expect(opsRepo.ledger[1].qty).toBe('2'); // Delta was 2

		// Final return 3: remaining 1 item returned (cumulative 5)
		const res3 = await returnLoanAtCounter(log._id, { qty_returned: '5' }, POS_CTX, {
			logRepo,
			operationsRepo: opsRepo as unknown as OperationsRepository,
			poolRepo
		});
		expect(res3.ledgerEntryCreated).toBe(true);
		expect(res3.log.status).toBe('returned');
		expect(res3.log.qty_returned).toBe('5');
		expect(opsRepo.ledger).toHaveLength(3);
		expect(opsRepo.ledger[2].qty).toBe('1'); // Delta was 1

		// Total stock received across the 3 returns: 2 + 2 + 1 = 5
		const totalStock = opsRepo.ledger.reduce((acc, l) => acc + parseInt(l.qty, 10), 0);
		expect(totalStock).toBe(5);
	});

	it('throws StockIntegrityError and prevents mutation when target is less than physical stock already credited', async () => {
		// Scenario: issued 5, log has returned 2, but ledger already has 2 + 2 = 4 credited
		const initial = await logRepo.create(
			{
				ticket_id: 'requisition_ticket:01J00000000000000000000001',
				item_id: 'item:blanket',
				qty: '5',
				recipient_type: 'evacuee',
				recipient_id: 'evacuee:01J00000000000000000000001',
				is_returnable: true,
				status: 'active',
				is_override: false
			},
			POS_CTX
		);
		const log = await logRepo.recordReturn(
			initial._id,
			{ qty_returned: '2', clear_reason: 'routine' },
			POS_CTX
		);
		expect(log.status).toBe('partially_returned');
		expect(log.qty_returned).toBe('2');

		opsRepo.ledger.push(
			{
				_id: 'stock_ledger:01JLEDGER0000000000000001',
				type: 'stock_ledger',
				schema_v: 4,
				shelter_code: POS_CTX.shelterCode,
				item_id: 'item:blanket',
				qty: '2',
				unit: 'ชิ้น',
				reason: 'receive',
				ref_id: log._id,
				occurred_at: new Date().toISOString(),
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				created_by: POS_CTX.createdBy
			},
			{
				_id: 'stock_ledger:01JLEDGER0000000000000002',
				type: 'stock_ledger',
				schema_v: 4,
				shelter_code: POS_CTX.shelterCode,
				item_id: 'item:blanket',
				qty: '2',
				unit: 'ชิ้น',
				reason: 'receive',
				ref_id: log._id,
				occurred_at: new Date().toISOString(),
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				created_by: POS_CTX.createdBy
			}
		);

		expect(opsRepo.ledger).toHaveLength(2); // totalPreviouslyReceived = 4

		const recordReturnSpy = vi.spyOn(logRepo, 'recordReturn');
		const mutateLogSpy = vi.spyOn(logRepo, 'mutateLogCAS');

		// Caller requests target qty_returned = 3 (which is < 4)
		await expect(
			returnLoanAtCounter(log._id, { qty_returned: '3' }, POS_CTX, {
				logRepo,
				operationsRepo: opsRepo as unknown as OperationsRepository,
				poolRepo
			})
		).rejects.toThrow(StockIntegrityError);

		// Verify NO side effects
		expect(opsRepo.ledger).toHaveLength(2); // Zero new ledger entries
		expect(recordReturnSpy).not.toHaveBeenCalled();
		expect(mutateLogSpy).not.toHaveBeenCalled();

		const untouchedLog = await logRepo.get(log._id);
		expect(untouchedLog?.status).toBe('partially_returned');
		expect(untouchedLog?.qty_returned).toBe('2');
	});

	it('safely recovers when target equals physical ledger total (equality case)', async () => {
		// Scenario: physical ledger total = 4, log qty_returned = 2, caller target = 4
		const initial = await logRepo.create(
			{
				ticket_id: 'requisition_ticket:01J00000000000000000000001',
				item_id: 'item:blanket',
				qty: '5',
				recipient_type: 'evacuee',
				recipient_id: 'evacuee:01J00000000000000000000001',
				is_returnable: true,
				status: 'active',
				is_override: false
			},
			POS_CTX
		);
		const log = await logRepo.recordReturn(
			initial._id,
			{ qty_returned: '2', clear_reason: 'routine' },
			POS_CTX
		);

		opsRepo.ledger.push(
			{
				_id: 'stock_ledger:01JLEDGER0000000000000001',
				type: 'stock_ledger',
				schema_v: 4,
				shelter_code: POS_CTX.shelterCode,
				item_id: 'item:blanket',
				qty: '2',
				unit: 'ชิ้น',
				reason: 'receive',
				ref_id: log._id,
				occurred_at: new Date().toISOString(),
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				created_by: POS_CTX.createdBy
			},
			{
				_id: 'stock_ledger:01JLEDGER0000000000000002',
				type: 'stock_ledger',
				schema_v: 4,
				shelter_code: POS_CTX.shelterCode,
				item_id: 'item:blanket',
				qty: '2',
				unit: 'ชิ้น',
				reason: 'receive',
				ref_id: log._id,
				occurred_at: new Date().toISOString(),
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				created_by: POS_CTX.createdBy
			}
		);

		const result = await returnLoanAtCounter(log._id, { qty_returned: '4' }, POS_CTX, {
			logRepo,
			operationsRepo: opsRepo as unknown as OperationsRepository,
			poolRepo
		});

		expect(result.ledgerEntryCreated).toBe(false); // No duplicate ledger row
		expect(opsRepo.ledger).toHaveLength(2);
		expect(result.log.qty_returned).toBe('4');
		expect(result.log.status).toBe('partially_returned');
	});

	it('correctly creates delta ledger entry when target is greater than physical ledger total', async () => {
		// Scenario: physical ledger total = 2, log qty_returned = 2, caller target = 4
		const initial = await logRepo.create(
			{
				ticket_id: 'requisition_ticket:01J00000000000000000000001',
				item_id: 'item:blanket',
				qty: '5',
				recipient_type: 'evacuee',
				recipient_id: 'evacuee:01J00000000000000000000001',
				is_returnable: true,
				status: 'active',
				is_override: false
			},
			POS_CTX
		);
		const log = await logRepo.recordReturn(
			initial._id,
			{ qty_returned: '2', clear_reason: 'routine' },
			POS_CTX
		);

		opsRepo.ledger.push({
			_id: 'stock_ledger:01JLEDGER0000000000000001',
			type: 'stock_ledger',
			schema_v: 4,
			shelter_code: POS_CTX.shelterCode,
			item_id: 'item:blanket',
			qty: '2',
			unit: 'ชิ้น',
			reason: 'receive',
			ref_id: log._id,
			occurred_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
			created_by: POS_CTX.createdBy
		});

		const result = await returnLoanAtCounter(log._id, { qty_returned: '4' }, POS_CTX, {
			logRepo,
			operationsRepo: opsRepo as unknown as OperationsRepository,
			poolRepo
		});

		expect(result.ledgerEntryCreated).toBe(true);
		expect(opsRepo.ledger).toHaveLength(2);
		expect(opsRepo.ledger[1].qty).toBe('2'); // Delta of 4 - 2 = 2
		expect(result.log.qty_returned).toBe('4');
		expect(result.log.status).toBe('partially_returned');
	});

	it('clears lost loan with notes and produces NO inbound stock ledger', async () => {
		const log = await logRepo.create(
			{
				ticket_id: 'requisition_ticket:01J00000000000000000000001',
				item_id: 'item:blanket',
				qty: '1',
				recipient_type: 'evacuee',
				recipient_id: 'evacuee:01J00000000000000000000001',
				is_returnable: true,
				status: 'active',
				is_override: false
			},
			POS_CTX
		);

		const cleared = await clearLoanNonPhysical(
			log._id,
			{ clear_reason: 'lost', notes: 'Lost during river surge evacuation' },
			POS_CTX,
			logRepo
		);

		expect(cleared.status).toBe('lost');
		expect(cleared.clear_reason).toBe('lost');
		expect(cleared.notes).toBe('Lost during river surge evacuation');
		expect(opsRepo.ledger).toHaveLength(0); // Zero stock ledger created!
	});

	it('clears waived loan with notes and produces NO inbound stock ledger', async () => {
		const log = await logRepo.create(
			{
				ticket_id: 'requisition_ticket:01J00000000000000000000001',
				item_id: 'item:crutches',
				qty: '1',
				recipient_type: 'evacuee',
				recipient_id: 'evacuee:01J00000000000000000000001',
				is_returnable: true,
				status: 'active',
				is_override: false
			},
			POS_CTX
		);

		const cleared = await clearLoanNonPhysical(
			log._id,
			{ clear_reason: 'waived', notes: 'Given permanently to injured evacuee upon departure' },
			POS_CTX,
			logRepo
		);

		expect(cleared.status).toBe('waived');
		expect(cleared.clear_reason).toBe('waived');
		expect(opsRepo.ledger).toHaveLength(0);
	});

	it('rejects non-physical clear when notes are empty', async () => {
		const log = await logRepo.create(
			{
				ticket_id: 'requisition_ticket:01J00000000000000000000001',
				item_id: 'item:crutches',
				qty: '1',
				recipient_type: 'evacuee',
				recipient_id: 'evacuee:01J00000000000000000000001',
				is_returnable: true,
				status: 'active',
				is_override: false
			},
			POS_CTX
		);

		await expect(
			clearLoanNonPhysical(log._id, { clear_reason: 'lost', notes: '   ' }, POS_CTX, logRepo)
		).rejects.toThrow(/notes are required/);
	});

	it('creates bulk return pool and credits physical inventory exactly once', async () => {
		const pool = await createBulkReturnPool(
			{
				item_id: 'item:cot',
				total_received_qty: '20',
				ticket_id: 'requisition_ticket:01J00000000000000000000001'
			},
			POS_CTX,
			{ logRepo, operationsRepo: opsRepo as unknown as OperationsRepository, poolRepo }
		);

		expect(pool.total_received_qty).toBe('20');
		expect(pool.unclaimed_quota).toBe('20');
		expect(pool.status).toBe('ACTIVE');

		// Inbound stock ledger recorded ONCE
		expect(opsRepo.ledger).toHaveLength(1);
		expect(opsRepo.ledger[0].reason).toBe('receive');
		expect(opsRepo.ledger[0].qty).toBe('20');
	});

	it('resolves loan against bulk return pool quota without duplicate stock ledger write', async () => {
		// 1. Create pool with 10 cots
		const pool = await createBulkReturnPool(
			{
				item_id: 'item:cot',
				total_received_qty: '10',
				ticket_id: 'requisition_ticket:01J00000000000000000000001'
			},
			POS_CTX,
			{ logRepo, operationsRepo: opsRepo as unknown as OperationsRepository, poolRepo }
		);
		expect(opsRepo.ledger).toHaveLength(1); // 1 physical credit

		// 2. Active loan for evacuee
		const log = await logRepo.create(
			{
				ticket_id: 'requisition_ticket:01J00000000000000000000001',
				item_id: 'item:cot',
				qty: '1',
				recipient_type: 'evacuee',
				recipient_id: 'evacuee:01J00000000000000000000001',
				is_returnable: true,
				status: 'active',
				is_override: false
			},
			POS_CTX
		);

		// 3. Clear via pool at gate
		const resolved = await clearLoanViaBulkPool(
			log._id,
			pool._id,
			'Confirmed returned in bulk pile',
			POS_CTX,
			{ logRepo, operationsRepo: opsRepo as unknown as OperationsRepository, poolRepo }
		);

		expect(resolved.log.status).toBe('returned');
		expect(resolved.log.clear_reason).toBe('bulk_dropoff');
		expect(resolved.log.bulk_pool_id).toBe(pool._id);
		expect(resolved.pool.claimed_qty).toBe('1');
		expect(resolved.pool.unclaimed_quota).toBe('9');

		// CRITICAL INVARIANT: No second stock ledger entry created!
		expect(opsRepo.ledger).toHaveLength(1);
	});
});
