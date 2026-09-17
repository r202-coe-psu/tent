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
import { ConflictError } from '$lib/utils/errors';
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
	/** If true, the next addLedgerEntry call throws ConflictError instead of persisting. */
	throwConflictOnNext = false;

	async addLedgerEntry(entry: StockLedger): Promise<StockLedger> {
		if (this.throwConflictOnNext) {
			this.throwConflictOnNext = false;
			throw new ConflictError();
		}
		const existing = this.ledger.find((candidate) => candidate._id === entry._id);
		if (existing) return existing;
		this.ledger.push(entry);
		return entry;
	}

	async getLedgerEntry(id: string): Promise<StockLedger | null> {
		return this.ledger.find((entry) => entry._id === id) ?? null;
	}

	async listLedger(): Promise<StockLedger[]> {
		return [...this.ledger];
	}
}

class InMemoryPoolRepository implements BulkReturnPoolRepository {
	pools = new Map<string, BulkReturnPool>();
	failNextCreate = false;

	async create(
		input: BulkReturnPoolInput | BulkReturnPool,
		ctx: AuthorContext
	): Promise<BulkReturnPool> {
		if (this.failNextCreate) {
			this.failNextCreate = false;
			throw new Error('simulated pool write failure');
		}
		if ('_id' in input && input.type === 'bulk_return_pool') {
			const existing = this.pools.get(input._id);
			if (existing) return existing;
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
		const operationUlid = '01J00000000000000000000002';
		const pool = await createBulkReturnPool(
			{
				operationUlid,
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
		expect(pool._id).toBe(`bulk_return_pool:${operationUlid}`);

		// Inbound stock ledger recorded ONCE
		expect(opsRepo.ledger).toHaveLength(1);
		expect(opsRepo.ledger[0].reason).toBe('receive');
		expect(opsRepo.ledger[0].qty).toBe('20');
		expect(opsRepo.ledger[0]._id).toBe(`stock_ledger:${operationUlid}`);
		expect(opsRepo.ledger[0].ref_id).toBe(pool._id);
	});

	it('recovers a ledger-only bulk pool creation without a second stock receipt', async () => {
		const input = {
			operationUlid: '01J00000000000000000000003',
			item_id: 'item:cot',
			total_received_qty: '2.5',
			ticket_id: 'requisition_ticket:01J00000000000000000000001',
			shift_id: 'shift-A'
		};
		poolRepo.failNextCreate = true;

		await expect(
			createBulkReturnPool(input, POS_CTX, {
				logRepo,
				operationsRepo: opsRepo as unknown as OperationsRepository,
				poolRepo
			})
		).rejects.toThrow('simulated pool write failure');
		expect(opsRepo.ledger).toHaveLength(1);

		const recovered = await createBulkReturnPool(input, POS_CTX, {
			logRepo,
			operationsRepo: opsRepo as unknown as OperationsRepository,
			poolRepo
		});
		expect(recovered._id).toBe('bulk_return_pool:01J00000000000000000000003');
		expect(recovered.stock_ledger_id).toBe('stock_ledger:01J00000000000000000000003');
		expect(opsRepo.ledger).toHaveLength(1);
		expect(opsRepo.ledger[0].qty).toBe('2.5');
	});

	it('returns a completed deterministic bulk pool replay without another receipt', async () => {
		const input = {
			operationUlid: '01J00000000000000000000004',
			item_id: 'item:cot',
			total_received_qty: '3',
			ticket_id: 'requisition_ticket:01J00000000000000000000001'
		};
		const first = await createBulkReturnPool(input, POS_CTX, {
			logRepo,
			operationsRepo: opsRepo as unknown as OperationsRepository,
			poolRepo
		});
		const replay = await createBulkReturnPool(input, POS_CTX, {
			logRepo,
			operationsRepo: opsRepo as unknown as OperationsRepository,
			poolRepo
		});

		expect(replay._id).toBe(first._id);
		expect(opsRepo.ledger).toHaveLength(1);
	});

	it('fails closed when a deterministic bulk-pool replay changes immutable semantics', async () => {
		const input = {
			operationUlid: '01J00000000000000000000005',
			item_id: 'item:cot',
			total_received_qty: '3'
		};
		await createBulkReturnPool(input, POS_CTX, {
			logRepo,
			operationsRepo: opsRepo as unknown as OperationsRepository,
			poolRepo
		});

		await expect(
			createBulkReturnPool({ ...input, total_received_qty: '4' }, POS_CTX, {
				logRepo,
				operationsRepo: opsRepo as unknown as OperationsRepository,
				poolRepo
			})
		).rejects.toBeInstanceOf(StockIntegrityError);
		expect(opsRepo.ledger).toHaveLength(1);
	});

	it('fails closed when a deterministic pool replay changes ticket metadata', async () => {
		const input = {
			operationUlid: '01J00000000000000000000008',
			item_id: 'item:cot',
			total_received_qty: '3',
			ticket_id: 'requisition_ticket:01J00000000000000000000001'
		};
		await createBulkReturnPool(input, POS_CTX, {
			logRepo,
			operationsRepo: opsRepo as unknown as OperationsRepository,
			poolRepo
		});

		await expect(
			createBulkReturnPool(
				{ ...input, ticket_id: 'requisition_ticket:01J00000000000000000000009' },
				POS_CTX,
				{ logRepo, operationsRepo: opsRepo as unknown as OperationsRepository, poolRepo }
			)
		).rejects.toBeInstanceOf(StockIntegrityError);
		expect(opsRepo.ledger).toHaveLength(1);
	});

	it('fails closed when an existing deterministic ledger belongs to different semantics', async () => {
		const operationUlid = '01J00000000000000000000006';
		opsRepo.ledger.push({
			_id: `stock_ledger:${operationUlid}`,
			type: 'stock_ledger',
			schema_v: 4,
			shelter_code: POS_CTX.shelterCode,
			created_at: '2026-01-01T00:00:00.000Z',
			updated_at: '2026-01-01T00:00:00.000Z',
			created_by: POS_CTX.createdBy,
			item_id: 'item:other',
			qty: '3',
			unit: 'ชิ้น',
			reason: 'receive',
			ref_id: `bulk_return_pool:${operationUlid}`,
			lot_ref: `stock_ledger:${operationUlid}`,
			lot: { note: 'bulk_return_pool' },
			occurred_at: '2026-01-01T00:00:00.000Z'
		});

		await expect(
			createBulkReturnPool(
				{ operationUlid, item_id: 'item:cot', total_received_qty: '3' },
				POS_CTX,
				{ logRepo, operationsRepo: opsRepo as unknown as OperationsRepository, poolRepo }
			)
		).rejects.toBeInstanceOf(StockIntegrityError);
		expect(poolRepo.pools).toHaveLength(0);
	});

	it('fails closed when an existing deterministic ledger belongs to another shelter', async () => {
		const operationUlid = '01J00000000000000000000009';
		opsRepo.ledger.push({
			_id: `stock_ledger:${operationUlid}`,
			type: 'stock_ledger',
			schema_v: 4,
			shelter_code: 'SH002',
			created_at: '2026-01-01T00:00:00.000Z',
			updated_at: '2026-01-01T00:00:00.000Z',
			created_by: POS_CTX.createdBy,
			item_id: 'item:cot',
			qty: '3',
			unit: 'ชิ้น',
			reason: 'receive',
			ref_id: `bulk_return_pool:${operationUlid}`,
			lot_ref: `stock_ledger:${operationUlid}`,
			lot: { note: 'bulk_return_pool' },
			occurred_at: '2026-01-01T00:00:00.000Z'
		});

		await expect(
			createBulkReturnPool(
				{ operationUlid, item_id: 'item:cot', total_received_qty: '3' },
				POS_CTX,
				{ logRepo, operationsRepo: opsRepo as unknown as OperationsRepository, poolRepo }
			)
		).rejects.toBeInstanceOf(StockIntegrityError);
	});

	it('fails closed for a pool-only state instead of fabricating its missing receipt', async () => {
		const operationUlid = '01J00000000000000000000010';
		const pool = createBulkReturnPoolDoc(
			{
				item_id: 'item:cot',
				stock_ledger_id: `stock_ledger:${operationUlid}`,
				total_received_qty: '3'
			},
			POS_CTX,
			operationUlid
		);
		poolRepo.pools.set(pool._id, pool);

		await expect(
			createBulkReturnPool(
				{ operationUlid, item_id: 'item:cot', total_received_qty: '3' },
				POS_CTX,
				{ logRepo, operationsRepo: opsRepo as unknown as OperationsRepository, poolRepo }
			)
		).rejects.toBeInstanceOf(StockIntegrityError);
		expect(opsRepo.ledger).toHaveLength(0);
	});

	it('rejects a malformed stable operation ULID before writing', async () => {
		await expect(
			createBulkReturnPool(
				{ operationUlid: 'not-a-ulid', item_id: 'item:cot', total_received_qty: '3' },
				POS_CTX,
				{ logRepo, operationsRepo: opsRepo as unknown as OperationsRepository, poolRepo }
			)
		).rejects.toThrow('operationUlid must be a valid ULID');
		expect(opsRepo.ledger).toHaveLength(0);
	});

	it('resolves loan against bulk return pool quota without duplicate stock ledger write', async () => {
		// 1. Create pool with 10 cots
		const pool = await createBulkReturnPool(
			{
				operationUlid: '01J00000000000000000000007',
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

	describe('LEDGER_ONLY recovery via ConflictError', () => {
		it('Scenario A — recovers when deterministic ledger already exists and pool is absent', async () => {
			// Pre-seed the deterministic ledger as if a previous addLedgerEntry succeeded but pool write crashed
			const operationUlid = '01J00000000000000000000011';
			const ledgerId = `stock_ledger:${operationUlid}`;
			const poolId = `bulk_return_pool:${operationUlid}`;
			const input = {
				operationUlid,
				item_id: 'item:cot',
				total_received_qty: '5',
				ticket_id: 'requisition_ticket:01J00000000000000000000001'
			};

			// Arrange: ledger already exists in DB (prior crashed write completed the ledger)
			// throwConflictOnNext makes addLedgerEntry throw ConflictError on the first call
			opsRepo.throwConflictOnNext = true;
			// The pre-seeded ledger must match what createBulkReturnPool would build
			const { createStockLedger: buildLedger } = await import('$lib/features/operations');
			const ctx = POS_CTX;
			const preSeededLedger = buildLedger(
				{
					item_id: input.item_id,
					qty: input.total_received_qty,
					unit: 'ชิ้น',
					reason: 'receive',
					ref_id: poolId,
					lot: { note: 'bulk_return_pool' },
					occurred_at: '2026-01-01T00:00:00.000Z'
				},
				ctx,
				operationUlid
			);
			opsRepo.ledger.push(preSeededLedger);

			// Act: retry with same operationUlid — LEDGER_ONLY recovery
			const recovered = await createBulkReturnPool(input, POS_CTX, {
				logRepo,
				operationsRepo: opsRepo as unknown as OperationsRepository,
				poolRepo
			});

			// Assert: pool was created, no second ledger written
			expect(recovered._id).toBe(poolId);
			expect(recovered.stock_ledger_id).toBe(ledgerId);
			expect(recovered.item_id).toBe('item:cot');
			expect(opsRepo.ledger).toHaveLength(1);
			expect(poolRepo.pools.get(poolId)).toBeDefined();
		});

		it('Scenario B — fails closed when ConflictError occurs and fetched ledger mismatches semantics', async () => {
			const operationUlid = '01J00000000000000000000012';
			const poolId = `bulk_return_pool:${operationUlid}`;

			// Pre-seed ledger with wrong item_id
			opsRepo.ledger.push({
				_id: `stock_ledger:${operationUlid}`,
				type: 'stock_ledger',
				schema_v: 4,
				shelter_code: POS_CTX.shelterCode,
				created_at: '2026-01-01T00:00:00.000Z',
				updated_at: '2026-01-01T00:00:00.000Z',
				created_by: POS_CTX.createdBy,
				item_id: 'item:blanket', // ← wrong item
				qty: '5',
				unit: 'ชิ้น',
				reason: 'receive',
				ref_id: poolId,
				lot_ref: `stock_ledger:${operationUlid}`,
				lot: { note: 'bulk_return_pool' },
				occurred_at: '2026-01-01T00:00:00.000Z'
			});
			opsRepo.throwConflictOnNext = true;

			await expect(
				createBulkReturnPool(
					{ operationUlid, item_id: 'item:cot', total_received_qty: '5' },
					POS_CTX,
					{ logRepo, operationsRepo: opsRepo as unknown as OperationsRepository, poolRepo }
				)
			).rejects.toBeInstanceOf(StockIntegrityError);

			// Pool must not be created — fail-closed
			expect(poolRepo.pools.has(poolId)).toBe(false);
			// Ledger still at 1 (pre-seeded only)
			expect(opsRepo.ledger).toHaveLength(1);
		});

		it('Scenario C — non-ConflictError from addLedgerEntry propagates without recovery attempt', async () => {
			const operationUlid = '01J00000000000000000000013';
			const networkError = new Error('network timeout');
			const originalAdd = opsRepo.addLedgerEntry.bind(opsRepo);
			opsRepo.addLedgerEntry = async () => {
				throw networkError;
			};

			await expect(
				createBulkReturnPool(
					{ operationUlid, item_id: 'item:cot', total_received_qty: '5' },
					POS_CTX,
					{ logRepo, operationsRepo: opsRepo as unknown as OperationsRepository, poolRepo }
				)
			).rejects.toBe(networkError);

			// No ledger, no pool — nothing swallowed
			expect(opsRepo.ledger).toHaveLength(0);
			expect(poolRepo.pools.has(`bulk_return_pool:${operationUlid}`)).toBe(false);

			// Restore
			opsRepo.addLedgerEntry = originalAdd;
		});
	});
});
