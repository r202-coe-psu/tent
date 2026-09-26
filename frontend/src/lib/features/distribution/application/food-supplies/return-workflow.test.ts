import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$lib/features/catalog', () => ({
	catalogRepository: () => ({
		listItemMasters: async () =>
			['item:blanket', 'item:cot', 'item:crutches', 'item:fan', 'item:mat', 'item:other'].map(
				(_id) => ({ _id, base_unit: 'piece' })
			),
		listUnitsOfMeasure: async () => []
	}),
	itemMasterUnit: (item: { base_unit?: string; unit?: string }) =>
		item.base_unit ?? item.unit ?? 'piece',
	canonicalizeUnitCode: (value: unknown) => (value === 'ชิ้น' ? 'piece' : value)
}));
import type { AuthorContext } from '$lib/db/model';
import type {
	BulkReturnClaim,
	BulkReturnClaimStatus,
	BulkReturnPool,
	BulkReturnPoolInput,
	DistributionLog,
	DistributionLogInput,
	LoanReturnReservation,
	LoanReturnReservationStatus
} from '../../domain/food-supplies';
import {
	assertBulkReturnClaimTransition,
	assertLoanReturnReservationTransition,
	bulkReturnPoolDocSchema,
	positiveWholeQtySchema,
	createBulkReturnPool as createBulkReturnPoolDoc,
	createDistributionLog,
	createLoanReturnReservation,
	deriveClaimIdFromDistributionLog,
	deriveReservationIdFromDistributionLog,
	loanReturnReservationDocSchema
} from '../../domain/food-supplies';
import type {
	BulkReturnClaimRepository,
	BulkReturnPoolRepository,
	DistributionLogRepository,
	LoanReturnReservationRepository,
	ReinitializeLoanReturnReservationInput,
	RecordReturnInput,
	RecordClearInput
} from '../../data/food-supplies';
import {
	createStockLedger,
	deriveDeterministicLedgerId,
	type OperationsRepository,
	type StockLedger
} from '$lib/features/operations';
import {
	ConcurrencyCollisionError,
	InsufficientPoolQuotaError,
	ReservationSemanticMismatchError,
	StockIntegrityError,
	WorkflowAuthorizationError,
	WorkflowValidationError
} from './errors';
import { canReceivePhysicalStock } from './auth';
import { ConflictError } from '$lib/utils/errors';
import { addQty, parseQty } from '$lib/utils/qty';
import { endpointStore } from '$lib/stores/endpoint.svelte';
import { buildValidateDocUpdate } from '$lib/server/shelter-access-design';
import {
	abortAbandonedReturnReservation,
	abortReturnReservation,
	acquireReturnReservation,
	fenceReturnReservation,
	commitReturnReservation,
	clearLoanNonPhysical,
	clearLoanViaBulkPool,
	createBulkReturnPool,
	getReturnOperationState,
	returnLoanAtCounter
} from './return-workflow';

class InMemoryLogRepository implements DistributionLogRepository {
	logs = new Map<string, DistributionLog>();
	failNextRecordReturn: Error | null = null;

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
		if (this.failNextRecordReturn) {
			const error = this.failNextRecordReturn;
			this.failNextRecordReturn = null;
			throw error;
		}
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
	private pausedLedgerWrite: {
		started: () => void;
		wait: Promise<void>;
	} | null = null;

	pauseNextLedgerWrite(): { started: Promise<void>; release: () => void } {
		let startedResolve: () => void = () => undefined;
		let release: () => void = () => undefined;
		const started = new Promise<void>((resolve) => {
			startedResolve = resolve;
		});
		const wait = new Promise<void>((resolve) => {
			release = resolve;
		});
		this.pausedLedgerWrite = { started: startedResolve, wait };
		return { started, release };
	}

	async addLedgerEntry(entry: StockLedger): Promise<StockLedger> {
		const pausedWrite = this.pausedLedgerWrite;
		if (pausedWrite) {
			this.pausedLedgerWrite = null;
			pausedWrite.started();
			await pausedWrite.wait;
		}
		if (this.throwConflictOnNext) {
			this.throwConflictOnNext = false;
			throw new ConflictError();
		}
		const existing = this.ledger.find((candidate) => candidate._id === entry._id);
		if (existing) throw new ConflictError();
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

		const claimDec = parseQty(positiveWholeQtySchema.parse(claimQty));

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

class InMemoryReservationRepository implements LoanReturnReservationRepository {
	reservations = new Map<string, LoanReturnReservation>();
	failNextReinitializeWithConflict = false;
	failNextCommit = false;

	async create(reservation: LoanReturnReservation): Promise<LoanReturnReservation> {
		if (this.reservations.has(reservation._id)) {
			throw new ConflictError(`Conflict on doc ${reservation._id}`);
		}
		const parsed = loanReturnReservationDocSchema.parse(reservation);
		this.reservations.set(parsed._id, structuredClone(parsed));
		return structuredClone(parsed);
	}

	async get(reservationId: string): Promise<LoanReturnReservation | null> {
		const found = this.reservations.get(reservationId);
		if (!found) return null;
		const parsed = loanReturnReservationDocSchema.parse(found);
		return structuredClone(parsed);
	}

	async mutateCAS(
		reservationId: string,
		mutator: (current: LoanReturnReservation) => LoanReturnReservation
	): Promise<LoanReturnReservation> {
		const current = this.reservations.get(reservationId);
		if (!current) throw new Error(`Reservation ${reservationId} not found`);
		const next = mutator(structuredClone(current));
		if (this.failNextCommit && current.status === 'FENCED' && next.status === 'COMMITTED') {
			this.failNextCommit = false;
			throw new Error('Simulated reservation commit failure');
		}
		assertLoanReturnReservationTransition(current, next);
		const parsed = loanReturnReservationDocSchema.parse(next);
		this.reservations.set(reservationId, structuredClone(parsed));
		return structuredClone(parsed);
	}

	async mutateStatusCAS(
		reservationId: string,
		targetStatus: LoanReturnReservationStatus,
		notesOrCtx?: string | AuthorContext,
		maybeCtx?: AuthorContext
	): Promise<LoanReturnReservation> {
		void maybeCtx;
		const notes = typeof notesOrCtx === 'string' ? notesOrCtx : undefined;
		return this.mutateCAS(reservationId, (current) => ({
			...current,
			status: targetStatus,
			...(notes !== undefined ? { notes } : {}),
			updated_at: new Date().toISOString()
		}));
	}

	async reinitializeCAS(
		reservationId: string,
		input: ReinitializeLoanReturnReservationInput,
		ctx?: AuthorContext
	): Promise<LoanReturnReservation> {
		if (this.failNextReinitializeWithConflict) {
			this.failNextReinitializeWithConflict = false;
			throw new ConflictError(`Conflict on doc ${reservationId}`);
		}
		return this.mutateCAS(reservationId, (current) => {
			if (current.status !== 'ABORTED' && current.status !== 'COMMITTED') {
				throw new Error(
					`Cannot reinitialize reservation ${reservationId} in status ${current.status}; must be ABORTED or COMMITTED`
				);
			}
			return {
				...current,
				operation_id: input.operation_id,
				operation_by: input.operation_by ?? ctx?.createdBy ?? 'system',
				mode: input.mode,
				status: 'RESERVED' as const,
				qty_returned: input.qty_returned,
				return_condition: input.return_condition,
				bulk_pool_id: input.bulk_pool_id,
				claimed_qty: input.claimed_qty,
				clear_reason: input.clear_reason,
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
	let reservationRepo: InMemoryReservationRepository;
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
		endpointStore.markConnected();
		logRepo = new InMemoryLogRepository();
		opsRepo = new InMemoryOperationsRepository();
		poolRepo = new InMemoryPoolRepository();
		claimRepo = new InMemoryClaimRepository();
		reservationRepo = new InMemoryReservationRepository();
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
			{
				logRepo,
				operationsRepo: opsRepo as unknown as OperationsRepository,
				poolRepo,
				claimRepo,
				reservationRepo
			}
		);

		expect(result.log.status).toBe('returned');
		expect(result.ledgerEntryCreated).toBe(true);
		expect(opsRepo.ledger).toHaveLength(1);

		const ledgerEntry = opsRepo.ledger[0];
		expect(ledgerEntry.reason).toBe('receive');
		expect(ledgerEntry.ref_id).toBe(log._id);
		expect(ledgerEntry.qty).toBe('2');
		expect(ledgerEntry.unit).toBe('piece');
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
		await returnLoanAtCounter(
			log._id,
			{ qty_returned: '1', condition_on_return: 'READY' },
			POS_CTX,
			{
				logRepo,
				operationsRepo: opsRepo as unknown as OperationsRepository,
				poolRepo,
				claimRepo,
				reservationRepo
			}
		);
		expect(opsRepo.ledger).toHaveLength(1);

		// Retry
		const retry = await returnLoanAtCounter(
			log._id,
			{ qty_returned: '1', condition_on_return: 'READY' },
			POS_CTX,
			{
				logRepo,
				operationsRepo: opsRepo as unknown as OperationsRepository,
				poolRepo,
				claimRepo,
				reservationRepo
			}
		);
		expect(retry.ledgerEntryCreated).toBe(false);
		expect(opsRepo.ledger).toHaveLength(1);
	});

	it('reuses a zero prior return quantity for one counter receipt identity', async () => {
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

		for (const priorQtyReturned of ['0']) {
			logRepo.logs.set(log._id, {
				...log,
				status: 'active',
				qty_returned: priorQtyReturned
			});
			const result = await returnLoanAtCounter(
				log._id,
				{ qty_returned: '2', condition_on_return: 'READY' },
				POS_CTX,
				{
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
				}
			);

			expect(result.ledgerEntryCreated).toBe(priorQtyReturned === '0');
		}

		expect(opsRepo.ledger).toHaveLength(1);
		expect(opsRepo.ledger[0].qty).toBe('2');
	});

	it('accepts an idempotent routine-return replay', async () => {
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
		await returnLoanAtCounter(
			log._id,
			{ qty_returned: '1', condition_on_return: 'READY' },
			POS_CTX,
			{
				logRepo,
				operationsRepo: opsRepo as unknown as OperationsRepository,
				poolRepo,
				claimRepo,
				reservationRepo
			}
		);
		const returned = await logRepo.get(log._id);
		if (!returned) throw new Error('Expected returned distribution log');
		logRepo.logs.set(log._id, { ...returned, qty_returned: '1' });

		const replay = await returnLoanAtCounter(
			log._id,
			{ qty_returned: '1', condition_on_return: 'READY' },
			POS_CTX,
			{
				logRepo,
				operationsRepo: opsRepo as unknown as OperationsRepository,
				poolRepo,
				claimRepo,
				reservationRepo
			}
		);

		expect(replay.ledgerEntryCreated).toBe(false);
		expect(opsRepo.ledger).toHaveLength(1);
	});

	it('rejects a routine-return replay with a different quantity', async () => {
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
		await returnLoanAtCounter(
			log._id,
			{ qty_returned: '1', condition_on_return: 'READY' },
			POS_CTX,
			{
				logRepo,
				operationsRepo: opsRepo as unknown as OperationsRepository,
				poolRepo,
				claimRepo,
				reservationRepo
			}
		);
		const returned = await logRepo.get(log._id);
		if (!returned) throw new Error('Expected returned distribution log');
		logRepo.logs.set(log._id, { ...returned, qty_returned: '1' });

		await expect(
			returnLoanAtCounter(log._id, { qty_returned: '2', condition_on_return: 'READY' }, POS_CTX, {
				logRepo,
				operationsRepo: opsRepo as unknown as OperationsRepository,
				poolRepo,
				claimRepo,
				reservationRepo
			})
		).rejects.toBeInstanceOf(WorkflowValidationError);
		expect(opsRepo.ledger).toHaveLength(1);
	});

	it('rejects a routine-returned log whose physical receipt is missing or inconsistent', async () => {
		const missingReceipt = await logRepo.create(
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
		await logRepo.recordReturn(
			missingReceipt._id,
			{ qty_returned: '2', clear_reason: 'routine' },
			POS_CTX
		);

		await expect(
			returnLoanAtCounter(
				missingReceipt._id,
				{ qty_returned: '2', condition_on_return: 'READY' },
				POS_CTX,
				{
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
				}
			)
		).rejects.toBeInstanceOf(StockIntegrityError);

		const mismatchedReceipt = await logRepo.create(
			{
				ticket_id: 'requisition_ticket:01J00000000000000000000001',
				item_id: 'item:mat',
				qty: '2',
				recipient_type: 'evacuee',
				recipient_id: 'evacuee:01J00000000000000000000002',
				is_returnable: true,
				status: 'active',
				is_override: false
			},
			POS_CTX
		);
		await logRepo.recordReturn(
			mismatchedReceipt._id,
			{ qty_returned: '2', clear_reason: 'routine' },
			POS_CTX
		);
		opsRepo.ledger.push({
			_id: 'stock_ledger:01J00000000000000000000092',
			type: 'stock_ledger',
			schema_v: 4,
			shelter_code: POS_CTX.shelterCode,
			item_id: 'item:mat',
			qty: '1',
			unit: 'piece',
			reason: 'receive',
			ref_id: mismatchedReceipt._id,
			occurred_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
			created_by: POS_CTX.createdBy
		});

		await expect(
			returnLoanAtCounter(
				mismatchedReceipt._id,
				{ qty_returned: '2', condition_on_return: 'READY' },
				POS_CTX,
				{
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
				}
			)
		).rejects.toBeInstanceOf(StockIntegrityError);
		expect(opsRepo.ledger).toHaveLength(1);
	});

	it('writes one counter receipt when same-target returns race from the same prior state', async () => {
		const log = await logRepo.create(
			{
				ticket_id: 'requisition_ticket:01J00000000000000000000001',
				item_id: 'item:fan',
				qty: '10',
				recipient_type: 'evacuee',
				recipient_id: 'evacuee:01J00000000000000000000001',
				is_returnable: true,
				status: 'active',
				is_override: false
			},
			POS_CTX
		);
		const ledgerGate = opsRepo.pauseNextLedgerWrite();
		const winner = returnLoanAtCounter(
			log._id,
			{ qty_returned: '10', condition_on_return: 'READY' },
			POS_CTX,
			{
				logRepo,
				operationsRepo: opsRepo as unknown as OperationsRepository,
				poolRepo,
				claimRepo,
				reservationRepo
			}
		);
		await ledgerGate.started;

		const loser = returnLoanAtCounter(
			log._id,
			{ qty_returned: '10', condition_on_return: 'READY' },
			POS_CTX,
			{
				logRepo,
				operationsRepo: opsRepo as unknown as OperationsRepository,
				poolRepo,
				claimRepo,
				reservationRepo
			}
		);
		const loserResult = await Promise.allSettled([loser]);
		ledgerGate.release();
		const winnerResult = await Promise.allSettled([winner]);

		expect(opsRepo.ledger).toHaveLength(1);
		expect(opsRepo.ledger[0].qty).toBe('10');
		const finalLog = await logRepo.get(log._id);
		expect(finalLog?.status).toBe('returned');
		expect(finalLog?.qty_returned).toBe('10');
		expect(
			(await reservationRepo.get(deriveReservationIdFromDistributionLog(log._id)))?.status
		).toBe('COMMITTED');
		expect(winnerResult[0].status).toBe('fulfilled');
		expect(loserResult[0].status).toBe('fulfilled');
		if (winnerResult[0].status === 'fulfilled' && loserResult[0].status === 'fulfilled') {
			expect(
				[winnerResult[0].value, loserResult[0].value].filter((result) => result.ledgerEntryCreated)
			).toHaveLength(1);
		}
	});

	it('fails closed when competing counter returns use different targets from the same prior state', async () => {
		const log = await logRepo.create(
			{
				ticket_id: 'requisition_ticket:01J00000000000000000000001',
				item_id: 'item:fan',
				qty: '10',
				recipient_type: 'evacuee',
				recipient_id: 'evacuee:01J00000000000000000000001',
				is_returnable: true,
				status: 'active',
				is_override: false
			},
			POS_CTX
		);
		const opA = '01J00000000000000000000301';
		const opB = '01J00000000000000000000302';
		const ledgerGate = opsRepo.pauseNextLedgerWrite();
		const winner = returnLoanAtCounter(
			log._id,
			{ qty_returned: '2', condition_on_return: 'READY', operationUlid: opA },
			POS_CTX,
			{
				logRepo,
				operationsRepo: opsRepo as unknown as OperationsRepository,
				poolRepo,
				claimRepo,
				reservationRepo
			}
		);
		await ledgerGate.started;

		const loser = returnLoanAtCounter(
			log._id,
			{ qty_returned: '4', condition_on_return: 'READY', operationUlid: opB },
			POS_CTX,
			{
				logRepo,
				operationsRepo: opsRepo as unknown as OperationsRepository,
				poolRepo,
				claimRepo,
				reservationRepo
			}
		);
		const loserResult = await Promise.allSettled([loser]);
		ledgerGate.release();
		const winnerResult = await Promise.allSettled([winner]);

		expect(opsRepo.ledger).toHaveLength(1);
		expect(winnerResult[0].status).toBe('fulfilled');
		expect(loserResult[0].status).toBe('rejected');
		if (loserResult[0].status === 'rejected') {
			expect(loserResult[0].reason).toBeInstanceOf(ConcurrencyCollisionError);
		}
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

		// Simulate a crash after the deterministic ledger write but before the log CAS.
		logRepo.failNextRecordReturn = new Error('simulated recordReturn crash');
		await expect(
			returnLoanAtCounter(log._id, { qty_returned: '2', condition_on_return: 'READY' }, POS_CTX, {
				logRepo,
				operationsRepo: opsRepo as unknown as OperationsRepository,
				poolRepo,
				claimRepo,
				reservationRepo
			})
		).rejects.toThrow('simulated recordReturn crash');
		expect(opsRepo.ledger).toHaveLength(1);
		expect(log.status).toBe('active'); // Still active in DB

		// Retry return operation
		const retryResult = await returnLoanAtCounter(
			log._id,
			{ qty_returned: '2', condition_on_return: 'READY' },
			POS_CTX,
			{
				logRepo,
				operationsRepo: opsRepo as unknown as OperationsRepository,
				poolRepo,
				claimRepo,
				reservationRepo
			}
		);

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
			returnLoanAtCounter(log._id, { qty_returned: '2', condition_on_return: 'READY' }, POS_CTX, {
				logRepo,
				operationsRepo: failingOpsRepo,
				poolRepo,
				claimRepo,
				reservationRepo
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
			returnLoanAtCounter(log._id, { qty_returned: '5', condition_on_return: 'READY' }, POS_CTX, {
				logRepo,
				operationsRepo: opsRepo as unknown as OperationsRepository,
				poolRepo,
				claimRepo,
				reservationRepo
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
		const res1 = await returnLoanAtCounter(
			log._id,
			{ qty_returned: '2', condition_on_return: 'READY' },
			POS_CTX,
			{
				logRepo,
				operationsRepo: opsRepo as unknown as OperationsRepository,
				poolRepo,
				claimRepo,
				reservationRepo
			}
		);
		expect(res1.ledgerEntryCreated).toBe(true);
		expect(res1.log.status).toBe('partially_returned');
		expect(res1.log.qty_returned).toBe('2');
		expect(opsRepo.ledger).toHaveLength(1);
		expect(opsRepo.ledger[0].qty).toBe('2');

		// Partial return 2: 2 more items returned (cumulative 4)
		const res2 = await returnLoanAtCounter(
			log._id,
			{ qty_returned: '4', condition_on_return: 'READY' },
			POS_CTX,
			{
				logRepo,
				operationsRepo: opsRepo as unknown as OperationsRepository,
				poolRepo,
				claimRepo,
				reservationRepo
			}
		);
		expect(res2.ledgerEntryCreated).toBe(true);
		expect(res2.log.status).toBe('partially_returned');
		expect(res2.log.qty_returned).toBe('4');
		expect(opsRepo.ledger).toHaveLength(2);
		expect(opsRepo.ledger[1].qty).toBe('2'); // Delta was 2

		// Final return 3: remaining 1 item returned (cumulative 5)
		const res3 = await returnLoanAtCounter(
			log._id,
			{ qty_returned: '5', condition_on_return: 'READY' },
			POS_CTX,
			{
				logRepo,
				operationsRepo: opsRepo as unknown as OperationsRepository,
				poolRepo,
				claimRepo,
				reservationRepo
			}
		);
		expect(res3.ledgerEntryCreated).toBe(true);
		expect(res3.log.status).toBe('returned');
		expect(res3.log.qty_returned).toBe('5');
		expect(opsRepo.ledger).toHaveLength(3);
		expect(opsRepo.ledger[2].qty).toBe('1'); // Delta was 1

		// Total stock received across the 3 returns: 2 + 2 + 1 = 5
		const totalStock = opsRepo.ledger.reduce((acc, l) => addQty(acc, l.qty), '0');
		expect(totalStock).toBe('5');
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
				unit: 'piece',
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
				unit: 'piece',
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
			returnLoanAtCounter(log._id, { qty_returned: '3', condition_on_return: 'READY' }, POS_CTX, {
				logRepo,
				operationsRepo: opsRepo as unknown as OperationsRepository,
				poolRepo,
				claimRepo,
				reservationRepo
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

	it('recovers an in-flight partial return when physical receipt already equals target', async () => {
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
		await returnLoanAtCounter(
			log._id,
			{ qty_returned: '2', condition_on_return: 'READY' },
			POS_CTX,
			{
				logRepo,
				operationsRepo: opsRepo as unknown as OperationsRepository,
				poolRepo,
				claimRepo,
				reservationRepo
			}
		);

		logRepo.failNextRecordReturn = new Error('simulated partial return crash');
		await expect(
			returnLoanAtCounter(log._id, { qty_returned: '4', condition_on_return: 'READY' }, POS_CTX, {
				logRepo,
				operationsRepo: opsRepo as unknown as OperationsRepository,
				poolRepo,
				claimRepo,
				reservationRepo
			})
		).rejects.toThrow('simulated partial return crash');
		expect(opsRepo.ledger).toHaveLength(2);

		const result = await returnLoanAtCounter(
			log._id,
			{ qty_returned: '4', condition_on_return: 'READY' },
			POS_CTX,
			{
				logRepo,
				operationsRepo: opsRepo as unknown as OperationsRepository,
				poolRepo,
				claimRepo,
				reservationRepo
			}
		);

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
			unit: 'piece',
			reason: 'receive',
			ref_id: log._id,
			occurred_at: new Date().toISOString(),
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
			created_by: POS_CTX.createdBy
		});

		const result = await returnLoanAtCounter(
			log._id,
			{ qty_returned: '4', condition_on_return: 'READY' },
			POS_CTX,
			{
				logRepo,
				operationsRepo: opsRepo as unknown as OperationsRepository,
				poolRepo,
				claimRepo,
				reservationRepo
			}
		);

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
			{
				logRepo,
				operationsRepo: opsRepo as unknown as OperationsRepository,
				poolRepo,
				claimRepo,
				reservationRepo
			}
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
			{
				logRepo,
				operationsRepo: opsRepo as unknown as OperationsRepository,
				poolRepo,
				claimRepo,
				reservationRepo
			}
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
			clearLoanNonPhysical(log._id, { clear_reason: 'lost', notes: '   ' }, POS_CTX, {
				logRepo,
				operationsRepo: opsRepo as unknown as OperationsRepository,
				poolRepo,
				claimRepo,
				reservationRepo
			})
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
			{
				logRepo,
				operationsRepo: opsRepo as unknown as OperationsRepository,
				poolRepo,
				claimRepo,
				reservationRepo
			}
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
			total_received_qty: '2',
			ticket_id: 'requisition_ticket:01J00000000000000000000001',
			shift_id: 'shift-A'
		};
		poolRepo.failNextCreate = true;

		await expect(
			createBulkReturnPool(input, POS_CTX, {
				logRepo,
				operationsRepo: opsRepo as unknown as OperationsRepository,
				poolRepo,
				claimRepo,
				reservationRepo
			})
		).rejects.toThrow('simulated pool write failure');
		expect(opsRepo.ledger).toHaveLength(1);

		const recovered = await createBulkReturnPool(input, POS_CTX, {
			logRepo,
			operationsRepo: opsRepo as unknown as OperationsRepository,
			poolRepo,
			claimRepo,
			reservationRepo
		});
		expect(recovered._id).toBe('bulk_return_pool:01J00000000000000000000003');
		expect(recovered.stock_ledger_id).toBe('stock_ledger:01J00000000000000000000003');
		expect(opsRepo.ledger).toHaveLength(1);
		expect(opsRepo.ledger[0].qty).toBe('2');
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
				poolRepo,
				claimRepo,
				reservationRepo
			})
		).rejects.toThrow('simulated pool write failure');

		const recovered = await createBulkReturnPool(input, WAREHOUSE_CTX, {
			logRepo,
			operationsRepo: opsRepo as unknown as OperationsRepository,
			poolRepo,
			claimRepo,
			reservationRepo
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
			poolRepo,
			claimRepo,
			reservationRepo
		});
		const replay = await createBulkReturnPool(input, POS_CTX, {
			logRepo,
			operationsRepo: opsRepo as unknown as OperationsRepository,
			poolRepo,
			claimRepo,
			reservationRepo
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
			poolRepo,
			claimRepo,
			reservationRepo
		});

		const replay = await createBulkReturnPool(input, WAREHOUSE_CTX, {
			logRepo,
			operationsRepo: opsRepo as unknown as OperationsRepository,
			poolRepo,
			claimRepo,
			reservationRepo
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
			poolRepo,
			claimRepo,
			reservationRepo
		});

		await expect(
			createBulkReturnPool({ ...input, total_received_qty: '4' }, POS_CTX, {
				logRepo,
				operationsRepo: opsRepo as unknown as OperationsRepository,
				poolRepo,
				claimRepo,
				reservationRepo
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
			poolRepo,
			claimRepo,
			reservationRepo
		});

		await expect(
			createBulkReturnPool(
				{ ...input, ticket_id: 'requisition_ticket:01J00000000000000000000009' },
				POS_CTX,
				{
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
				}
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
			unit: 'piece',
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
				{
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
				}
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
			unit: 'piece',
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
				{
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
				}
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
				{
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
				}
			)
		).rejects.toBeInstanceOf(StockIntegrityError);
		expect(opsRepo.ledger).toHaveLength(0);
	});

	it('rejects a malformed stable operation ULID before writing', async () => {
		await expect(
			createBulkReturnPool(
				{ operationUlid: 'not-a-ulid', item_id: 'item:cot', total_received_qty: '3' },
				POS_CTX,
				{
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
				}
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
			{
				logRepo,
				operationsRepo: opsRepo as unknown as OperationsRepository,
				poolRepo,
				claimRepo,
				reservationRepo
			}
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
			{
				logRepo,
				operationsRepo: opsRepo as unknown as OperationsRepository,
				poolRepo,
				claimRepo,
				reservationRepo
			}
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
					unit: 'piece',
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
				poolRepo,
				claimRepo,
				reservationRepo
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
				unit: 'piece',
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
					{
						logRepo,
						operationsRepo: opsRepo as unknown as OperationsRepository,
						poolRepo,
						claimRepo,
						reservationRepo
					}
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
					{
						logRepo,
						operationsRepo: opsRepo as unknown as OperationsRepository,
						poolRepo,
						claimRepo,
						reservationRepo
					}
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
						{
							logRepo,
							operationsRepo: opsRepo as unknown as OperationsRepository,
							poolRepo,
							claimRepo,
							reservationRepo
						}
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
						{
							logRepo,
							operationsRepo: opsRepo as unknown as OperationsRepository,
							poolRepo,
							claimRepo,
							reservationRepo
						}
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
						{
							logRepo,
							operationsRepo: opsRepo as unknown as OperationsRepository,
							poolRepo,
							claimRepo,
							reservationRepo
						}
					);
					expect(result.log.status, `${name} should succeed`).toBe('returned');
					expect(result.ledgerEntryCreated).toBe(true);

					// Also test bulk pool creation
					const poolUlid = `01J${ulidSuffix.slice(3)}`;
					const pool = await createBulkReturnPool(
						{ operationUlid: poolUlid, item_id: 'item:mat', total_received_qty: '5' },
						ctx,
						{
							logRepo,
							operationsRepo: opsRepo as unknown as OperationsRepository,
							poolRepo,
							claimRepo,
							reservationRepo
						}
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
					{
						logRepo,
						operationsRepo: opsRepo as unknown as OperationsRepository,
						poolRepo,
						claimRepo,
						reservationRepo
					}
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
					{
						logRepo,
						operationsRepo: opsRepo as unknown as OperationsRepository,
						poolRepo,
						claimRepo,
						reservationRepo
					}
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
					{ logRepo, poolRepo, claimRepo, reservationRepo }
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
					{ logRepo, poolRepo, claimRepo, reservationRepo }
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
				{
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
				}
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
				{
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
				}
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
				{
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
				}
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
					claimRepo,
					reservationRepo
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
				{
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
				}
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
				{
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
				}
			);
			expect(res1.claim.status).toBe('COMPLETE');
			expect(res1.pool.claimed_qty).toBe('1');
			expect(res1.pool.unclaimed_quota).toBe('9');

			// Replay with exact same operationUlid
			const res2 = await clearLoanViaBulkPool(
				{ operationUlid: opId, logId: log._id, poolId: pool._id },
				POS_CTX,
				{
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
				}
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
				{
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
				}
			);

			// Competing operation with different ULID fails closed
			await expect(
				clearLoanViaBulkPool({ operationUlid: opB, logId: log._id, poolId: pool._id }, POS_CTX, {
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
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
				{
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
				}
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
				{
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
				}
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
				{
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
				}
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
				{
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
				}
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
				{
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
				}
			);
			await clearLoanViaBulkPool(
				{ operationUlid: opId, logId: log._id, poolId: pool._id },
				POS_CTX,
				{
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
				}
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
				{
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
				}
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
					claimRepo,
					reservationRepo
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
					claimRepo,
					reservationRepo
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
						claimRepo,
						reservationRepo
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
					claimRepo,
					reservationRepo
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
				{
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
				}
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
				{
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
				}
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
						claimRepo,
						reservationRepo
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
				{
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
				}
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
				expect(() =>
					validate({ ...claimDoc, created_by: userCtx.name }, null, userCtx)
				).not.toThrow();
			}

			expectForbidden(
				() =>
					validate({ ...claimDoc, created_by: 'unauth' }, null, {
						name: 'unauth',
						roles: ['shelter:SH001', 'kitchen_staff']
					}),
				/Only registration staff, supply coordinator, shelter manager, or system admin can manage bulk return claims/
			);
			expectForbidden(
				() =>
					validate({ ...claimDoc, created_by: 'reg', shelter_code: 'SH002' }, null, {
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
				{
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
				}
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
				{ logRepo, poolRepo, claimRepo, reservationRepo }
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

		it('30. rejects a counter return after bulk clear without a second physical receipt', async () => {
			const pool = await createBulkReturnPool(
				{
					operationUlid: '01J00000000000000000000164',
					item_id: 'item:cot',
					total_received_qty: '1'
				},
				POS_CTX,
				{
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
				}
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
			await clearLoanViaBulkPool(
				{
					operationUlid: '01J00000000000000000000165',
					logId: log._id,
					poolId: pool._id
				},
				POS_CTX,
				{
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
				}
			);

			await expect(
				returnLoanAtCounter(log._id, { qty_returned: '1', condition_on_return: 'READY' }, POS_CTX, {
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
				})
			).rejects.toBeInstanceOf(WorkflowValidationError);
			expect(opsRepo.ledger).toHaveLength(1);
		});

		describe('CR-134 R1: Physical Return vs Bulk Claim Interlock & Freshness Guard', () => {
			it('Test A — physical return succeeds when no bulk claim exists', async () => {
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
					{ qty_returned: '2', condition_on_return: 'READY' },
					POS_CTX,
					{
						logRepo,
						operationsRepo: opsRepo as unknown as OperationsRepository,
						poolRepo,
						claimRepo,
						reservationRepo
					}
				);

				expect(result.log.status).toBe('returned');
				expect(result.log.qty_returned).toBe('2');
				expect(result.ledgerEntryCreated).toBe(true);
				expect(opsRepo.ledger).toHaveLength(1);
			});

			it('Test B — physical return fails closed while CLAIM_INTENT exists', async () => {
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
				const claimId = deriveClaimIdFromDistributionLog(log._id);
				await claimRepo.create({
					_id: claimId,
					type: 'bulk_return_claim',
					schema_v: 1,
					shelter_code: POS_CTX.shelterCode,
					operation_id: '01J00000000000000000000170',
					distribution_log_id: log._id,
					bulk_pool_id: 'bulk_return_pool:01J00000000000000000000099',
					item_id: log.item_id,
					claimed_qty: '2',
					status: 'CLAIM_INTENT',
					created_at: new Date().toISOString(),
					created_by: POS_CTX.createdBy,
					updated_at: new Date().toISOString()
				});

				await expect(
					returnLoanAtCounter(
						log._id,
						{ qty_returned: '2', condition_on_return: 'READY' },
						POS_CTX,
						{
							logRepo,
							operationsRepo: opsRepo as unknown as OperationsRepository,
							poolRepo,
							claimRepo,
							reservationRepo
						}
					)
				).rejects.toBeInstanceOf(ConcurrencyCollisionError);

				// Assert no side effects
				expect(opsRepo.ledger).toHaveLength(0);
				const unchangedLog = await logRepo.get(log._id);
				expect(unchangedLog?.status).toBe('active');
				expect(unchangedLog?.qty_returned).toBeUndefined();
			});

			it('Test C — physical return fails closed while POOL_CLAIMED exists', async () => {
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
				const claimId = deriveClaimIdFromDistributionLog(log._id);
				await claimRepo.create({
					_id: claimId,
					type: 'bulk_return_claim',
					schema_v: 1,
					shelter_code: POS_CTX.shelterCode,
					operation_id: '01J00000000000000000000171',
					distribution_log_id: log._id,
					bulk_pool_id: 'bulk_return_pool:01J00000000000000000000099',
					item_id: log.item_id,
					claimed_qty: '2',
					status: 'POOL_CLAIMED',
					created_at: new Date().toISOString(),
					created_by: POS_CTX.createdBy,
					updated_at: new Date().toISOString()
				});

				await expect(
					returnLoanAtCounter(
						log._id,
						{ qty_returned: '2', condition_on_return: 'READY' },
						POS_CTX,
						{
							logRepo,
							operationsRepo: opsRepo as unknown as OperationsRepository,
							poolRepo,
							claimRepo,
							reservationRepo
						}
					)
				).rejects.toBeInstanceOf(ConcurrencyCollisionError);

				// Assert no side effects
				expect(opsRepo.ledger).toHaveLength(0);
				const unchangedLog = await logRepo.get(log._id);
				expect(unchangedLog?.status).toBe('active');
				expect(unchangedLog?.qty_returned).toBeUndefined();
			});

			it('Test D — physical return is permitted when claim is ABORTED', async () => {
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

				const claimId = deriveClaimIdFromDistributionLog(log._id);
				await claimRepo.create({
					_id: claimId,
					type: 'bulk_return_claim',
					schema_v: 1,
					shelter_code: POS_CTX.shelterCode,
					operation_id: '01J00000000000000000000172',
					distribution_log_id: log._id,
					bulk_pool_id: 'bulk_return_pool:01J00000000000000000000099',
					item_id: log.item_id,
					claimed_qty: '2',
					status: 'ABORTED',
					created_at: new Date().toISOString(),
					created_by: POS_CTX.createdBy,
					updated_at: new Date().toISOString()
				});

				const result = await returnLoanAtCounter(
					log._id,
					{ qty_returned: '2', condition_on_return: 'READY' },
					POS_CTX,
					{
						logRepo,
						operationsRepo: opsRepo as unknown as OperationsRepository,
						poolRepo,
						claimRepo,
						reservationRepo
					}
				);

				expect(result.log.status).toBe('returned');
				expect(result.log.qty_returned).toBe('2');
				expect(opsRepo.ledger).toHaveLength(1);
			});

			it('Test E — physical return on COMPLETE loan is rejected by terminal semantics', async () => {
				const log = await logRepo.create(
					{
						ticket_id: 'requisition_ticket:01J00000000000000000000001',
						item_id: 'item:fan',
						qty: '2',
						recipient_type: 'evacuee',
						recipient_id: 'evacuee:01J00000000000000000000001',
						is_returnable: true,
						status: 'returned',
						clear_reason: 'bulk_dropoff',
						qty_returned: '2',
						is_override: false
					},
					POS_CTX
				);
				// createDistributionLog normalizes new loans to active; install the
				// canonical terminal state explicitly for this rejection fixture.
				logRepo.logs.set(log._id, {
					...log,
					status: 'returned',
					clear_reason: 'bulk_dropoff',
					qty_returned: '2',
					returned_at: new Date().toISOString(),
					returned_by: POS_CTX.createdBy
				});

				const claimId = deriveClaimIdFromDistributionLog(log._id);
				await claimRepo.create({
					_id: claimId,
					type: 'bulk_return_claim',
					schema_v: 1,
					shelter_code: POS_CTX.shelterCode,
					operation_id: '01J00000000000000000000173',
					distribution_log_id: log._id,
					bulk_pool_id: 'bulk_return_pool:01J00000000000000000000099',
					item_id: log.item_id,
					claimed_qty: '2',
					status: 'COMPLETE',
					created_at: new Date().toISOString(),
					created_by: POS_CTX.createdBy,
					updated_at: new Date().toISOString()
				});

				await expect(
					returnLoanAtCounter(
						log._id,
						{ qty_returned: '2', condition_on_return: 'READY' },
						POS_CTX,
						{
							logRepo,
							operationsRepo: opsRepo as unknown as OperationsRepository,
							poolRepo,
							claimRepo,
							reservationRepo
						}
					)
				).rejects.toBeInstanceOf(WorkflowValidationError);

				expect(opsRepo.ledger).toHaveLength(0);
			});

			it('detects concurrent loan modification before pool mutation and aborts claim with zero quota consumed', async () => {
				const pool = await poolRepo.create(
					createBulkReturnPoolDoc(
						{
							stock_ledger_id: 'stock_ledger:01J00000000000000000000174',
							item_id: 'item:cot',
							total_received_qty: '10'
						},
						WAREHOUSE_CTX,
						'01J00000000000000000000174'
					),
					WAREHOUSE_CTX
				);

				const log = await logRepo.create(
					{
						ticket_id: 'requisition_ticket:01J00000000000000000000001',
						item_id: 'item:cot',
						qty: '4',
						recipient_type: 'evacuee',
						recipient_id: 'evacuee:01J00000000000000000000001',
						is_returnable: true,
						status: 'active',
						is_override: false
					},
					POS_CTX
				);

				const opId = '01J00000000000000000000175';
				const claimId = deriveClaimIdFromDistributionLog(log._id);
				const ledgerCountBefore = opsRepo.ledger.length;

				// Pause the authoritative reread after CLAIM_INTENT exists. This
				// models a real concurrent change between the initial snapshot and
				// the pre-quota freshness check.
				let freshReadStartedResolve: () => void = () => undefined;
				let releaseFreshRead: () => void = () => undefined;
				const freshReadStarted = new Promise<void>((resolve) => {
					freshReadStartedResolve = resolve;
				});
				const freshReadGate = new Promise<void>((resolve) => {
					releaseFreshRead = resolve;
				});
				const originalGet = logRepo.get.bind(logRepo);
				let logReadCount = 0;
				logRepo.get = async (logId) => {
					logReadCount += 1;
					if (logReadCount === 2) {
						freshReadStartedResolve();
						await freshReadGate;
					}
					return originalGet(logId);
				};

				const bulkAttempt = clearLoanViaBulkPool(
					{ operationUlid: opId, logId: log._id, poolId: pool._id },
					POS_CTX,
					{
						logRepo,
						operationsRepo: opsRepo as unknown as OperationsRepository,
						poolRepo,
						claimRepo,
						reservationRepo
					}
				);
				await freshReadStarted;

				const claimBeforeChange = await claimRepo.get(claimId);
				expect(claimBeforeChange?.status).toBe('CLAIM_INTENT');
				await logRepo.recordReturn(
					log._id,
					{
						qty_returned: '1',
						clear_reason: 'routine',
						condition_on_return: 'READY'
					},
					POS_CTX
				);
				releaseFreshRead();

				await expect(bulkAttempt).rejects.toBeInstanceOf(ConcurrencyCollisionError);

				// Verify claim transitioned to ABORTED
				const claimAfter = await claimRepo.get(claimId);
				expect(claimAfter?.status).toBe('ABORTED');

				// Verify pool quota was NOT deducted (total 10, claimed 0, unclaimed 10)
				const poolAfter = await poolRepo.get(pool._id);
				expect(poolAfter?.claimed_qty).toBe('0');
				expect(poolAfter?.unclaimed_quota).toBe('10');
				expect(poolAfter?.claim_ids ?? []).not.toContain(claimId);

				// Verify zero new StockLedger entries
				expect(opsRepo.ledger.length).toBe(ledgerCountBefore);
			});

			it('recovery: retry after CLAIM_INTENT continues forward when log is unchanged', async () => {
				const pool = await poolRepo.create(
					createBulkReturnPoolDoc(
						{
							stock_ledger_id: 'stock_ledger:01J00000000000000000000176',
							item_id: 'item:cot',
							total_received_qty: '10'
						},
						WAREHOUSE_CTX,
						'01J00000000000000000000176'
					),
					WAREHOUSE_CTX
				);

				const log = await logRepo.create(
					{
						ticket_id: 'requisition_ticket:01J00000000000000000000001',
						item_id: 'item:cot',
						qty: '3',
						recipient_type: 'evacuee',
						recipient_id: 'evacuee:01J00000000000000000000001',
						is_returnable: true,
						status: 'active',
						is_override: false
					},
					POS_CTX
				);

				const opId = '01J00000000000000000000177';
				const claimId = deriveClaimIdFromDistributionLog(log._id);

				// Crash simulation: CLAIM_INTENT persisted but process crashed before pool effect
				await claimRepo.create({
					_id: claimId,
					type: 'bulk_return_claim',
					schema_v: 1,
					shelter_code: POS_CTX.shelterCode,
					operation_id: opId,
					distribution_log_id: log._id,
					bulk_pool_id: pool._id,
					item_id: log.item_id,
					claimed_qty: '3',
					status: 'CLAIM_INTENT',
					created_at: new Date().toISOString(),
					created_by: POS_CTX.createdBy,
					updated_at: new Date().toISOString()
				});

				// Retry with same operationUlid: log is still fresh
				const result = await clearLoanViaBulkPool(
					{ operationUlid: opId, logId: log._id, poolId: pool._id },
					POS_CTX,
					{
						logRepo,
						operationsRepo: opsRepo as unknown as OperationsRepository,
						poolRepo,
						claimRepo,
						reservationRepo
					}
				);

				expect(result.claim.status).toBe('COMPLETE');
				expect(result.pool.claimed_qty).toBe('3');
				expect(result.log.status).toBe('returned');
				expect(result.log.clear_reason).toBe('bulk_dropoff');
			});

			it('recovery: retry after pool claim does NOT consume quota twice', async () => {
				const pool = await poolRepo.create(
					createBulkReturnPoolDoc(
						{
							stock_ledger_id: 'stock_ledger:01J00000000000000000000178',
							item_id: 'item:cot',
							total_received_qty: '10'
						},
						WAREHOUSE_CTX,
						'01J00000000000000000000178'
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

				const opId = '01J00000000000000000000179';
				const claimId = deriveClaimIdFromDistributionLog(log._id);

				// Claim already in POOL_CLAIMED and pool already has claimId
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
					status: 'POOL_CLAIMED',
					created_at: new Date().toISOString(),
					created_by: POS_CTX.createdBy,
					updated_at: new Date().toISOString()
				});

				await poolRepo.claimQuota(pool._id, claimId, '2', WAREHOUSE_CTX);
				const poolBeforeRetry = await poolRepo.get(pool._id);
				expect(poolBeforeRetry?.claimed_qty).toBe('2');

				// Retry clearLoanViaBulkPool
				const result = await clearLoanViaBulkPool(
					{ operationUlid: opId, logId: log._id, poolId: pool._id },
					POS_CTX,
					{
						logRepo,
						operationsRepo: opsRepo as unknown as OperationsRepository,
						poolRepo,
						claimRepo,
						reservationRepo
					}
				);

				expect(result.claim.status).toBe('COMPLETE');
				expect(result.pool.claimed_qty).toBe('2'); // unchanged!
				expect(result.log.status).toBe('returned');
			});
		});

		describe('CR-134 R3: Shared Return Reservation Protocol & Controlled Concurrency', () => {
			it('Test RACE-A: Bulk acquires shared reservation first, physical rejected before ledger write, bulk converges', async () => {
				const pool = await poolRepo.create(
					createBulkReturnPoolDoc(
						{
							stock_ledger_id: 'stock_ledger:01J00000000000000000000201',
							item_id: 'item:cot',
							total_received_qty: '10'
						},
						WAREHOUSE_CTX,
						'01J00000000000000000000201'
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

				const opBulk = '01J00000000000000000000202';
				const opPhys = '01J00000000000000000000203';
				const deps = {
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
				};

				// 1. Bulk workflow acquires shared reservation first
				const resDoc = await acquireReturnReservation(
					{
						logId: log._id,
						mode: 'BULK',
						operationId: opBulk,
						bulk_pool_id: pool._id,
						claimed_qty: '2'
					},
					POS_CTX,
					deps
				);
				expect(resDoc.status).toBe('RESERVED');
				expect(resDoc.mode).toBe('BULK');

				// 2. Pause bulk. Start physical return workflow.
				const ledgerCountBefore = opsRepo.ledger.length; // 1 from pool creation
				await expect(
					returnLoanAtCounter(
						log._id,
						{ qty_returned: '2', condition_on_return: 'READY', operationUlid: opPhys },
						POS_CTX,
						deps
					)
				).rejects.toBeInstanceOf(ConcurrencyCollisionError);

				// Physical produces zero stock ledger side effects (delta = 0)
				expect(opsRepo.ledger).toHaveLength(ledgerCountBefore);
				const unchangedLog = await logRepo.get(log._id);
				expect(unchangedLog?.status).toBe('active');
				expect(unchangedLog?.qty_returned).toBeUndefined();

				// 3. Resume bulk workflow. It completes cleanly.
				const bulkResult = await clearLoanViaBulkPool(
					{ operationUlid: opBulk, logId: log._id, poolId: pool._id },
					POS_CTX,
					deps
				);

				expect(bulkResult.claim.status).toBe('COMPLETE');
				expect(bulkResult.pool.claimed_qty).toBe('2');
				expect(bulkResult.pool.unclaimed_quota).toBe('8');
				expect(bulkResult.log.status).toBe('returned');
				expect(bulkResult.log.clear_reason).toBe('bulk_dropoff');
				// Zero additional StockLedger writes from bulk claim (Zero-Second Restock)
				expect(opsRepo.ledger).toHaveLength(ledgerCountBefore);
				// Shared reservation is committed
				const finalRes = await reservationRepo.get(deriveReservationIdFromDistributionLog(log._id));
				expect(finalRes?.status).toBe('COMMITTED');
			});

			it('Test RACE-B: Physical acquires shared reservation first, bulk rejected before pool quota mutation, physical completes', async () => {
				const pool = await poolRepo.create(
					createBulkReturnPoolDoc(
						{
							stock_ledger_id: 'stock_ledger:01J00000000000000000000204',
							item_id: 'item:cot',
							total_received_qty: '10'
						},
						WAREHOUSE_CTX,
						'01J00000000000000000000204'
					),
					WAREHOUSE_CTX
				);

				const log = await logRepo.create(
					{
						ticket_id: 'requisition_ticket:01J00000000000000000000001',
						item_id: 'item:cot',
						qty: '3',
						recipient_type: 'evacuee',
						recipient_id: 'evacuee:01J00000000000000000000001',
						is_returnable: true,
						status: 'active',
						is_override: false
					},
					POS_CTX
				);

				const opPhys = '01J00000000000000000000205';
				const opBulk = '01J00000000000000000000206';
				const deps = {
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
				};

				// 1. Physical acquires shared reservation first
				const resDoc = await acquireReturnReservation(
					{
						logId: log._id,
						mode: 'PHYSICAL',
						operationId: opPhys,
						qty_returned: '3',
						return_condition: 'READY'
					},
					POS_CTX,
					deps
				);
				expect(resDoc.status).toBe('RESERVED');
				expect(resDoc.mode).toBe('PHYSICAL');

				// 2. Pause physical BEFORE irreversible receipt. Start bulk return workflow.
				await expect(
					clearLoanViaBulkPool(
						{ operationUlid: opBulk, logId: log._id, poolId: pool._id },
						POS_CTX,
						deps
					)
				).rejects.toBeInstanceOf(ConcurrencyCollisionError);

				// Bulk was rejected BEFORE pool quota mutation or claim creation
				const poolAfter = await poolRepo.get(pool._id);
				expect(poolAfter?.claimed_qty).toBe('0');
				expect(poolAfter?.unclaimed_quota).toBe('10');
				expect(poolAfter?.claim_ids ?? []).toHaveLength(0);
				const claimAfter = await claimRepo.get(deriveClaimIdFromDistributionLog(log._id));
				expect(claimAfter).toBeNull();

				// 3. Resume physical workflow with same operationUlid
				const physResult = await returnLoanAtCounter(
					log._id,
					{ qty_returned: '3', condition_on_return: 'READY', operationUlid: opPhys },
					POS_CTX,
					deps
				);

				expect(physResult.log.status).toBe('returned');
				expect(physResult.log.qty_returned).toBe('3');
				expect(physResult.ledgerEntryCreated).toBe(true);
				// Exactly one physical receipt created
				const receipts = opsRepo.ledger.filter((e) => e.ref_id === log._id);
				expect(receipts).toHaveLength(1);
				expect(receipts[0].qty).toBe('3');
				// Reservation is committed
				const finalRes = await reservationRepo.get(deriveReservationIdFromDistributionLog(log._id));
				expect(finalRes?.status).toBe('COMMITTED');
			});

			it('Test Simultaneous: Concurrent acquisition attempts result in exactly one winner and zero side effects for loser', async () => {
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

				const opPhys = '01J00000000000000000000207';
				const opBulk = '01J00000000000000000000208';
				const deps = {
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
				};

				const [rPhys, rBulk] = await Promise.allSettled([
					acquireReturnReservation(
						{
							logId: log._id,
							mode: 'PHYSICAL',
							operationId: opPhys,
							qty_returned: '2',
							return_condition: 'READY'
						},
						POS_CTX,
						deps
					),
					acquireReturnReservation(
						{
							logId: log._id,
							mode: 'BULK',
							operationId: opBulk,
							bulk_pool_id: 'bulk_return_pool:01J00000000000000000000201',
							claimed_qty: '2'
						},
						POS_CTX,
						deps
					)
				]);

				const fulfilled = [rPhys, rBulk].filter((r) => r.status === 'fulfilled');
				const rejected = [rPhys, rBulk].filter((r) => r.status === 'rejected');

				expect(fulfilled).toHaveLength(1);
				expect(rejected).toHaveLength(1);
				expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
					ConcurrencyCollisionError
				);

				// Authoritative reservation is owned exclusively by the winner
				const res = await reservationRepo.get(deriveReservationIdFromDistributionLog(log._id));
				expect(res?.status).toBe('RESERVED');
				const winnerMode = (fulfilled[0] as PromiseFulfilledResult<LoanReturnReservation>).value
					.mode;
				expect(res?.mode).toBe(winnerMode);
			});

			it('Abandoned Session: Operator B discovers pre-effect abandoned bulk reservation and aborts safely without knowing token', async () => {
				const pool = await poolRepo.create(
					createBulkReturnPoolDoc(
						{
							stock_ledger_id: 'stock_ledger:01J00000000000000000000209',
							item_id: 'item:cot',
							total_received_qty: '10'
						},
						WAREHOUSE_CTX,
						'01J00000000000000000000209'
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

				const opA = '01J00000000000000000000210';
				const OPERATOR_A_CTX: AuthorContext = { ...POS_CTX, createdBy: 'operator_a' };
				const OPERATOR_B_CTX: AuthorContext = {
					...POS_CTX,
					createdBy: 'operator_b',
					roles: ['shelter:SH001', 'shelter_manager']
				};
				const deps = {
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
				};

				// Operator A begins bulk reservation and creates CLAIM_INTENT, then session drops
				await acquireReturnReservation(
					{
						logId: log._id,
						mode: 'BULK',
						operationId: opA,
						bulk_pool_id: pool._id,
						claimed_qty: '2'
					},
					OPERATOR_A_CTX,
					deps
				);
				const claimId = deriveClaimIdFromDistributionLog(log._id);
				await claimRepo.create({
					_id: claimId,
					type: 'bulk_return_claim',
					schema_v: 1,
					shelter_code: OPERATOR_A_CTX.shelterCode,
					operation_id: opA,
					distribution_log_id: log._id,
					bulk_pool_id: pool._id,
					item_id: log.item_id,
					claimed_qty: '2',
					status: 'CLAIM_INTENT',
					created_at: new Date().toISOString(),
					created_by: OPERATOR_A_CTX.createdBy,
					updated_at: new Date().toISOString()
				});

				// Operator B opens dialog in a new session (knows ONLY logId, NOT opA)
				const state = await getReturnOperationState(log._id, OPERATOR_B_CTX, deps);
				expect(state.phase).toBe('PRE_EFFECT_ABORTABLE');
				expect(state.canAbort).toBe(true);
				expect(state.canResume).toBe(true);
				expect(state.reservation?.operation_id).toBe(opA);

				// Operator B aborts the abandoned reservation safely
				const abortedRes = await abortAbandonedReturnReservation(log._id, OPERATOR_B_CTX, deps);
				expect(abortedRes.status).toBe('ABORTED');
				// Operator A's provenance is preserved on reservation document (Rule 16)
				expect(abortedRes.created_by).toBe('operator_a');

				// Claim doc is also aborted
				const abortedClaim = await claimRepo.get(claimId);
				expect(abortedClaim?.status).toBe('ABORTED');
				expect(abortedClaim?.created_by).toBe('operator_a'); // Rule 15 preserved

				// Loan is now completely free to be returned by Operator B with a brand-new operationUlid
				const opB = '01J00000000000000000000211';
				const normalResult = await returnLoanAtCounter(
					log._id,
					{ qty_returned: '2', condition_on_return: 'READY', operationUlid: opB },
					OPERATOR_B_CTX,
					deps
				);
				expect(normalResult.log.status).toBe('returned');
				expect(normalResult.log.qty_returned).toBe('2');
				expect(normalResult.ledgerEntryCreated).toBe(true);
			});

			it('Abandoned Session: Irreversible effect rejects safe abort and requires forward recovery', async () => {
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

				const opA = '01J00000000000000000000212';
				const OPERATOR_A_CTX: AuthorContext = { ...POS_CTX, createdBy: 'operator_a' };
				const OPERATOR_B_CTX: AuthorContext = { ...POS_CTX, createdBy: 'operator_b' };
				const deps = {
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
				};

				// Operator A acquires reservation and writes StockLedger receipt, then crashes before log recordReturn
				await acquireReturnReservation(
					{
						logId: log._id,
						mode: 'PHYSICAL',
						operationId: opA,
						qty_returned: '2',
						return_condition: 'READY'
					},
					OPERATOR_A_CTX,
					deps
				);
				const receiptId = await deriveDeterministicLedgerId('counter_return', log._id, 'from', '0');
				await opsRepo.addLedgerEntry(
					createStockLedger(
						{
							item_id: log.item_id,
							qty: '2',
							unit: 'piece',
							reason: 'receive',
							ref_id: log._id,
							lot: { note: 'counter_loan_return' }
						},
						OPERATOR_A_CTX,
						receiptId
					)
				);
				expect(opsRepo.ledger).toHaveLength(1);

				// Operator B discovers in-flight operation state
				const state = await getReturnOperationState(log._id, OPERATOR_B_CTX, deps);
				expect(state.phase).toBe('IRREVERSIBLE_FORWARD_ONLY');
				expect(state.canAbort).toBe(false);
				expect(state.canResume).toBe(true);

				// Operator B attempts safe abort -> REJECTED because irreversible receipt exists!
				await expect(abortAbandonedReturnReservation(log._id, MANAGER_CTX, deps)).rejects.toThrow(
					/irreversible StockLedger receipt already exists/
				);

				// Operator B performs forward recovery using the discovered operation_id
				const recoveryResult = await returnLoanAtCounter(
					log._id,
					{
						qty_returned: '2',
						condition_on_return: 'READY',
						operationUlid: state.reservation!.operation_id
					},
					OPERATOR_B_CTX,
					deps
				);

				// No duplicate receipt created! Existing receipt reused cleanly.
				expect(recoveryResult.ledgerEntryCreated).toBe(false);
				expect(opsRepo.ledger).toHaveLength(1);
				expect(recoveryResult.log.status).toBe('returned');
				expect(recoveryResult.log.qty_returned).toBe('2');

				// Reservation committed with Operator A's original created_by preserved
				const committedRes = await reservationRepo.get(
					deriveReservationIdFromDistributionLog(log._id)
				);
				expect(committedRes?.status).toBe('COMMITTED');
				expect(committedRes?.created_by).toBe('operator_a');
			});
		});

		describe('CR-134 R4: Sound Loan Resolution Coordination & Write-Authority Fencing', () => {
			it('Section 30: Stale owner is fenced out when attempting irreversible mutation after abort/takeover', async () => {
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

				const opA = '01J00000000000000000000301';
				const opB = '01J00000000000000000000302';
				const OPERATOR_A_CTX: AuthorContext = { ...POS_CTX, createdBy: 'operator_a' };
				const MANAGER_B_CTX: AuthorContext = {
					...POS_CTX,
					createdBy: 'manager_b',
					roles: ['shelter:SH001', 'shelter_manager']
				};
				const deps = {
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
				};

				// Step 1: Operator A acquires RESERVED in PHYSICAL mode
				await acquireReturnReservation(
					{
						logId: log._id,
						mode: 'PHYSICAL',
						operationId: opA,
						qty_returned: '2',
						return_condition: 'READY'
					},
					OPERATOR_A_CTX,
					deps
				);

				// Step 2: Session drops. Manager B discovers and safely aborts A's reservation
				await abortAbandonedReturnReservation(log._id, MANAGER_B_CTX, deps);

				// Manager B reinitializes and starts their own operation B
				await acquireReturnReservation(
					{
						logId: log._id,
						mode: 'PHYSICAL',
						operationId: opB,
						qty_returned: '2',
						return_condition: 'READY'
					},
					MANAGER_B_CTX,
					deps
				);

				// Step 3: Stale Operator A attempts to fence their old operation A
				await expect(
					fenceReturnReservation(log._id, opA, 'PHYSICAL', OPERATOR_A_CTX, deps)
				).rejects.toBeInstanceOf(ConcurrencyCollisionError);

				// Stale Operator A cannot cross irreversible boundary; produces ZERO receipts
				const ledgerEntries = opsRepo.ledger.filter((e) => e.ref_id === log._id);
				expect(ledgerEntries).toHaveLength(0);
			});

			it('Section 31: Abort vs Fence CAS race allows exactly one winner', async () => {
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

				const opA = '01J00000000000000000000303';
				const OPERATOR_A_CTX: AuthorContext = { ...POS_CTX, createdBy: 'operator_a' };
				const MANAGER_B_CTX: AuthorContext = {
					...POS_CTX,
					createdBy: 'manager_b',
					roles: ['shelter:SH001', 'shelter_manager']
				};
				const deps = {
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
				};

				await acquireReturnReservation(
					{
						logId: log._id,
						mode: 'PHYSICAL',
						operationId: opA,
						qty_returned: '2',
						return_condition: 'READY'
					},
					OPERATOR_A_CTX,
					deps
				);

				// Owner fences operation
				const fenced = await fenceReturnReservation(log._id, opA, 'PHYSICAL', OPERATOR_A_CTX, deps);
				expect(fenced.status).toBe('FENCED');

				// Once FENCED, abort is impossible via CAS
				await expect(abortAbandonedReturnReservation(log._id, MANAGER_B_CTX, deps)).rejects.toThrow(
					/operation is FENCED/
				);

				await expect(abortReturnReservation(log._id, opA, OPERATOR_A_CTX, deps)).rejects.toThrow(
					/operation is FENCED/
				);
			});

			it('Section 32: PHYSICAL vs NON_PHYSICAL mutual exclusion with zero side effects for loser', async () => {
				const log = await logRepo.create(
					{
						ticket_id: 'requisition_ticket:01J00000000000000000000001',
						item_id: 'item:blanket',
						qty: '2',
						recipient_type: 'evacuee',
						recipient_id: 'evacuee:01J00000000000000000000001',
						is_returnable: true,
						status: 'active',
						is_override: false
					},
					POS_CTX
				);

				const opPhys = '01J00000000000000000000304';
				const opNonPhys = '01J00000000000000000000305';
				const deps = {
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
				};

				// Physical acquires reservation first
				await acquireReturnReservation(
					{
						logId: log._id,
						mode: 'PHYSICAL',
						operationId: opPhys,
						qty_returned: '2',
						return_condition: 'READY'
					},
					POS_CTX,
					deps
				);

				// Non-physical attempt fails closed before DistributionLog clear
				await expect(
					clearLoanNonPhysical(
						log._id,
						{ clear_reason: 'lost', notes: 'Evacuee lost blanket', operationUlid: opNonPhys },
						REG_STAFF_CTX,
						deps
					)
				).rejects.toBeInstanceOf(ConcurrencyCollisionError);

				// DistributionLog remains active and not closed
				const checkLog = await logRepo.get(log._id);
				expect(checkLog?.status).toBe('active');
			});

			it('Section 32: BULK vs NON_PHYSICAL mutual exclusion with zero side effects for loser', async () => {
				const pool = await poolRepo.create(
					createBulkReturnPoolDoc(
						{
							stock_ledger_id: 'stock_ledger:01J00000000000000000000306',
							item_id: 'item:cot',
							total_received_qty: '10'
						},
						WAREHOUSE_CTX,
						'01J00000000000000000000306'
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

				const opBulk = '01J00000000000000000000307';
				const opNonPhys = '01J00000000000000000000308';
				const deps = {
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
				};

				// Non-physical acquires reservation first
				await acquireReturnReservation(
					{
						logId: log._id,
						mode: 'NON_PHYSICAL',
						operationId: opNonPhys,
						clear_reason: 'lost',
						notes: 'cross-mode test'
					},
					REG_STAFF_CTX,
					deps
				);

				// Bulk clear fails closed before pool quota is deducted
				await expect(
					clearLoanViaBulkPool(
						{ operationUlid: opBulk, logId: log._id, poolId: pool._id },
						REG_STAFF_CTX,
						deps
					)
				).rejects.toBeInstanceOf(ConcurrencyCollisionError);

				const poolCheck = await poolRepo.get(pool._id);
				expect(poolCheck?.claimed_qty).toBe('0');
				expect(poolCheck?.unclaimed_quota).toBe('10');
			});

			it('Section 33: Split-Brain Policy fails closed when active endpoint is Edge or disconnected', async () => {
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

				const edgeDeps = {
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo,
					endpointStore: { active: 'edge', isWritable: true }
				};

				// Physical on edge -> rejected
				await expect(
					returnLoanAtCounter(
						log._id,
						{ qty_returned: '1', condition_on_return: 'READY' },
						POS_CTX,
						edgeDeps
					)
				).rejects.toThrow(/Authoritative central connectivity is required/);

				// Non-physical on edge -> rejected
				await expect(
					clearLoanNonPhysical(
						log._id,
						{ clear_reason: 'lost', notes: 'Testing edge rejection' },
						REG_STAFF_CTX,
						edgeDeps
					)
				).rejects.toThrow(/Authoritative central connectivity is required/);

				// Disconnected central endpoint -> rejected
				const disconnectedDeps = {
					...edgeDeps,
					endpointStore: { active: 'central', isWritable: false }
				};
				await expect(
					returnLoanAtCounter(
						log._id,
						{ qty_returned: '1', condition_on_return: 'READY' },
						POS_CTX,
						disconnectedDeps
					)
				).rejects.toThrow(/Authoritative central connectivity is required/);
			});

			it('Section 35: Commit failure recovery converges forward without duplicate receipts', async () => {
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

				const opId = '01J00000000000000000000309';
				const deps = {
					logRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					poolRepo,
					claimRepo,
					reservationRepo
				};

				// Simulate a commit failure before the FENCED reservation is persisted as COMMITTED.
				reservationRepo.failNextCommit = true;
				await expect(
					returnLoanAtCounter(
						log._id,
						{ qty_returned: '2', condition_on_return: 'READY', operationUlid: opId },
						POS_CTX,
						deps
					)
				).rejects.toThrow('Simulated reservation commit failure');
				expect(opsRepo.ledger).toHaveLength(1);
				const resId = deriveReservationIdFromDistributionLog(log._id);
				expect((await reservationRepo.get(resId))?.status).toBe('FENCED');

				// New session recovers forward with the same operationUlid
				const state = await getReturnOperationState(log._id, POS_CTX, deps);
				expect(state.phase).toBe('IRREVERSIBLE_FORWARD_ONLY');
				expect(state.canResume).toBe(true);

				const retryResult = await returnLoanAtCounter(
					log._id,
					{ qty_returned: '2', condition_on_return: 'READY', operationUlid: opId },
					POS_CTX,
					deps
				);

				// Zero duplicate receipt created
				expect(retryResult.ledgerEntryCreated).toBe(false);
				expect(opsRepo.ledger).toHaveLength(1);
				const finalRes = await reservationRepo.get(resId);
				expect(finalRes?.status).toBe('COMMITTED');
			});

			describe('CR-134 R4.1 — Contract Convergence & Safety Invariants', () => {
				it('rejects physical semantic replay mismatch on same operation_id', async () => {
					const log = await logRepo.create(
						{
							ticket_id: 'requisition_ticket:01J00000000000000000000001',
							item_id: 'item:fan',
							qty: '5',
							recipient_type: 'evacuee',
							recipient_id: 'evacuee:01J00000000000000000000001',
							is_returnable: true,
							status: 'active',
							is_override: false
						},
						WAREHOUSE_CTX
					);
					const opId = '01J00000000000000000000901';
					const deps = {
						logRepo,
						operationsRepo: opsRepo as unknown as OperationsRepository,
						poolRepo,
						claimRepo,
						reservationRepo
					};

					// Initial reservation with qty 2, condition READY
					await acquireReturnReservation(
						{
							logId: log._id,
							mode: 'PHYSICAL',
							operationId: opId,
							qty_returned: '2',
							return_condition: 'READY'
						},
						WAREHOUSE_CTX,
						deps
					);

					// Same opId replay with modified quantity -> rejected
					await expect(
						acquireReturnReservation(
							{
								logId: log._id,
								mode: 'PHYSICAL',
								operationId: opId,
								qty_returned: '3',
								return_condition: 'READY'
							},
							WAREHOUSE_CTX,
							deps
						)
					).rejects.toBeInstanceOf(ReservationSemanticMismatchError);

					// Same opId replay with modified condition -> rejected
					await expect(
						acquireReturnReservation(
							{
								logId: log._id,
								mode: 'PHYSICAL',
								operationId: opId,
								qty_returned: '2',
								return_condition: 'BROKEN'
							},
							WAREHOUSE_CTX,
							deps
						)
					).rejects.toBeInstanceOf(ReservationSemanticMismatchError);
				});

				it('rejects bulk pool or claimed_qty semantic replay mismatch on same operation_id', async () => {
					const poolA = await poolRepo.create(
						createBulkReturnPoolDoc(
							{
								stock_ledger_id: 'stock_ledger:01J00000000000000000000911',
								item_id: 'item:cot',
								total_received_qty: '10'
							},
							WAREHOUSE_CTX,
							'01J00000000000000000000911'
						),
						WAREHOUSE_CTX
					);
					const poolB = await poolRepo.create(
						createBulkReturnPoolDoc(
							{
								stock_ledger_id: 'stock_ledger:01J00000000000000000000912',
								item_id: 'item:cot',
								total_received_qty: '10'
							},
							WAREHOUSE_CTX,
							'01J00000000000000000000912'
						),
						WAREHOUSE_CTX
					);
					const log = await logRepo.create(
						{
							ticket_id: 'requisition_ticket:01J00000000000000000000001',
							item_id: 'item:cot',
							qty: '3',
							recipient_type: 'evacuee',
							recipient_id: 'evacuee:01J00000000000000000000001',
							is_returnable: true,
							status: 'active',
							is_override: false
						},
						REG_STAFF_CTX
					);
					const opId = '01J00000000000000000000913';
					const deps = {
						logRepo,
						operationsRepo: opsRepo as unknown as OperationsRepository,
						poolRepo,
						claimRepo,
						reservationRepo
					};

					await acquireReturnReservation(
						{
							logId: log._id,
							mode: 'BULK',
							operationId: opId,
							bulk_pool_id: poolA._id,
							claimed_qty: '3'
						},
						REG_STAFF_CTX,
						deps
					);

					// Same opId replay switching pool -> rejected
					await expect(
						acquireReturnReservation(
							{
								logId: log._id,
								mode: 'BULK',
								operationId: opId,
								bulk_pool_id: poolB._id,
								claimed_qty: '3'
							},
							REG_STAFF_CTX,
							deps
						)
					).rejects.toThrow(/Bulk pool ID cannot be modified/);

					// Same opId replay switching claimed_qty -> rejected
					await expect(
						acquireReturnReservation(
							{
								logId: log._id,
								mode: 'BULK',
								operationId: opId,
								bulk_pool_id: poolA._id,
								claimed_qty: '2'
							},
							REG_STAFF_CTX,
							deps
						)
					).rejects.toThrow(/Bulk claimed quantity cannot be modified/);
				});

				it('rejects lost -> waived semantic replay mismatch on same operation_id', async () => {
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
					const opId = '01J00000000000000000000921';
					const deps = {
						logRepo,
						operationsRepo: opsRepo as unknown as OperationsRepository,
						poolRepo,
						claimRepo,
						reservationRepo
					};

					await acquireReturnReservation(
						{
							logId: log._id,
							mode: 'NON_PHYSICAL',
							operationId: opId,
							clear_reason: 'lost',
							notes: 'Lost in flood'
						},
						REG_STAFF_CTX,
						deps
					);

					// Replay same opId switching from lost to waived -> rejected
					await expect(
						acquireReturnReservation(
							{
								logId: log._id,
								mode: 'NON_PHYSICAL',
								operationId: opId,
								clear_reason: 'waived',
								notes: 'Waived by manager'
							},
							REG_STAFF_CTX,
							deps
						)
					).rejects.toThrow(/Non-physical clear reason cannot be modified/);
				});

				it('stale owner cannot fence after reservation is aborted and reinitialized', async () => {
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
						WAREHOUSE_CTX
					);
					const opStale = '01J00000000000000000000931';
					const opNew = '01J00000000000000000000932';
					const deps = {
						logRepo,
						operationsRepo: opsRepo as unknown as OperationsRepository,
						poolRepo,
						claimRepo,
						reservationRepo
					};

					// 1. Stale owner acquires reservation
					await acquireReturnReservation(
						{
							logId: log._id,
							mode: 'PHYSICAL',
							operationId: opStale,
							qty_returned: '1',
							return_condition: 'READY'
						},
						WAREHOUSE_CTX,
						deps
					);

					// 2. Aborted before side effect
					await abortReturnReservation(log._id, opStale, WAREHOUSE_CTX, deps);

					// 3. New attempt acquires reservation
					await acquireReturnReservation(
						{
							logId: log._id,
							mode: 'PHYSICAL',
							operationId: opNew,
							qty_returned: '1',
							return_condition: 'READY'
						},
						WAREHOUSE_CTX,
						deps
					);

					// 4. Stale owner tries to fence with old operationId -> rejected
					await expect(
						fenceReturnReservation(log._id, opStale, 'PHYSICAL', WAREHOUSE_CTX, deps)
					).rejects.toBeInstanceOf(ConcurrencyCollisionError);
				});

				it('enforces abort vs fence concurrency: once FENCED, abort is forbidden', async () => {
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
						WAREHOUSE_CTX
					);
					const opId = '01J00000000000000000000941';
					const deps = {
						logRepo,
						operationsRepo: opsRepo as unknown as OperationsRepository,
						poolRepo,
						claimRepo,
						reservationRepo
					};

					await acquireReturnReservation(
						{
							logId: log._id,
							mode: 'PHYSICAL',
							operationId: opId,
							qty_returned: '1',
							return_condition: 'READY'
						},
						WAREHOUSE_CTX,
						deps
					);

					await fenceReturnReservation(log._id, opId, 'PHYSICAL', WAREHOUSE_CTX, deps);

					// Trying to abort a FENCED reservation throws ConcurrencyCollisionError
					await expect(
						abortReturnReservation(log._id, opId, WAREHOUSE_CTX, deps)
					).rejects.toBeInstanceOf(ConcurrencyCollisionError);
				});

				it('enforces mode RBAC on FENCE transition', async () => {
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
						COORDINATOR_CTX
					);
					const deps = {
						logRepo,
						operationsRepo: opsRepo as unknown as OperationsRepository,
						poolRepo,
						claimRepo,
						reservationRepo
					};

					// PHYSICAL: Registration staff cannot fence
					const opPhys = '01J00000000000000000000951';
					await acquireReturnReservation(
						{
							logId: log._id,
							mode: 'PHYSICAL',
							operationId: opPhys,
							qty_returned: '1',
							return_condition: 'READY'
						},
						WAREHOUSE_CTX,
						deps
					);
					await expect(
						fenceReturnReservation(log._id, opPhys, 'PHYSICAL', REG_STAFF_CTX, deps)
					).rejects.toThrow(/PHYSICAL return reservation requires warehouse/);

					await abortReturnReservation(log._id, opPhys, WAREHOUSE_CTX, deps);

					// BULK: Warehouse staff cannot fence
					const opBulk = '01J00000000000000000000952';
					await acquireReturnReservation(
						{
							logId: log._id,
							mode: 'BULK',
							operationId: opBulk,
							bulk_pool_id: 'bulk_return_pool:01J00000000000000000000911',
							claimed_qty: '1'
						},
						REG_STAFF_CTX,
						deps
					);
					await expect(
						fenceReturnReservation(log._id, opBulk, 'BULK', WAREHOUSE_CTX, deps)
					).rejects.toThrow(/BULK return reservation requires registration/);
				});

				it('enforces mode RBAC on COMMIT transition', async () => {
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
						COORDINATOR_CTX
					);
					const deps = {
						logRepo,
						operationsRepo: opsRepo as unknown as OperationsRepository,
						poolRepo,
						claimRepo,
						reservationRepo
					};

					const opPhys = '01J00000000000000000000961';
					await acquireReturnReservation(
						{
							logId: log._id,
							mode: 'PHYSICAL',
							operationId: opPhys,
							qty_returned: '1',
							return_condition: 'READY'
						},
						WAREHOUSE_CTX,
						deps
					);
					await fenceReturnReservation(log._id, opPhys, 'PHYSICAL', WAREHOUSE_CTX, deps);

					// Registration staff cannot commit a PHYSICAL reservation
					await expect(
						commitReturnReservation(log._id, opPhys, REG_STAFF_CTX, deps)
					).rejects.toThrow(/PHYSICAL return reservation requires warehouse/);
				});

				it('recovers forward when non-physical clear succeeds but reservation commit crashes', async () => {
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
					const opId = '01J00000000000000000000971';
					const deps = {
						logRepo,
						operationsRepo: opsRepo as unknown as OperationsRepository,
						poolRepo,
						claimRepo,
						reservationRepo
					};

					// Simulate reservation commit failure before COMMITTED is persisted.
					reservationRepo.failNextCommit = true;
					await expect(
						clearLoanNonPhysical(
							log._id,
							{ clear_reason: 'lost', notes: 'Lost in typhoon', operationUlid: opId },
							REG_STAFF_CTX,
							deps
						)
					).rejects.toThrow('Simulated reservation commit failure');

					const resId = deriveReservationIdFromDistributionLog(log._id);
					expect((await reservationRepo.get(resId))?.status).toBe('FENCED');

					// Inspect operation state: must surface as IRREVERSIBLE_FORWARD_ONLY, NOT TERMINAL
					const state = await getReturnOperationState(log._id, REG_STAFF_CTX, deps);
					expect(state.phase).toBe('IRREVERSIBLE_FORWARD_ONLY');
					expect(state.canResume).toBe(true);

					// Retry clearLoanNonPhysical with the same opId -> recovers cleanly and commits
					const recovered = await clearLoanNonPhysical(
						log._id,
						{ clear_reason: 'lost', notes: 'Lost in typhoon', operationUlid: opId },
						REG_STAFF_CTX,
						deps
					);
					expect(recovered.status).toBe('lost');

					const finalRes = await reservationRepo.get(resId);
					expect(finalRes?.status).toBe('COMMITTED');
				});

				it('recovers forward when bulk clearance succeeds but reservation commit crashes', async () => {
					const pool = await poolRepo.create(
						createBulkReturnPoolDoc(
							{
								stock_ledger_id: 'stock_ledger:01J00000000000000000000981',
								item_id: 'item:blanket',
								total_received_qty: '5'
							},
							WAREHOUSE_CTX,
							'01J00000000000000000000981'
						),
						WAREHOUSE_CTX
					);
					const log = await logRepo.create(
						{
							ticket_id: 'requisition_ticket:01J00000000000000000000001',
							item_id: 'item:blanket',
							qty: '2',
							recipient_type: 'evacuee',
							recipient_id: 'evacuee:01J00000000000000000000001',
							is_returnable: true,
							status: 'active',
							is_override: false
						},
						REG_STAFF_CTX
					);
					const opId = '01J00000000000000000000982';
					const deps = {
						logRepo,
						operationsRepo: opsRepo as unknown as OperationsRepository,
						poolRepo,
						claimRepo,
						reservationRepo
					};

					// Simulate reservation commit failure before COMMITTED is persisted.
					reservationRepo.failNextCommit = true;
					await expect(
						clearLoanViaBulkPool(
							{ operationUlid: opId, logId: log._id, poolId: pool._id },
							REG_STAFF_CTX,
							deps
						)
					).rejects.toThrow('Simulated reservation commit failure');

					const resId = deriveReservationIdFromDistributionLog(log._id);
					expect((await reservationRepo.get(resId))?.status).toBe('FENCED');

					// Inspect operation state: must surface as IRREVERSIBLE_FORWARD_ONLY
					const state = await getReturnOperationState(log._id, REG_STAFF_CTX, deps);
					expect(state.phase).toBe('IRREVERSIBLE_FORWARD_ONLY');
					expect(state.canResume).toBe(true);

					// Retry clearLoanViaBulkPool -> commits reservation forward
					const recovered = await clearLoanViaBulkPool(
						{ operationUlid: opId, logId: log._id, poolId: pool._id },
						REG_STAFF_CTX,
						deps
					);
					expect(recovered.log.status).toBe('returned');
					expect(recovered.claim.status).toBe('COMPLETE');

					const finalRes = await reservationRepo.get(resId);
					expect(finalRes?.status).toBe('COMMITTED');
				});
			});

			describe('CR-134 R4.2 focused recovery and contract alignment', () => {
				it('InMemoryReservationRepository validates production schema and rejects legacy conditions', async () => {
					const validDoc = createLoanReturnReservation(
						{
							distribution_log_id: 'distribution_log:01J00000000000000000000002',
							mode: 'PHYSICAL',
							operation_id: '01J00000000000000000000001',
							qty_returned: '1',
							return_condition: 'READY'
						},
						WAREHOUSE_CTX
					);
					const created = await reservationRepo.create(validDoc);
					expect(created.return_condition).toBe('READY');

					// Raw runtime input with legacy conditions is rejected by the production schema.
					for (const legacyCondition of ['good', 'damaged', 'unusable']) {
						const parsed = loanReturnReservationDocSchema.safeParse({
							...validDoc,
							return_condition: legacyCondition
						});
						expect(parsed.success).toBe(false);
					}
				});

				it('verifies cumulative quantity: previous 3 + return 2 -> reservation target 5, ledger delta 2', async () => {
					const deps = {
						logRepo,
						operationsRepo: opsRepo as unknown as OperationsRepository,
						poolRepo,
						claimRepo,
						reservationRepo
					};

					// Create a log with qty = 10 and previously returned = 3
					const log = await logRepo.create(
						{
							ticket_id: 'requisition_ticket:01J00000000000000000000001',
							item_id: 'item:fan',
							qty: '10',
							recipient_type: 'evacuee',
							recipient_id: 'evacuee:01J00000000000000000000001',
							is_returnable: true,
							status: 'active',
							is_override: false
						},
						POS_CTX
					);
					// Record initial return of 3
					await returnLoanAtCounter(
						log._id,
						{ qty_returned: '3', condition_on_return: 'READY' },
						POS_CTX,
						deps
					);

					const logAfterFirst = await logRepo.get(log._id);
					expect(logAfterFirst?.qty_returned).toBe('3');

					// Next action: return +2 (target cumulative = 5)
					const result = await returnLoanAtCounter(
						log._id,
						{ qty_returned: '5', condition_on_return: 'READY' },
						POS_CTX,
						deps
					);
					expect(result.ledgerEntryCreated).toBe(true);

					const logAfterSecond = await logRepo.get(log._id);
					expect(logAfterSecond?.qty_returned).toBe('5');

					// Check reservation: persisted cumulative target must be '5'
					const resId = deriveReservationIdFromDistributionLog(log._id);
					const res = await reservationRepo.get(resId);
					expect(res?.qty_returned).toBe('5');
					expect(res?.return_condition).toBe('READY');

					// Check StockLedger entries for this log: first was 3, second delta was 2
					const ledger = await opsRepo.listLedger();
					const receipts = ledger.filter((e) => e.ref_id === log._id && e.reason === 'receive');
					expect(receipts).toHaveLength(2);
					expect(receipts[0].qty).toBe('3');
					expect(receipts[1].qty).toBe('2');
				});

				it('evaluates real endpoint writable state (connecting/disconnected -> rejected, connected central -> allowed)', async () => {
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

					const baseDeps = {
						logRepo,
						operationsRepo: opsRepo as unknown as OperationsRepository,
						poolRepo,
						claimRepo,
						reservationRepo
					};

					// 1. connecting/non-writable status -> isWritable is false
					await expect(
						returnLoanAtCounter(
							log._id,
							{ qty_returned: '1', condition_on_return: 'READY' },
							POS_CTX,
							{ ...baseDeps, endpointStore: { active: 'central', isWritable: false } }
						)
					).rejects.toThrow(/Authoritative central connectivity is required/);

					// 2. disconnected status -> isWritable is false
					endpointStore.markDisconnected();
					await expect(
						returnLoanAtCounter(
							log._id,
							{ qty_returned: '1', condition_on_return: 'READY' },
							POS_CTX,
							baseDeps
						)
					).rejects.toThrow(/Authoritative central connectivity is required/);

					// 3. connected status -> isWritable is true
					endpointStore.markConnected();
					const res = await returnLoanAtCounter(
						log._id,
						{ qty_returned: '1', condition_on_return: 'READY' },
						POS_CTX,
						baseDeps
					);
					expect(res.log.qty_returned).toBe('1');
				});

				it('enforces pre-effect abort permissions (owner allowed, manager/admin allowed, different staff rejected, FENCED rejected)', async () => {
					const deps = {
						logRepo,
						operationsRepo: opsRepo as unknown as OperationsRepository,
						poolRepo,
						claimRepo,
						reservationRepo
					};

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
						WAREHOUSE_CTX
					);

					// 1. Acquire reservation by WAREHOUSE_CTX (wh_user)
					const op1 = '01J00000000000000000000991';
					await acquireReturnReservation(
						{
							logId: log._id,
							mode: 'PHYSICAL',
							operationId: op1,
							qty_returned: '1',
							return_condition: 'READY'
						},
						WAREHOUSE_CTX,
						deps
					);

					// 2. Another warehouse staff (different actor, not manager/admin) cannot abort
					const otherStaffCtx: AuthorContext = {
						shelterCode: 'SH001',
						createdBy: 'wh_staff_2',
						roles: ['shelter:SH001', 'warehouse_staff']
					};
					await expect(
						abortAbandonedReturnReservation(log._id, otherStaffCtx, deps)
					).rejects.toThrow(/caller is not the owner or a manager\/admin/);

					// 3. Shelter manager CAN abort
					const managerAborted = await abortAbandonedReturnReservation(log._id, MANAGER_CTX, deps);
					expect(managerAborted.status).toBe('ABORTED');

					// 4. Re-acquire with new operation by WAREHOUSE_CTX
					const op2 = '01J00000000000000000000992';
					await acquireReturnReservation(
						{
							logId: log._id,
							mode: 'PHYSICAL',
							operationId: op2,
							qty_returned: '1',
							return_condition: 'READY'
						},
						WAREHOUSE_CTX,
						deps
					);

					// 5. System admin CAN abort
					const adminAborted = await abortAbandonedReturnReservation(log._id, ADMIN_CTX, deps);
					expect(adminAborted.status).toBe('ABORTED');

					// 6. Re-acquire and advance to FENCED
					const op3 = '01J00000000000000000000993';
					await acquireReturnReservation(
						{
							logId: log._id,
							mode: 'PHYSICAL',
							operationId: op3,
							qty_returned: '1',
							return_condition: 'READY'
						},
						WAREHOUSE_CTX,
						deps
					);
					await fenceReturnReservation(log._id, op3, 'PHYSICAL', WAREHOUSE_CTX, deps);

					// 7. FENCED abort is rejected even for manager and admin
					await expect(abortAbandonedReturnReservation(log._id, MANAGER_CTX, deps)).rejects.toThrow(
						/operation is FENCED.*recover.*forward/i
					);
					await expect(abortAbandonedReturnReservation(log._id, ADMIN_CTX, deps)).rejects.toThrow(
						/operation is FENCED.*recover.*forward/i
					);
				});

				it('allows forward recovery of bulk return when pool is now EXHAUSTED after quota claim', async () => {
					// Create a pool with total quota 1
					const pool = await poolRepo.create(
						createBulkReturnPoolDoc(
							{
								stock_ledger_id: 'stock_ledger:01J00000000000000000000995',
								item_id: 'item:cot',
								total_received_qty: '1'
							},
							WAREHOUSE_CTX,
							'01J00000000000000000000995'
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
					const opId = '01J00000000000000000000996';
					const deps = {
						logRepo,
						operationsRepo: opsRepo as unknown as OperationsRepository,
						poolRepo,
						claimRepo,
						reservationRepo
					};

					// Step 1: acquire bulk reservation
					await acquireReturnReservation(
						{
							logId: log._id,
							mode: 'BULK',
							operationId: opId,
							bulk_pool_id: pool._id,
							claimed_qty: '1'
						},
						REG_STAFF_CTX,
						deps
					);

					// Step 2: claim quota -> pool remaining becomes 0, status becomes EXHAUSTED
					const claimId = deriveClaimIdFromDistributionLog(log._id);
					await claimRepo.create({
						_id: claimId,
						type: 'bulk_return_claim',
						schema_v: 1,
						shelter_code: 'SH001',
						distribution_log_id: log._id,
						bulk_pool_id: pool._id,
						item_id: 'item:cot',
						claimed_qty: '1',
						status: 'POOL_CLAIMED',
						operation_id: opId,
						created_by: REG_STAFF_CTX.createdBy,
						created_at: new Date().toISOString(),
						updated_at: new Date().toISOString()
					});
					await poolRepo.claimQuota(pool._id, claimId, '1', REG_STAFF_CTX);

					// Reservation is advanced to FENCED
					await fenceReturnReservation(log._id, opId, 'BULK', REG_STAFF_CTX, deps);

					// Check pool status is indeed EXHAUSTED
					const currentPool = await poolRepo.get(pool._id);
					expect(currentPool?.status).toBe('EXHAUSTED');

					// Step 3: Forward recovery via clearLoanViaBulkPool should succeed
					// even though the pool is EXHAUSTED, because this operation already holds the claim
					const res = await clearLoanViaBulkPool(
						{
							logId: log._id,
							poolId: pool._id,
							operationUlid: opId
						},
						REG_STAFF_CTX,
						deps
					);
					expect(res.log.status).toBe('returned');
					expect(res.claim.status).toBe('COMPLETE');

					const finalRes = await reservationRepo.get(
						deriveReservationIdFromDistributionLog(log._id)
					);
					expect(finalRes?.status).toBe('COMMITTED');
				});

				it('enforces cross-mode safety: active PHYSICAL reservation blocks BULK and NON_PHYSICAL clearances', async () => {
					const deps = {
						logRepo,
						operationsRepo: opsRepo as unknown as OperationsRepository,
						poolRepo,
						claimRepo,
						reservationRepo
					};

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
						WAREHOUSE_CTX
					);

					// Acquire PHYSICAL reservation
					const opId = '01J00000000000000000000997';
					await acquireReturnReservation(
						{
							logId: log._id,
							mode: 'PHYSICAL',
							operationId: opId,
							qty_returned: '1',
							return_condition: 'READY'
						},
						WAREHOUSE_CTX,
						deps
					);

					// Attempting NON_PHYSICAL clear on this log throws
					await expect(
						clearLoanNonPhysical(
							log._id,
							{ clear_reason: 'lost', notes: 'testing cross-mode' },
							REG_STAFF_CTX,
							deps
						)
					).rejects.toThrow(/reserved for PHYSICAL/);

					// Bulk preflight validates the target pool before reservation
					// acquisition; provide a valid matching pool so this assertion
					// reaches the intended cross-mode collision.
					const pool = await poolRepo.create(
						createBulkReturnPoolDoc(
							{
								stock_ledger_id: 'stock_ledger:01J00000000000000000000995',
								item_id: log.item_id,
								total_received_qty: '1'
							},
							WAREHOUSE_CTX,
							'01J00000000000000000000995'
						),
						WAREHOUSE_CTX
					);

					// Attempting BULK clear on this log throws
					await expect(
						clearLoanViaBulkPool(
							{
								operationUlid: '01J00000000000000000000998',
								logId: log._id,
								poolId: pool._id
							},
							REG_STAFF_CTX,
							deps
						)
					).rejects.toThrow(/reserved for PHYSICAL/);

					// getReturnOperationState correctly identifies PHYSICAL mode
					const state = await getReturnOperationState(log._id, WAREHOUSE_CTX, deps);
					expect(state.reservation?.mode).toBe('PHYSICAL');
				});
			});
		});
	});
});
