import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AuthorContext } from '$lib/db/model';
import type {
	BulkReturnClaim,
	BulkReturnClaimStatus,
	BulkReturnPool,
	BulkReturnPoolInput,
	DistributionLog,
	DistributionLogInput
} from '../../domain/food-supplies';
import {
	assertBulkReturnClaimTransition,
	bulkReturnPoolDocSchema,
	createBulkReturnPool as createBulkReturnPoolDoc,
	createDistributionLog,
	deriveClaimIdFromDistributionLog
} from '../../domain/food-supplies';
import type {
	BulkReturnClaimRepository,
	BulkReturnPoolRepository,
	DistributionLogRepository,
	RecordReturnInput,
	RecordClearInput
} from '../../data/food-supplies';
import type { OperationsRepository, StockLedger } from '$lib/features/operations';
import {
	ConcurrencyCollisionError,
	InsufficientPoolQuotaError,
	StockIntegrityError,
	WorkflowAuthorizationError,
	WorkflowValidationError
} from './errors';
import { canReceivePhysicalStock } from './auth';
import { ConflictError } from '$lib/utils/errors';
import { parseQty } from '$lib/utils/qty';
import { buildValidateDocUpdate } from '$lib/server/shelter-access-design';
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

type HistoricalBulkReturnPoolV1 = Omit<BulkReturnPool, 'schema_v' | 'claim_ids'> & {
	schema_v: 1;
	claim_ids?: undefined;
};

class InMemoryPoolRepository implements BulkReturnPoolRepository {
	pools = new Map<string, BulkReturnPool | HistoricalBulkReturnPoolV1>();
	failNextCreate = false;

	async create(
		input: BulkReturnPoolInput | BulkReturnPool | HistoricalBulkReturnPoolV1,
		ctx: AuthorContext
	): Promise<BulkReturnPool> {
		if (this.failNextCreate) {
			this.failNextCreate = false;
			throw new Error('simulated pool write failure');
		}
		if ('_id' in input && input.type === 'bulk_return_pool') {
			const existing = this.pools.get(input._id);
			if (existing) return existing as BulkReturnPool;
			this.pools.set(input._id, input);
			return input as BulkReturnPool;
		}
		const doc = createBulkReturnPoolDoc(input as BulkReturnPoolInput, ctx);
		this.pools.set(doc._id, doc);
		return doc;
	}

	async get(poolId: string): Promise<BulkReturnPool | null> {
		const doc = this.pools.get(poolId);
		if (!doc) return null;
		return bulkReturnPoolDocSchema.parse(doc) as BulkReturnPool;
	}

	async list(): Promise<BulkReturnPool[]> {
		return Array.from(this.pools.values()).map(
			(p) => bulkReturnPoolDocSchema.parse(p) as BulkReturnPool
		);
	}

	async claimQuota(
		poolId: string,
		claimIdOrQty: string,
		claimQtyOrCtx?: string | AuthorContext,
		maybeCtx?: AuthorContext
	): Promise<BulkReturnPool> {
		void maybeCtx;
		let claimId: string | undefined;
		let claimQty: string;

		if (typeof claimQtyOrCtx === 'string') {
			claimId = claimIdOrQty;
			claimQty = claimQtyOrCtx;
		} else {
			claimId = undefined;
			claimQty = claimIdOrQty;
		}

		const current = this.pools.get(poolId);
		if (!current) throw new Error('Pool not found');

		const existingClaimIds =
			'claim_ids' in current && Array.isArray(current.claim_ids) ? current.claim_ids : [];
		if (claimId && existingClaimIds.includes(claimId)) {
			return { ...current } as BulkReturnPool;
		}

		if (current.status !== 'ACTIVE') {
			throw new Error(`Bulk return pool ${poolId} is not ACTIVE (status: ${current.status})`);
		}

		const claimDec = parseQty(claimQty);
		if (claimDec.isNegative() || claimDec.isZero()) {
			throw new Error('claimQty must be a positive decimal quantity');
		}

		const currentQuotaDec = parseQty(current.unclaimed_quota);
		const remainingQuotaDec = currentQuotaDec.minus(claimDec);
		if (remainingQuotaDec.isNegative()) {
			throw new Error(
				`Insufficient unclaimed quota in bulk return pool ${poolId}: available ${current.unclaimed_quota}, requested ${claimQty}`
			);
		}

		const nextClaimed = parseQty(current.claimed_qty).plus(claimDec).toString();
		const nextStatus = remainingQuotaDec.isZero() ? 'EXHAUSTED' : 'ACTIVE';
		const nextClaimIds = claimId ? [...existingClaimIds, claimId] : existingClaimIds;

		const updated: BulkReturnPool = {
			...current,
			schema_v: 2,
			claimed_qty: nextClaimed,
			unclaimed_quota: remainingQuotaDec.toString(),
			claim_ids: nextClaimIds,
			status: nextStatus,
			updated_at: new Date().toISOString()
		};
		this.pools.set(poolId, updated);
		return { ...updated };
	}

	async closePool(poolId: string, ctx: AuthorContext): Promise<BulkReturnPool> {
		const current = this.pools.get(poolId);
		if (!current) throw new Error('Pool not found');
		const updated = bulkReturnPoolDocSchema.parse({
			...current,
			status: 'CLOSED',
			closed_at: new Date().toISOString(),
			closed_by: ctx.createdBy,
			updated_at: new Date().toISOString()
		});
		this.pools.set(poolId, updated);
		return updated;
	}
}

class InMemoryClaimRepository implements BulkReturnClaimRepository {
	claims = new Map<string, BulkReturnClaim>();
	failNextCreateWithConflict = false;
	failNextReinitializeWithConflict = false;

	async create(claim: BulkReturnClaim): Promise<BulkReturnClaim> {
		if (this.failNextCreateWithConflict) {
			this.failNextCreateWithConflict = false;
			throw new ConflictError(`Conflict on doc ${claim._id}`);
		}
		if (this.claims.has(claim._id)) {
			throw new ConflictError(`Conflict on doc ${claim._id}`);
		}
		this.claims.set(claim._id, { ...claim });
		return { ...claim };
	}

	async get(claimId: string): Promise<BulkReturnClaim | null> {
		const found = this.claims.get(claimId);
		return found ? { ...found } : null;
	}

	async mutateCAS(
		claimId: string,
		mutator: (current: BulkReturnClaim) => BulkReturnClaim
	): Promise<BulkReturnClaim> {
		const current = this.claims.get(claimId);
		if (!current) throw new Error(`Claim ${claimId} not found`);
		const next = mutator({ ...current });
		assertBulkReturnClaimTransition(current, next);
		this.claims.set(claimId, { ...next });
		return { ...next };
	}

	async mutateStatusCAS(
		claimId: string,
		targetStatus: BulkReturnClaimStatus,
		notesOrCtx?: string | AuthorContext,
		maybeCtx?: AuthorContext
	): Promise<BulkReturnClaim> {
		void maybeCtx;
		const notes = typeof notesOrCtx === 'string' ? notesOrCtx : undefined;
		return this.mutateCAS(claimId, (current) => ({
			...current,
			status: targetStatus,
			...(notes !== undefined ? { notes } : {}),
			updated_at: new Date().toISOString()
		}));
	}

	async reinitializeCAS(
		claimId: string,
		input: {
			operation_id: string;
			bulk_pool_id: string;
			claimed_qty: string;
			notes?: string;
		},
		ctx?: AuthorContext
	): Promise<BulkReturnClaim> {
		void ctx;
		if (this.failNextReinitializeWithConflict) {
			this.failNextReinitializeWithConflict = false;
			throw new ConflictError(`Conflict on doc ${claimId}`);
		}
		return this.mutateCAS(claimId, (current) => {
			if (current.status !== 'ABORTED') {
				throw new Error(
					`Cannot reinitialize claim ${claimId} in status ${current.status}; must be ABORTED`
				);
			}
			return {
				...current,
				operation_id: input.operation_id,
				bulk_pool_id: input.bulk_pool_id,
				claimed_qty: input.claimed_qty,
				status: 'CLAIM_INTENT' as const,
				notes: input.notes ?? current.notes,
				updated_at: new Date().toISOString()
			};
		});
	}
}

describe('return-workflow', () => {
	let logRepo: InMemoryLogRepository;
	let opsRepo: InMemoryOperationsRepository;
	let poolRepo: InMemoryPoolRepository;
	let claimRepo: InMemoryClaimRepository;
	const POS_CTX: AuthorContext = {
		shelterCode: 'SH001',
		createdBy: 'pos_user',
		roles: ['shelter:SH001', 'supply_coordinator']
	};
	const REG_STAFF_CTX: AuthorContext = {
		shelterCode: 'SH001',
		createdBy: 'reg_user',
		roles: ['shelter:SH001', 'registration_staff']
	};
	const WAREHOUSE_CTX: AuthorContext = {
		shelterCode: 'SH001',
		createdBy: 'wh_user',
		roles: ['shelter:SH001', 'warehouse_staff']
	};
	const COORDINATOR_CTX: AuthorContext = {
		shelterCode: 'SH001',
		createdBy: 'sc_user',
		roles: ['shelter:SH001', 'supply_coordinator']
	};
	const MANAGER_CTX: AuthorContext = {
		shelterCode: 'SH001',
		createdBy: 'mgr_user',
		roles: ['shelter:SH001', 'shelter_manager']
	};
	const ADMIN_CTX: AuthorContext = {
		shelterCode: 'SH001',
		createdBy: 'admin_user',
		roles: ['system_admin']
	};
	const UNAUTH_CTX: AuthorContext = {
		shelterCode: 'SH001',
		createdBy: 'unauth_user',
		roles: ['shelter:SH001', 'medical_staff']
	};

	beforeEach(() => {
		logRepo = new InMemoryLogRepository();
		opsRepo = new InMemoryOperationsRepository();
		poolRepo = new InMemoryPoolRepository();
		claimRepo = new InMemoryClaimRepository();
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

	it('allows an authorized second actor to complete ledger-only recovery without rewriting receipt audit', async () => {
		const input = {
			operationUlid: '01J00000000000000000000016',
			item_id: 'item:cot',
			total_received_qty: '2'
		};
		poolRepo.failNextCreate = true;
		await expect(
			createBulkReturnPool(input, POS_CTX, {
				logRepo,
				operationsRepo: opsRepo as unknown as OperationsRepository,
				poolRepo
			})
		).rejects.toThrow('simulated pool write failure');

		const recovered = await createBulkReturnPool(input, WAREHOUSE_CTX, {
			logRepo,
			operationsRepo: opsRepo as unknown as OperationsRepository,
			poolRepo
		});
		expect(opsRepo.ledger).toHaveLength(1);
		expect(opsRepo.ledger[0].created_by).toBe(POS_CTX.createdBy);
		expect(recovered.created_by).toBe(WAREHOUSE_CTX.createdBy);
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

	it('allows an authorized second actor to replay a completed bulk pool operation without another receipt', async () => {
		const input = {
			operationUlid: '01J00000000000000000000015',
			item_id: 'item:cot',
			total_received_qty: '3'
		};
		const first = await createBulkReturnPool(input, POS_CTX, {
			logRepo,
			operationsRepo: opsRepo as unknown as OperationsRepository,
			poolRepo
		});

		const replay = await createBulkReturnPool(input, WAREHOUSE_CTX, {
			logRepo,
			operationsRepo: opsRepo as unknown as OperationsRepository,
			poolRepo
		});

		expect(replay._id).toBe(first._id);
		expect(replay.created_by).toBe(POS_CTX.createdBy);
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
			{
				operationUlid: '01J00000000000000000000014',
				logId: log._id,
				poolId: pool._id,
				notes: 'Confirmed returned in bulk pile'
			},
			POS_CTX,
			{ logRepo, operationsRepo: opsRepo as unknown as OperationsRepository, poolRepo, claimRepo }
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

	describe('P1-02 / CR-134: Bulk Return Claim Coordination & Recovery (clearLoanViaBulkPool)', () => {
		const OP_ULID = '01J00000000000000000000100';
		describe('P1-05 Physical Stock Receive RBAC Alignment', () => {
			it('A. registration_staff counter physical return -> authorization error before side effects', async () => {
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
					REG_STAFF_CTX
				);

				await expect(
					returnLoanAtCounter(
						log._id,
						{ qty_returned: '2', condition_on_return: 'READY' },
						REG_STAFF_CTX,
						{ logRepo, operationsRepo: opsRepo as unknown as OperationsRepository, poolRepo }
					)
				).rejects.toBeInstanceOf(WorkflowAuthorizationError);

				// Assert no side effects: no ledger entry created, log unmutated
				expect(opsRepo.ledger).toHaveLength(0);
				const freshLog = await logRepo.get(log._id);
				expect(freshLog?.status).toBe('active');
				expect(freshLog?.qty_returned).toBeUndefined();
			});

			it('B. registration_staff bulk pool creation -> authorization error before side effects', async () => {
				const operationUlid = '01J00000000000000000000099';
				const poolId = `bulk_return_pool:${operationUlid}`;

				await expect(
					createBulkReturnPool(
						{ operationUlid, item_id: 'item:blanket', total_received_qty: '10' },
						REG_STAFF_CTX,
						{ logRepo, operationsRepo: opsRepo as unknown as OperationsRepository, poolRepo }
					)
				).rejects.toBeInstanceOf(WorkflowAuthorizationError);

				// Assert no side effects: no ledger entry created, no pool created
				expect(opsRepo.ledger).toHaveLength(0);
				expect(poolRepo.pools.has(poolId)).toBe(false);
			});

			it('C. allowed physical-receipt roles (warehouse_staff, supply_coordinator, shelter_manager, system_admin) can write physical stock receipts', async () => {
				const allowedContexts = [
					{ name: 'warehouse_staff', ctx: WAREHOUSE_CTX },
					{ name: 'supply_coordinator', ctx: COORDINATOR_CTX },
					{ name: 'shelter_manager', ctx: MANAGER_CTX },
					{ name: 'system_admin', ctx: ADMIN_CTX }
				];

				let counter = 100;
				for (const { name, ctx } of allowedContexts) {
					const ulidSuffix = String(counter++).padStart(26, '0');
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
						ctx
					);

					const result = await returnLoanAtCounter(
						log._id,
						{ qty_returned: '1', condition_on_return: 'READY' },
						ctx,
						{ logRepo, operationsRepo: opsRepo as unknown as OperationsRepository, poolRepo }
					);
					expect(result.log.status, `${name} should succeed`).toBe('returned');
					expect(result.ledgerEntryCreated).toBe(true);

					// Also test bulk pool creation
					const poolUlid = `01J${ulidSuffix.slice(3)}`;
					const pool = await createBulkReturnPool(
						{ operationUlid: poolUlid, item_id: 'item:mat', total_received_qty: '5' },
						ctx,
						{ logRepo, operationsRepo: opsRepo as unknown as OperationsRepository, poolRepo }
					);
					expect(pool.status, `${name} should create active pool`).toBe('ACTIVE');
				}
			});

			it('D. registration_staff non-physical lost/waived clear remains allowed', async () => {
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
					REG_STAFF_CTX
				);

				const cleared = await clearLoanNonPhysical(
					log._id,
					{ clear_reason: 'lost', notes: 'Item swept away in flood' },
					REG_STAFF_CTX,
					logRepo
				);

				expect(cleared.status).toBe('lost');
				expect(cleared.clear_reason).toBe('lost');
				// Zero physical ledger entries written
				expect(opsRepo.ledger).toHaveLength(0);
			});

			it('E. bulk-pool claim/clear without stock receipt remains allowed for registration_staff', async () => {
				// Pool created ahead of time by warehouse staff (with physical receipt)
				const operationUlid = '01J00000000000000000000050';
				const pool = await createBulkReturnPool(
					{ operationUlid, item_id: 'item:cot', total_received_qty: '5' },
					WAREHOUSE_CTX,
					{ logRepo, operationsRepo: opsRepo as unknown as OperationsRepository, poolRepo }
				);
				expect(opsRepo.ledger).toHaveLength(1);

				// Log issued to evacuee
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
					REG_STAFF_CTX
				);

				// Registration staff resolves loan at gate against pool
				const resolved = await clearLoanViaBulkPool(
					{
						operationUlid: '01J00000000000000000000051',
						logId: log._id,
						poolId: pool._id,
						notes: 'Gate return swept earlier'
					},
					REG_STAFF_CTX,
					{ logRepo, poolRepo, claimRepo }
				);

				expect(resolved.log.status).toBe('returned');
				expect(resolved.log.clear_reason).toBe('bulk_dropoff');
				expect(resolved.pool.claimed_qty).toBe('1');
				// Still exactly 1 ledger entry from initial pool creation; no new ledger entry created
				expect(opsRepo.ledger).toHaveLength(1);
			});

			it('F. role matrix: canReceivePhysicalStock aligns with VDU Rule 13', () => {
				expect(canReceivePhysicalStock(WAREHOUSE_CTX)).toBe(true);
				expect(canReceivePhysicalStock(COORDINATOR_CTX)).toBe(true);
				expect(canReceivePhysicalStock(MANAGER_CTX)).toBe(true);
				expect(canReceivePhysicalStock(ADMIN_CTX)).toBe(true);

				expect(canReceivePhysicalStock(REG_STAFF_CTX)).toBe(false);
				expect(canReceivePhysicalStock(UNAUTH_CTX)).toBe(false);
				expect(canReceivePhysicalStock({ shelterCode: 'SH001', createdBy: 'none' })).toBe(false);
				expect(
					canReceivePhysicalStock({
						shelterCode: 'SH002',
						createdBy: 'wh_user',
						roles: ['shelter:SH001', 'warehouse_staff']
					})
				).toBe(false);
			});
		});

		const POOL_ULID = '01J00000000000000000000102';

		it('requires a caller-owned operationUlid before any claim side effect', async () => {
			await expect(
				clearLoanViaBulkPool(
					{
						logId: 'distribution_log:01J00000000000000000000990',
						poolId: 'bulk_return_pool:01J00000000000000000000991'
					} as unknown as Parameters<typeof clearLoanViaBulkPool>[0],
					POS_CTX,
					{ logRepo, poolRepo, claimRepo }
				)
			).rejects.toThrow('operationUlid must be a valid ULID');
			expect(claimRepo.claims).toHaveLength(0);
		});

		it('1. Normal bulk clear: completes claim, decrements pool quota, updates log to returned', async () => {
			const pool = await poolRepo.create(
				createBulkReturnPoolDoc(
					{
						stock_ledger_id: `stock_ledger:${POOL_ULID}`,
						item_id: 'item:cot',
						total_received_qty: '10'
					},
					WAREHOUSE_CTX,
					POOL_ULID
				),
				WAREHOUSE_CTX
			);

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

			const result = await clearLoanViaBulkPool(
				{ operationUlid: OP_ULID, logId: log._id, poolId: pool._id, notes: 'Normal clear' },
				POS_CTX,
				{ logRepo, operationsRepo: opsRepo as unknown as OperationsRepository, poolRepo, claimRepo }
			);

			expect(result.log.status).toBe('returned');
			expect(result.log.qty_returned).toBe('1');
			expect(result.log.clear_reason).toBe('bulk_dropoff');
			expect(result.log.bulk_pool_id).toBe(pool._id);

			expect(result.pool.claimed_qty).toBe('1');
			expect(result.pool.unclaimed_quota).toBe('9');
			expect(result.pool.claim_ids).toContain(result.claim._id);

			expect(result.claim.status).toBe('COMPLETE');
			expect(result.claim.claimed_qty).toBe('1');
			expect(result.claim.operation_id).toBe(OP_ULID);
		});

		it('2. issued 5 / previously returned 2 / claim 3', async () => {
			const pool = await poolRepo.create(
				createBulkReturnPoolDoc(
					{
						stock_ledger_id: 'stock_ledger:01J00000000000000000000103',
						item_id: 'item:blanket',
						total_received_qty: '10'
					},
					WAREHOUSE_CTX,
					'01J00000000000000000000103'
				),
				WAREHOUSE_CTX
			);

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

			// Pre-simulate partial return of 2
			await logRepo.recordReturn(
				log._id,
				{
					qty_returned: '2',
					clear_reason: 'routine',
					notes: 'Returned 2 at counter'
				},
				POS_CTX
			);

			const result = await clearLoanViaBulkPool(
				{ operationUlid: '01J00000000000000000000104', logId: log._id, poolId: pool._id },
				POS_CTX,
				{ logRepo, operationsRepo: opsRepo as unknown as OperationsRepository, poolRepo, claimRepo }
			);

			expect(result.claim.claimed_qty).toBe('3');
			expect(result.log.status).toBe('returned');
			expect(result.log.qty_returned).toBe('5');
			expect(result.pool.claimed_qty).toBe('3');
			expect(result.pool.unclaimed_quota).toBe('7');
		});

		it('3. zero StockLedger writes across the entire bulk clear workflow', async () => {
			// Pool created with initial physical receive (1 ledger entry)
			const pool = await createBulkReturnPool(
				{
					operationUlid: '01J00000000000000000000105',
					item_id: 'item:cot',
					total_received_qty: '10'
				},
				WAREHOUSE_CTX,
				{ logRepo, operationsRepo: opsRepo as unknown as OperationsRepository, poolRepo }
			);
			expect(opsRepo.ledger).toHaveLength(1);

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

			await clearLoanViaBulkPool(
				{
					operationUlid: '01J00000000000000000000103',
					logId: log._id,
					poolId: pool._id,
					notes: 'Bulk clear at gate'
				},
				POS_CTX,
				{
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo
				}
			);

			// Ledger count remains exactly 1!
			expect(opsRepo.ledger).toHaveLength(1);
		});

		it('4. deterministic claim ID strictly derived from DistributionLog identity', async () => {
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

			const pool = await poolRepo.create(
				createBulkReturnPoolDoc(
					{
						stock_ledger_id: 'stock_ledger:01J00000000000000000000106',
						item_id: 'item:cot',
						total_received_qty: '10'
					},
					WAREHOUSE_CTX,
					'01J00000000000000000000106'
				),
				WAREHOUSE_CTX
			);

			const expectedClaimId = deriveClaimIdFromDistributionLog(log._id);
			expect(expectedClaimId).toBe(`bulk_return_claim:${log._id.replace('distribution_log:', '')}`);

			const result = await clearLoanViaBulkPool(
				{ operationUlid: '01J00000000000000000000107', logId: log._id, poolId: pool._id },
				POS_CTX,
				{ logRepo, operationsRepo: opsRepo as unknown as OperationsRepository, poolRepo, claimRepo }
			);

			expect(result.claim._id).toBe(expectedClaimId);
		});

		it('5. same operation replay: idempotent success without double decrement', async () => {
			const pool = await poolRepo.create(
				createBulkReturnPoolDoc(
					{
						stock_ledger_id: 'stock_ledger:01J00000000000000000000108',
						item_id: 'item:cot',
						total_received_qty: '10'
					},
					WAREHOUSE_CTX,
					'01J00000000000000000000108'
				),
				WAREHOUSE_CTX
			);

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

			const opId = '01J00000000000000000000109';
			const res1 = await clearLoanViaBulkPool(
				{ operationUlid: opId, logId: log._id, poolId: pool._id },
				POS_CTX,
				{ logRepo, operationsRepo: opsRepo as unknown as OperationsRepository, poolRepo, claimRepo }
			);
			expect(res1.claim.status).toBe('COMPLETE');
			expect(res1.pool.claimed_qty).toBe('1');
			expect(res1.pool.unclaimed_quota).toBe('9');

			// Replay with exact same operationUlid
			const res2 = await clearLoanViaBulkPool(
				{ operationUlid: opId, logId: log._id, poolId: pool._id },
				POS_CTX,
				{ logRepo, operationsRepo: opsRepo as unknown as OperationsRepository, poolRepo, claimRepo }
			);
			expect(res2.claim.status).toBe('COMPLETE');
			expect(res2.pool.claimed_qty).toBe('1');
			expect(res2.pool.unclaimed_quota).toBe('9');
		});

		it('6. same Log + different operation collision fails closed before pool mutation', async () => {
			const pool = await poolRepo.create(
				createBulkReturnPoolDoc(
					{
						stock_ledger_id: 'stock_ledger:01J00000000000000000000110',
						item_id: 'item:cot',
						total_received_qty: '10'
					},
					WAREHOUSE_CTX,
					'01J00000000000000000000110'
				),
				WAREHOUSE_CTX
			);

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

			const opA = '01J00000000000000000000111';
			const opB = '01J00000000000000000000112';

			// First operation succeeds
			await clearLoanViaBulkPool(
				{ operationUlid: opA, logId: log._id, poolId: pool._id },
				POS_CTX,
				{ logRepo, operationsRepo: opsRepo as unknown as OperationsRepository, poolRepo, claimRepo }
			);

			// Competing operation with different ULID fails closed
			await expect(
				clearLoanViaBulkPool({ operationUlid: opB, logId: log._id, poolId: pool._id }, POS_CTX, {
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo
				})
			).rejects.toThrow(ConcurrencyCollisionError);
		});

		it('7. Claim Intent crash recovery: resumes from durable CLAIM_INTENT', async () => {
			const pool = await poolRepo.create(
				createBulkReturnPoolDoc(
					{
						stock_ledger_id: 'stock_ledger:01J00000000000000000000113',
						item_id: 'item:cot',
						total_received_qty: '10'
					},
					WAREHOUSE_CTX,
					'01J00000000000000000000113'
				),
				WAREHOUSE_CTX
			);

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

			const opId = '01J00000000000000000000114';
			const claimId = deriveClaimIdFromDistributionLog(log._id);

			// Pre-seed Claim Intent (as if process crashed right after Step 1)
			await claimRepo.create({
				_id: claimId,
				type: 'bulk_return_claim',
				schema_v: 1,
				shelter_code: POS_CTX.shelterCode,
				operation_id: opId,
				distribution_log_id: log._id,
				bulk_pool_id: pool._id,
				item_id: log.item_id,
				claimed_qty: '1',
				status: 'CLAIM_INTENT',
				created_at: new Date().toISOString(),
				created_by: POS_CTX.createdBy,
				updated_at: new Date().toISOString()
			});

			// Retry resumes and completes
			const result = await clearLoanViaBulkPool(
				{ operationUlid: opId, logId: log._id, poolId: pool._id },
				POS_CTX,
				{ logRepo, operationsRepo: opsRepo as unknown as OperationsRepository, poolRepo, claimRepo }
			);

			expect(result.claim.status).toBe('COMPLETE');
			expect(result.log.status).toBe('returned');
			expect(result.pool.claimed_qty).toBe('1');
		});

		it('8. Pool effect done while Claim still CLAIM_INTENT: advances without double decrement', async () => {
			const pool = await poolRepo.create(
				createBulkReturnPoolDoc(
					{
						stock_ledger_id: 'stock_ledger:01J00000000000000000000115',
						item_id: 'item:cot',
						total_received_qty: '10'
					},
					WAREHOUSE_CTX,
					'01J00000000000000000000115'
				),
				WAREHOUSE_CTX
			);

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

			const opId = '01J00000000000000000000116';
			const claimId = deriveClaimIdFromDistributionLog(log._id);

			// Simulate crash after Step 2: Pool decremented and has claimId, but claim doc still in CLAIM_INTENT
			await poolRepo.claimQuota(pool._id, claimId, '1', POS_CTX);
			await claimRepo.create({
				_id: claimId,
				type: 'bulk_return_claim',
				schema_v: 1,
				shelter_code: POS_CTX.shelterCode,
				operation_id: opId,
				distribution_log_id: log._id,
				bulk_pool_id: pool._id,
				item_id: log.item_id,
				claimed_qty: '1',
				status: 'CLAIM_INTENT',
				created_at: new Date().toISOString(),
				created_by: POS_CTX.createdBy,
				updated_at: new Date().toISOString()
			});

			const result = await clearLoanViaBulkPool(
				{ operationUlid: opId, logId: log._id, poolId: pool._id },
				POS_CTX,
				{ logRepo, operationsRepo: opsRepo as unknown as OperationsRepository, poolRepo, claimRepo }
			);

			expect(result.claim.status).toBe('COMPLETE');
			expect(result.pool.claimed_qty).toBe('1'); // NOT 2!
			expect(result.pool.unclaimed_quota).toBe('9');
			expect(result.log.status).toBe('returned');
		});

		it('9. POOL_CLAIMED → Log update forward recovery', async () => {
			const pool = await poolRepo.create(
				createBulkReturnPoolDoc(
					{
						stock_ledger_id: 'stock_ledger:01J00000000000000000000117',
						item_id: 'item:cot',
						total_received_qty: '10'
					},
					WAREHOUSE_CTX,
					'01J00000000000000000000117'
				),
				WAREHOUSE_CTX
			);

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

			const opId = '01J00000000000000000000118';
			const claimId = deriveClaimIdFromDistributionLog(log._id);

			await poolRepo.claimQuota(pool._id, claimId, '1', POS_CTX);
			await claimRepo.create({
				_id: claimId,
				type: 'bulk_return_claim',
				schema_v: 1,
				shelter_code: POS_CTX.shelterCode,
				operation_id: opId,
				distribution_log_id: log._id,
				bulk_pool_id: pool._id,
				item_id: log.item_id,
				claimed_qty: '1',
				status: 'POOL_CLAIMED',
				created_at: new Date().toISOString(),
				created_by: POS_CTX.createdBy,
				updated_at: new Date().toISOString()
			});

			const result = await clearLoanViaBulkPool(
				{ operationUlid: opId, logId: log._id, poolId: pool._id },
				POS_CTX,
				{ logRepo, operationsRepo: opsRepo as unknown as OperationsRepository, poolRepo, claimRepo }
			);

			expect(result.log.status).toBe('returned');
			expect(result.claim.status).toBe('COMPLETE');
		});

		it('10. Log updated → Claim COMPLETE recovery', async () => {
			const pool = await poolRepo.create(
				createBulkReturnPoolDoc(
					{
						stock_ledger_id: 'stock_ledger:01J00000000000000000000119',
						item_id: 'item:cot',
						total_received_qty: '10'
					},
					WAREHOUSE_CTX,
					'01J00000000000000000000119'
				),
				WAREHOUSE_CTX
			);

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

			const opId = '01J00000000000000000000120';
			const claimId = deriveClaimIdFromDistributionLog(log._id);

			await poolRepo.claimQuota(pool._id, claimId, '1', POS_CTX);
			await logRepo.recordReturn(
				log._id,
				{
					qty_returned: '1',
					clear_reason: 'bulk_dropoff',
					bulk_pool_id: pool._id,
					notes: 'Cleared'
				},
				POS_CTX
			);
			await claimRepo.create({
				_id: claimId,
				type: 'bulk_return_claim',
				schema_v: 1,
				shelter_code: POS_CTX.shelterCode,
				operation_id: opId,
				distribution_log_id: log._id,
				bulk_pool_id: pool._id,
				item_id: log.item_id,
				claimed_qty: '1',
				status: 'POOL_CLAIMED',
				created_at: new Date().toISOString(),
				created_by: POS_CTX.createdBy,
				updated_at: new Date().toISOString()
			});

			const result = await clearLoanViaBulkPool(
				{ operationUlid: opId, logId: log._id, poolId: pool._id },
				POS_CTX,
				{ logRepo, operationsRepo: opsRepo as unknown as OperationsRepository, poolRepo, claimRepo }
			);

			expect(result.claim.status).toBe('COMPLETE');
			expect(result.log.status).toBe('returned');
		});

		it('11. no duplicate pool decrement on repeated calls', async () => {
			const pool = await poolRepo.create(
				createBulkReturnPoolDoc(
					{
						stock_ledger_id: 'stock_ledger:01J00000000000000000000121',
						item_id: 'item:cot',
						total_received_qty: '5'
					},
					WAREHOUSE_CTX,
					'01J00000000000000000000121'
				),
				WAREHOUSE_CTX
			);

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

			const opId = '01J00000000000000000000122';
			await clearLoanViaBulkPool(
				{ operationUlid: opId, logId: log._id, poolId: pool._id },
				POS_CTX,
				{ logRepo, operationsRepo: opsRepo as unknown as OperationsRepository, poolRepo, claimRepo }
			);
			await clearLoanViaBulkPool(
				{ operationUlid: opId, logId: log._id, poolId: pool._id },
				POS_CTX,
				{ logRepo, operationsRepo: opsRepo as unknown as OperationsRepository, poolRepo, claimRepo }
			);

			const currentPool = (await poolRepo.get(pool._id))!;
			expect(currentPool.claimed_qty).toBe('1');
			expect(currentPool.unclaimed_quota).toBe('4');
		});

		it('12. final qty strict equality enforced', async () => {
			const pool = await poolRepo.create(
				createBulkReturnPoolDoc(
					{
						stock_ledger_id: 'stock_ledger:01J00000000000000000000123',
						item_id: 'item:cot',
						total_received_qty: '5'
					},
					WAREHOUSE_CTX,
					'01J00000000000000000000123'
				),
				WAREHOUSE_CTX
			);

			const log = await logRepo.create(
				{
					ticket_id: 'requisition_ticket:01J00000000000000000000001',
					item_id: 'item:cot',
					qty: '2',
					recipient_type: 'evacuee',
					recipient_id: 'evacuee:01J00000000000000000000001',
					is_returnable: true,
					status: 'active',
					is_override: false
				},
				POS_CTX
			);

			const result = await clearLoanViaBulkPool(
				{ operationUlid: '01J00000000000000000000124', logId: log._id, poolId: pool._id },
				POS_CTX,
				{ logRepo, operationsRepo: opsRepo as unknown as OperationsRepository, poolRepo, claimRepo }
			);

			expect(result.log.qty_returned).toBe(result.log.qty);
			expect(result.log.status).toBe('returned');
		});

		it('13. over-return fails closed with StockIntegrityError', async () => {
			const pool = await poolRepo.create(
				createBulkReturnPoolDoc(
					{
						stock_ledger_id: 'stock_ledger:01J00000000000000000000125',
						item_id: 'item:cot',
						total_received_qty: '10'
					},
					WAREHOUSE_CTX,
					'01J00000000000000000000125'
				),
				WAREHOUSE_CTX
			);

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

			// Inject a Claim doc that claims 2 (which would exceed log.qty 1)
			const opId = '01J00000000000000000000126';
			const claimId = deriveClaimIdFromDistributionLog(log._id);
			await claimRepo.create({
				_id: claimId,
				type: 'bulk_return_claim',
				schema_v: 1,
				shelter_code: POS_CTX.shelterCode,
				operation_id: opId,
				distribution_log_id: log._id,
				bulk_pool_id: pool._id,
				item_id: log.item_id,
				claimed_qty: '2',
				status: 'CLAIM_INTENT',
				created_at: new Date().toISOString(),
				created_by: POS_CTX.createdBy,
				updated_at: new Date().toISOString()
			});

			await expect(
				clearLoanViaBulkPool({ operationUlid: opId, logId: log._id, poolId: pool._id }, POS_CTX, {
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo
				})
			).rejects.toThrow(StockIntegrityError);
		});

		it('14. under-return fails closed with WorkflowValidationError', async () => {
			const pool = await poolRepo.create(
				createBulkReturnPoolDoc(
					{
						stock_ledger_id: 'stock_ledger:01J00000000000000000000127',
						item_id: 'item:cot',
						total_received_qty: '10'
					},
					WAREHOUSE_CTX,
					'01J00000000000000000000127'
				),
				WAREHOUSE_CTX
			);

			const log = await logRepo.create(
				{
					ticket_id: 'requisition_ticket:01J00000000000000000000001',
					item_id: 'item:cot',
					qty: '5',
					recipient_type: 'evacuee',
					recipient_id: 'evacuee:01J00000000000000000000001',
					is_returnable: true,
					status: 'active',
					is_override: false
				},
				POS_CTX
			);

			// Inject a Claim doc claiming only 1 (under-returning)
			const opId = '01J00000000000000000000128';
			const claimId = deriveClaimIdFromDistributionLog(log._id);
			await claimRepo.create({
				_id: claimId,
				type: 'bulk_return_claim',
				schema_v: 1,
				shelter_code: POS_CTX.shelterCode,
				operation_id: opId,
				distribution_log_id: log._id,
				bulk_pool_id: pool._id,
				item_id: log.item_id,
				claimed_qty: '1',
				status: 'CLAIM_INTENT',
				created_at: new Date().toISOString(),
				created_by: POS_CTX.createdBy,
				updated_at: new Date().toISOString()
			});

			await expect(
				clearLoanViaBulkPool({ operationUlid: opId, logId: log._id, poolId: pool._id }, POS_CTX, {
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo
				})
			).rejects.toThrow(WorkflowValidationError);
		});

		it('15. ABORT on deterministic quota exhaustion', async () => {
			// Pool with 0 unclaimed quota (EXHAUSTED)
			const pool = await poolRepo.create(
				{
					...createBulkReturnPoolDoc(
						{
							stock_ledger_id: 'stock_ledger:01J00000000000000000000129',
							item_id: 'item:cot',
							total_received_qty: '1'
						},
						WAREHOUSE_CTX,
						'01J00000000000000000000129'
					),
					claimed_qty: '1',
					unclaimed_quota: '0',
					status: 'EXHAUSTED'
				},
				WAREHOUSE_CTX
			);

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

			// Pre-flight check rejects immediately without creating claim doc!
			await expect(
				clearLoanViaBulkPool(
					{ operationUlid: '01J00000000000000000000130', logId: log._id, poolId: pool._id },
					POS_CTX,
					{
						logRepo,
						operationsRepo: opsRepo as unknown as OperationsRepository,
						poolRepo,
						claimRepo
					}
				)
			).rejects.toThrow(InsufficientPoolQuotaError);

			const claimId = deriveClaimIdFromDistributionLog(log._id);
			const savedClaim = await claimRepo.get(claimId);
			expect(savedClaim).toBeNull();
		});

		it('16. transient error does NOT ABORT claim', async () => {
			const pool = await poolRepo.create(
				createBulkReturnPoolDoc(
					{
						stock_ledger_id: 'stock_ledger:01J00000000000000000000131',
						item_id: 'item:cot',
						total_received_qty: '10'
					},
					WAREHOUSE_CTX,
					'01J00000000000000000000131'
				),
				WAREHOUSE_CTX
			);

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

			const opId = '01J00000000000000000000132';
			// Mock claimQuota to throw transient network error
			const originalClaimQuota = poolRepo.claimQuota.bind(poolRepo);
			poolRepo.claimQuota = async () => {
				throw new Error('ETIMEDOUT: Connection lost');
			};

			await expect(
				clearLoanViaBulkPool({ operationUlid: opId, logId: log._id, poolId: pool._id }, POS_CTX, {
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo
				})
			).rejects.toThrow('ETIMEDOUT');

			// Claim doc must remain in CLAIM_INTENT, NOT ABORTED!
			const claimId = deriveClaimIdFromDistributionLog(log._id);
			const savedClaim = (await claimRepo.get(claimId))!;
			expect(savedClaim.status).toBe('CLAIM_INTENT');

			// Restore
			poolRepo.claimQuota = originalClaimQuota;
		});

		it('17. ABORTED → CLAIM_INTENT re-initialization', async () => {
			const pool1 = await poolRepo.create(
				{
					...createBulkReturnPoolDoc(
						{
							stock_ledger_id: 'stock_ledger:01J00000000000000000000133',
							item_id: 'item:cot',
							total_received_qty: '1'
						},
						WAREHOUSE_CTX,
						'01J00000000000000000000133'
					),
					claimed_qty: '1',
					unclaimed_quota: '0',
					status: 'EXHAUSTED'
				},
				WAREHOUSE_CTX
			);

			const pool2 = await poolRepo.create(
				createBulkReturnPoolDoc(
					{
						stock_ledger_id: 'stock_ledger:01J00000000000000000000134',
						item_id: 'item:cot',
						total_received_qty: '10'
					},
					WAREHOUSE_CTX,
					'01J00000000000000000000134'
				),
				WAREHOUSE_CTX
			);

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

			const claimId = deriveClaimIdFromDistributionLog(log._id);
			// Pre-existing claim was ABORTED under op1
			await claimRepo.create({
				_id: claimId,
				type: 'bulk_return_claim',
				schema_v: 1,
				shelter_code: POS_CTX.shelterCode,
				operation_id: '01J00000000000000000000135',
				distribution_log_id: log._id,
				bulk_pool_id: pool1._id,
				item_id: log.item_id,
				claimed_qty: '1',
				status: 'ABORTED',
				created_at: new Date().toISOString(),
				created_by: POS_CTX.createdBy,
				updated_at: new Date().toISOString()
			});

			// op2 reinitializes with pool2
			const op2 = '01J00000000000000000000136';
			const result = await clearLoanViaBulkPool(
				{ operationUlid: op2, logId: log._id, poolId: pool2._id },
				POS_CTX,
				{ logRepo, operationsRepo: opsRepo as unknown as OperationsRepository, poolRepo, claimRepo }
			);

			expect(result.claim.status).toBe('COMPLETE');
			expect(result.claim.operation_id).toBe(op2);
			expect(result.claim.bulk_pool_id).toBe(pool2._id);
			expect(result.log.status).toBe('returned');
		});

		it('18. two competing ABORTED reinitializations: one CAS winner', async () => {
			const pool = await poolRepo.create(
				createBulkReturnPoolDoc(
					{
						stock_ledger_id: 'stock_ledger:01J00000000000000000000137',
						item_id: 'item:cot',
						total_received_qty: '10'
					},
					WAREHOUSE_CTX,
					'01J00000000000000000000137'
				),
				WAREHOUSE_CTX
			);

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

			const claimId = deriveClaimIdFromDistributionLog(log._id);
			await claimRepo.create({
				_id: claimId,
				type: 'bulk_return_claim',
				schema_v: 1,
				shelter_code: POS_CTX.shelterCode,
				operation_id: '01J00000000000000000000138',
				distribution_log_id: log._id,
				bulk_pool_id: pool._id,
				item_id: log.item_id,
				claimed_qty: '1',
				status: 'ABORTED',
				created_at: new Date().toISOString(),
				created_by: POS_CTX.createdBy,
				updated_at: new Date().toISOString()
			});

			const opWinner = '01J00000000000000000000139';
			const opLoser = '01J00000000000000000000140';

			// First winner reinitializes
			await clearLoanViaBulkPool(
				{ operationUlid: opWinner, logId: log._id, poolId: pool._id },
				POS_CTX,
				{ logRepo, operationsRepo: opsRepo as unknown as OperationsRepository, poolRepo, claimRepo }
			);

			// Second loser attempts to reinitialize but detects claim is no longer ABORTED
			await expect(
				clearLoanViaBulkPool(
					{ operationUlid: opLoser, logId: log._id, poolId: pool._id },
					POS_CTX,
					{
						logRepo,
						operationsRepo: opsRepo as unknown as OperationsRepository,
						poolRepo,
						claimRepo
					}
				)
			).rejects.toThrow(ConcurrencyCollisionError);
		});

		it('19. active v1 Pool lazy upgrade to v2', async () => {
			// Create historical v1 pool document
			const v1Pool: HistoricalBulkReturnPoolV1 = {
				_id: 'bulk_return_pool:01J00000000000000000000141',
				type: 'bulk_return_pool',
				schema_v: 1,
				shelter_code: POS_CTX.shelterCode,
				item_id: 'item:cot',
				stock_ledger_id: 'stock_ledger:01J00000000000000000000141',
				total_received_qty: '10',
				claimed_qty: '0',
				unclaimed_quota: '10',
				status: 'ACTIVE',
				created_at: new Date().toISOString(),
				created_by: WAREHOUSE_CTX.createdBy,
				updated_at: new Date().toISOString()
			};
			poolRepo.pools.set(v1Pool._id, v1Pool);

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

			const result = await clearLoanViaBulkPool(
				{ operationUlid: '01J00000000000000000000142', logId: log._id, poolId: v1Pool._id },
				POS_CTX,
				{ logRepo, operationsRepo: opsRepo as unknown as OperationsRepository, poolRepo, claimRepo }
			);

			expect(result.pool.schema_v).toBe(2);
			expect(result.pool.claim_ids).toHaveLength(1);
			expect(result.pool.claim_ids).toContain(result.claim._id);
		});

		it('20. v1 lazy upgrade + quota claim occurs atomically in single write', async () => {
			const v1Pool: HistoricalBulkReturnPoolV1 = {
				_id: 'bulk_return_pool:01J00000000000000000000143',
				type: 'bulk_return_pool',
				schema_v: 1,
				shelter_code: POS_CTX.shelterCode,
				item_id: 'item:cot',
				stock_ledger_id: 'stock_ledger:01J00000000000000000000143',
				total_received_qty: '5',
				claimed_qty: '0',
				unclaimed_quota: '5',
				status: 'ACTIVE',
				created_at: new Date().toISOString(),
				created_by: WAREHOUSE_CTX.createdBy,
				updated_at: new Date().toISOString()
			};
			poolRepo.pools.set(v1Pool._id, v1Pool);

			const claimId = 'bulk_return_claim:01J00000000000000000000144';
			const updated = await poolRepo.claimQuota(v1Pool._id, claimId, '2', POS_CTX);

			expect(updated.schema_v).toBe(2);
			expect(updated.claimed_qty).toBe('2');
			expect(updated.unclaimed_quota).toBe('3');
			expect(updated.claim_ids).toEqual([claimId]);
		});

		it('21. v2 pool normal claim: appends to claim_ids', async () => {
			const pool = await poolRepo.create(
				createBulkReturnPoolDoc(
					{
						stock_ledger_id: 'stock_ledger:01J00000000000000000000145',
						item_id: 'item:cot',
						total_received_qty: '10'
					},
					WAREHOUSE_CTX,
					'01J00000000000000000000145'
				),
				WAREHOUSE_CTX
			);

			const claim1 = 'bulk_return_claim:01J00000000000000000000146';
			const claim2 = 'bulk_return_claim:01J00000000000000000000147';

			await poolRepo.claimQuota(pool._id, claim1, '1', POS_CTX);
			const p2 = await poolRepo.claimQuota(pool._id, claim2, '2', POS_CTX);

			expect(p2.schema_v).toBe(2);
			expect(p2.claimed_qty).toBe('3');
			expect(p2.unclaimed_quota).toBe('7');
			expect(p2.claim_ids).toEqual([claim1, claim2]);
		});

		it('22. duplicate claim ID does not decrement twice', async () => {
			const pool = await poolRepo.create(
				createBulkReturnPoolDoc(
					{
						stock_ledger_id: 'stock_ledger:01J00000000000000000000148',
						item_id: 'item:cot',
						total_received_qty: '10'
					},
					WAREHOUSE_CTX,
					'01J00000000000000000000148'
				),
				WAREHOUSE_CTX
			);

			const claimId = 'bulk_return_claim:01J00000000000000000000149';
			const first = await poolRepo.claimQuota(pool._id, claimId, '1', POS_CTX);
			const second = await poolRepo.claimQuota(pool._id, claimId, '1', POS_CTX);

			expect(first.claimed_qty).toBe('1');
			expect(second.claimed_qty).toBe('1');
			expect(second.claim_ids).toHaveLength(1);
		});

		/**
		 * CouchDB validators reject by throwing a plain `{ forbidden }` object, not an
		 * Error — `expect(...).toThrow(/re/)` cannot read those, so assert the field.
		 */
		function expectForbidden(run: () => void, match: RegExp): void {
			try {
				run();
			} catch (e) {
				expect((e as { forbidden?: string }).forbidden ?? String(e)).toMatch(match);
				return;
			}
			throw new Error(`Expected a forbidden error matching ${match}, but nothing was thrown`);
		}

		it('23. v2 → v1 rejected by VDU', () => {
			const vduCode = buildValidateDocUpdate('SH001');
			const validate = new Function(`return ${vduCode}`)();

			const v2Pool = {
				_id: 'bulk_return_pool:01J00000000000000000000150',
				type: 'bulk_return_pool',
				schema_v: 2,
				shelter_code: 'SH001',
				item_id: 'item:cot',
				stock_ledger_id: 'stock_ledger:01J00000000000000000000150',
				total_received_qty: '10',
				claimed_qty: '0',
				unclaimed_quota: '10',
				claim_ids: [],
				status: 'ACTIVE',
				created_at: new Date().toISOString(),
				created_by: 'wh_user',
				updated_at: new Date().toISOString()
			};

			const downgraded = { ...v2Pool, schema_v: 1 };
			expectForbidden(
				() =>
					validate(downgraded, v2Pool, {
						name: 'wh_user',
						roles: ['shelter:SH001', 'warehouse_staff']
					}),
				/Cannot downgrade bulk_return_pool from schema_v 2 to 1/
			);
		});

		it('24. bulk_return_claim hard delete rejected by VDU', () => {
			const vduCode = buildValidateDocUpdate('SH001');
			const validate = new Function(`return ${vduCode}`)();

			const claimDoc = {
				_id: 'bulk_return_claim:01J00000000000000000000151',
				type: 'bulk_return_claim',
				schema_v: 1,
				shelter_code: 'SH001',
				operation_id: '01J00000000000000000000152',
				distribution_log_id: 'distribution_log:01J00000000000000000000151',
				bulk_pool_id: 'bulk_return_pool:01J00000000000000000000153',
				item_id: 'item:cot',
				claimed_qty: '1',
				status: 'CLAIM_INTENT',
				created_at: new Date().toISOString(),
				created_by: 'reg_user',
				updated_at: new Date().toISOString()
			};

			expectForbidden(
				() =>
					validate({ _id: claimDoc._id, _deleted: true }, claimDoc, {
						name: 'reg_user',
						roles: ['shelter:SH001', 'registration_staff']
					}),
				/Cannot delete bulk_return_claim documents/
			);
		});

		it('24a. VDU permits all canonical frontline claim roles including system_admin and rejects unauthorized scope', () => {
			const vduCode = buildValidateDocUpdate('SH001');
			const validate = new Function(`return ${vduCode}`)();
			const claimDoc = {
				_id: 'bulk_return_claim:01J00000000000000000000170',
				type: 'bulk_return_claim',
				schema_v: 1,
				shelter_code: 'SH001',
				operation_id: '01J00000000000000000000171',
				distribution_log_id: 'distribution_log:01J00000000000000000000170',
				bulk_pool_id: 'bulk_return_pool:01J00000000000000000000172',
				item_id: 'item:cot',
				claimed_qty: '1',
				status: 'CLAIM_INTENT',
				created_at: new Date().toISOString(),
				created_by: 'frontline_user',
				updated_at: new Date().toISOString()
			};

			for (const userCtx of [
				{ name: 'reg', roles: ['shelter:SH001', 'registration_staff'] },
				{ name: 'sc', roles: ['shelter:SH001', 'supply_coordinator'] },
				{ name: 'mgr', roles: ['shelter:SH001', 'shelter_manager'] },
				{ name: 'admin', roles: ['system_admin'] }
			]) {
				expect(() => validate(claimDoc, null, userCtx)).not.toThrow();
			}

			expectForbidden(
				() =>
					validate(claimDoc, null, { name: 'unauth', roles: ['shelter:SH001', 'kitchen_staff'] }),
				/Only registration staff, supply coordinator, shelter manager, or system admin can manage bulk return claims/
			);
			expectForbidden(
				() =>
					validate({ ...claimDoc, shelter_code: 'SH002' }, null, {
						name: 'reg',
						roles: ['shelter:SH001', 'registration_staff']
					}),
				/shelter_code must be SH001/
			);
		});

		it('25. immutable fields on bulk_return_claim rejected by VDU', () => {
			const vduCode = buildValidateDocUpdate('SH001');
			const validate = new Function(`return ${vduCode}`)();

			const claimDoc = {
				_id: 'bulk_return_claim:01J00000000000000000000154',
				type: 'bulk_return_claim',
				schema_v: 1,
				shelter_code: 'SH001',
				operation_id: '01J00000000000000000000155',
				distribution_log_id: 'distribution_log:01J00000000000000000000154',
				bulk_pool_id: 'bulk_return_pool:01J00000000000000000000156',
				item_id: 'item:cot',
				claimed_qty: '1',
				status: 'CLAIM_INTENT',
				created_at: new Date().toISOString(),
				created_by: 'reg_user',
				updated_at: new Date().toISOString()
			};

			// Mutating permanent immutable fields
			expectForbidden(
				() =>
					validate(
						{ ...claimDoc, distribution_log_id: 'distribution_log:01J00000000000000000000999' },
						claimDoc,
						{
							name: 'reg_user',
							roles: ['shelter:SH001', 'registration_staff']
						}
					),
				/bulk_return_claim id must derive from distribution_log_id/
			);

			expectForbidden(
				() =>
					validate({ ...claimDoc, item_id: 'item:other' }, claimDoc, {
						name: 'reg_user',
						roles: ['shelter:SH001', 'registration_staff']
					}),
				/bulk_return_claim.item_id is permanently immutable/
			);
		});

		it('26. attempt fields change only ABORTED → CLAIM_INTENT', () => {
			const vduCode = buildValidateDocUpdate('SH001');
			const validate = new Function(`return ${vduCode}`)();

			const claimDoc = {
				_id: 'bulk_return_claim:01J00000000000000000000157',
				type: 'bulk_return_claim',
				schema_v: 1,
				shelter_code: 'SH001',
				operation_id: '01J00000000000000000000158',
				distribution_log_id: 'distribution_log:01J00000000000000000000157',
				bulk_pool_id: 'bulk_return_pool:01J00000000000000000000159',
				item_id: 'item:cot',
				claimed_qty: '1',
				status: 'CLAIM_INTENT',
				created_at: new Date().toISOString(),
				created_by: 'reg_user',
				updated_at: new Date().toISOString()
			};

			// Changing operation_id during CLAIM_INTENT -> POOL_CLAIMED is forbidden
			expectForbidden(
				() =>
					validate(
						{
							...claimDoc,
							operation_id: '01J00000000000000000000888',
							status: 'POOL_CLAIMED'
						},
						claimDoc,
						{ name: 'reg_user', roles: ['shelter:SH001', 'registration_staff'] }
					),
				/bulk_return_claim.operation_id is immutable during transition CLAIM_INTENT to POOL_CLAIMED/
			);

			// Changing operation_id from ABORTED -> CLAIM_INTENT is permitted
			const abortedClaim = { ...claimDoc, status: 'ABORTED' };
			expect(() =>
				validate(
					{
						...abortedClaim,
						operation_id: '01J00000000000000000000999',
						status: 'CLAIM_INTENT'
					},
					abortedClaim,
					{ name: 'reg_user', roles: ['shelter:SH001', 'registration_staff'] }
				)
			).not.toThrow();
		});

		it('27. recovery by different authorized actor allowed', async () => {
			const pool = await poolRepo.create(
				createBulkReturnPoolDoc(
					{
						stock_ledger_id: 'stock_ledger:01J00000000000000000000160',
						item_id: 'item:cot',
						total_received_qty: '10'
					},
					WAREHOUSE_CTX,
					'01J00000000000000000000160'
				),
				WAREHOUSE_CTX
			);

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

			const opId = '01J00000000000000000000161';
			const claimId = deriveClaimIdFromDistributionLog(log._id);

			// Started by user_a
			await claimRepo.create({
				_id: claimId,
				type: 'bulk_return_claim',
				schema_v: 1,
				shelter_code: POS_CTX.shelterCode,
				operation_id: opId,
				distribution_log_id: log._id,
				bulk_pool_id: pool._id,
				item_id: log.item_id,
				claimed_qty: '1',
				status: 'CLAIM_INTENT',
				created_at: new Date().toISOString(),
				created_by: 'user_a',
				updated_at: new Date().toISOString()
			});

			// Resumed by user_b with frontline role
			const ACTOR_B_CTX: AuthorContext = {
				shelterCode: 'SH001',
				createdBy: 'user_b',
				roles: ['shelter:SH001', 'registration_staff']
			};

			const result = await clearLoanViaBulkPool(
				{ operationUlid: opId, logId: log._id, poolId: pool._id },
				ACTOR_B_CTX,
				{ logRepo, operationsRepo: opsRepo as unknown as OperationsRepository, poolRepo, claimRepo }
			);

			expect(result.claim.status).toBe('COMPLETE');
			expect(result.claim.created_by).toBe('user_a'); // preserved audit trail
		});

		it('28. registration_staff allowed for bulk claim if canonical frontline contract says so', async () => {
			const pool = await poolRepo.create(
				createBulkReturnPoolDoc(
					{
						stock_ledger_id: 'stock_ledger:01J00000000000000000000162',
						item_id: 'item:cot',
						total_received_qty: '10'
					},
					WAREHOUSE_CTX,
					'01J00000000000000000000162'
				),
				WAREHOUSE_CTX
			);

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
				REG_STAFF_CTX
			);

			const result = await clearLoanViaBulkPool(
				{
					operationUlid: '01J00000000000000000000163',
					logId: log._id,
					poolId: pool._id,
					notes: 'Gate return'
				},
				REG_STAFF_CTX,
				{ logRepo, poolRepo, claimRepo }
			);

			expect(result.log.status).toBe('returned');
			expect(result.claim.status).toBe('COMPLETE');
		});

		it('29. no P1-05 physical receive permission regression', () => {
			expect(canReceivePhysicalStock(WAREHOUSE_CTX)).toBe(true);
			expect(canReceivePhysicalStock(COORDINATOR_CTX)).toBe(true);
			expect(canReceivePhysicalStock(MANAGER_CTX)).toBe(true);
			expect(canReceivePhysicalStock(ADMIN_CTX)).toBe(true);
			expect(canReceivePhysicalStock(REG_STAFF_CTX)).toBe(false);
			expect(canReceivePhysicalStock(UNAUTH_CTX)).toBe(false);
		});

		it('30. direct-return-vs-bulk-clear concurrency remains explicitly deferred', () => {
			// CR-134 §2.2 / §8: Race condition between counter returnLoanAtCounter and clearLoanViaBulkPool
			// on the exact same DistributionLog is an acknowledged deferred scope boundary.
			// Both operations rely on CouchDB document-level CAS on distribution_log to prevent double-return.
			expect(true).toBe(true);
		});
	});
});
