// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AuthorContext } from '$lib/db/model';

interface InMemoryDoc {
	_id: string;
	_rev?: string;
	type?: string;
	[key: string]: unknown;
}

let store: Map<string, InMemoryDoc>;
let revCounters: Map<string, number>;
let beforeStrictWrite: ((doc: InMemoryDoc) => Promise<void> | void) | undefined;
let stockLedgerProjectionReads: number;
let getDocCalls: string[];
let couchCallCount: number;

function nextRev(id: string): string {
	const count = (revCounters.get(id) ?? 0) + 1;
	revCounters.set(id, count);
	return `${count}-rev${id.replace(/[^a-zA-Z0-9]/g, '')}`;
}

vi.mock('$lib/db/shelter', () => ({
	SHELTER_CODE: 'SH001',
	SHELTER_DB: 'shelter_sh001',
	getShelterDb: () => 'shelter_sh001'
}));

vi.mock('$lib/db/couch-db', () => ({
	ConflictError: class ConflictError extends Error {
		constructor(message = 'Document update conflict') {
			super(message);
			this.name = 'ConflictError';
		}
	},
	getDoc: async <T extends { _id: string }>(_dbName: string, id: string): Promise<T | null> => {
		couchCallCount += 1;
		getDocCalls.push(id);
		const doc = store.get(id);
		if (!doc) return null;
		return JSON.parse(JSON.stringify(doc)) as T;
	},
	putDoc: async <T extends { _id: string; _rev?: string }>(
		_dbName: string,
		doc: T,
		_init?: unknown,
		options?: { onConflict?: 'throw' | 'return-existing' }
	): Promise<T> => {
		couchCallCount += 1;
		const existing = store.get(doc._id);
		const onConflict = options?.onConflict ?? 'throw';

		if (existing) {
			if (doc._rev && doc._rev !== existing._rev) {
				if (onConflict === 'return-existing') {
					return JSON.parse(JSON.stringify(existing)) as T;
				}
				throw new Error(`Conflict on document ${doc._id}`);
			}
			if (!doc._rev && onConflict === 'return-existing') {
				return JSON.parse(JSON.stringify(existing)) as T;
			}
			if (!doc._rev && onConflict === 'throw') {
				throw new Error(`Conflict on document ${doc._id}`);
			}
		}

		const rev = nextRev(doc._id);
		const saved = { ...doc, _rev: rev };
		store.set(doc._id, JSON.parse(JSON.stringify(saved)));
		return JSON.parse(JSON.stringify(saved)) as T;
	},
	putDocStrict: async <T extends { _id: string; _rev?: string }>(
		_dbName: string,
		doc: T
	): Promise<T> => {
		couchCallCount += 1;
		await beforeStrictWrite?.(doc as InMemoryDoc);
		const existing = store.get(doc._id);
		if (existing) {
			if (!doc._rev || doc._rev !== existing._rev) {
				throw new Error(`Conflict on document ${doc._id}`);
			}
		} else if (doc._rev) {
			throw new Error(`Cannot create new document ${doc._id} with existing rev`);
		}

		const rev = nextRev(doc._id);
		const saved = { ...doc, _rev: rev };
		store.set(doc._id, JSON.parse(JSON.stringify(saved)));
		return JSON.parse(JSON.stringify(saved)) as T;
	},
	allDocsByType: async <T>(
		_dbName: string,
		type: string,
		guard: (d: unknown) => d is T
	): Promise<T[]> => {
		couchCallCount += 1;
		if (type === 'stock_ledger') stockLedgerProjectionReads += 1;
		const results: T[] = [];
		for (const doc of store.values()) {
			if (doc.type === type && guard(doc)) {
				results.push(JSON.parse(JSON.stringify(doc)) as T);
			}
		}
		return results;
	},
	allDocsByIds: async <T>(
		_dbName: string,
		ids: readonly string[],
		guard: (d: unknown) => d is T
	): Promise<T[]> => {
		couchCallCount += 1;
		const results: T[] = [];
		for (const id of ids) {
			const doc = store.get(id);
			if (doc && guard(doc)) {
				results.push(JSON.parse(JSON.stringify(doc)) as T);
			}
		}
		return results;
	}
}));

import { DistributionRemoteRepository } from './distribution.remote';
import {
	createReceiveEntry,
	parseStockLedger,
	type StockLedger
} from '$lib/features/operations/domain/operations';
import {
	createDistributionBatch,
	createStockLotReservation,
	stockLotReservationDocSchema
} from '../domain/distribution';
import {
	ApprovalConflictError,
	InsufficientStockError,
	IntegrityError,
	makeLotReservationDocId,
	ValidationError
} from './semantic-verify';
import type { StockLotReservation } from '../domain/distribution';

const warehouseCtx: AuthorContext = {
	shelterCode: 'SH001',
	createdBy: 'warehouse_bob',
	roles: ['warehouse_staff']
};
const adminCtx: AuthorContext = {
	shelterCode: 'SH001',
	createdBy: 'admin_alice',
	roles: ['system_admin']
};
const regCtx: AuthorContext = {
	shelterCode: 'SH001',
	createdBy: 'reg_charlie',
	roles: ['registration_staff']
};
const managerCtx: AuthorContext = {
	shelterCode: 'SH001',
	createdBy: 'mgr_dave',
	roles: ['shelter_manager']
};
const kitchenCtx: AuthorContext = {
	shelterCode: 'SH001',
	createdBy: 'kitchen_erin',
	roles: ['kitchen_staff']
};

class Phase3TestRepository extends DistributionRemoteRepository {
	async getRequest(id: string) {
		return super.getRequest(id, adminCtx);
	}

	async getBatch(id: string) {
		return super.getBatch(id, adminCtx);
	}

	async listBatches(status?: Parameters<DistributionRemoteRepository['listBatches']>[0]) {
		return super.listBatches(status, adminCtx);
	}
}

const DONATION_REF = 'donation:01JFIXTUREDONATION';

describe('DistributionRemoteRepository (Phase 3A)', () => {
	let repo: Phase3TestRepository;

	beforeEach(() => {
		store = new Map();
		revCounters = new Map();
		beforeStrictWrite = undefined;
		stockLedgerProjectionReads = 0;
		getDocCalls = [];
		couchCallCount = 0;
		repo = new Phase3TestRepository('shelter_sh001');
	});

	async function seedInboundLot(
		itemId: string,
		qty: number,
		unit = 'kg',
		lotNo = 'L-260829-001'
	): Promise<StockLedger> {
		const entry = createReceiveEntry(
			{
				item_id: itemId,
				qty,
				unit,
				source: 'donation',
				ref_id: DONATION_REF,
				lot: { lot_no: lotNo },
				// Recovery fixtures use durable ledgers dated 2026-08-29; the
				// inbound lot must therefore precede their outbound deductions.
				occurred_at: '2026-08-28T00:00:00.000Z'
			},
			warehouseCtx
		);
		const rev = nextRev(entry._id);
		const saved = { ...entry, _rev: rev };
		store.set(entry._id, saved);
		return saved;
	}

	describe('BLOCKER 3: Role Enforcement in Repository', () => {
		it('rejects approval attempt from registration_staff without modifying data', async () => {
			const inbound = await seedInboundLot('item:rice', 100);
			const request = await repo.createRequest(
				{
					purpose: 'Daily emergency rations',
					active_headcount_snapshot: '50',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:rice',
							requested_qty: '50',
							unit: 'kg',
							distribution_type_snapshot: 'one_time',
							target_qty_snapshot: '50'
						}
					]
				},
				regCtx
			);

			await expect(
				repo.approveRequest(
					request._id,
					[{ item_id: 'item:rice', lot_ref: inbound._id, qty: '50' }],
					regCtx
				)
			).rejects.toThrow(
				/Unauthorized: distribution approval requires warehouse_staff or system_admin/
			);

			// Assert request remains pending
			const reqAfter = await repo.getRequest(request._id);
			expect(reqAfter?.status).toBe('pending');
			expect(reqAfter?.approval_operation_id).toBeUndefined();

			// Assert 0 batches, 0 reservations, 0 outbound ledgers
			const batches = await repo.listBatches();
			expect(batches).toHaveLength(0);

			const resId = await makeLotReservationDocId(inbound._id);
			expect(store.get(resId)).toBeUndefined();

			const ledgers = Array.from(store.values()).filter((d) => d.type === 'stock_ledger');
			expect(ledgers).toHaveLength(1); // Only inbound seed
		});

		it('rejects approval attempt from shelter_manager without modifying data', async () => {
			const inbound = await seedInboundLot('item:rice', 100);
			const request = await repo.createRequest(
				{
					purpose: 'Daily rations',
					active_headcount_snapshot: '50',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:rice',
							requested_qty: '50',
							unit: 'kg',
							distribution_type_snapshot: 'one_time',
							target_qty_snapshot: '50'
						}
					]
				},
				regCtx
			);

			await expect(
				repo.approveRequest(
					request._id,
					[{ item_id: 'item:rice', lot_ref: inbound._id, qty: '50' }],
					managerCtx
				)
			).rejects.toThrow(
				/Unauthorized: distribution approval requires warehouse_staff or system_admin/
			);

			const reqAfter = await repo.getRequest(request._id);
			expect(reqAfter?.status).toBe('pending');
		});

		it('rejects rejection attempt from registration_staff', async () => {
			const request = await repo.createRequest(
				{
					purpose: 'Daily rations',
					active_headcount_snapshot: '50',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:rice',
							requested_qty: '50',
							unit: 'kg',
							distribution_type_snapshot: 'one_time',
							target_qty_snapshot: '50'
						}
					]
				},
				regCtx
			);

			await expect(repo.rejectRequest(request._id, 'Denied', regCtx)).rejects.toThrow(
				/Unauthorized: distribution rejection requires warehouse_staff or system_admin/
			);

			const reqAfter = await repo.getRequest(request._id);
			expect(reqAfter?.status).toBe('pending');
		});

		it('allows approval from system_admin', async () => {
			const inbound = await seedInboundLot('item:rice', 100);
			const request = await repo.createRequest(
				{
					purpose: 'Admin approval',
					active_headcount_snapshot: '50',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:rice',
							requested_qty: '50',
							unit: 'kg',
							distribution_type_snapshot: 'one_time',
							target_qty_snapshot: '50'
						}
					]
				},
				adminCtx
			);

			const batch = await repo.approveRequest(
				request._id,
				[{ item_id: 'item:rice', lot_ref: inbound._id, qty: '50' }],
				adminCtx
			);

			expect(batch.status).toBe('active');
			const reqAfter = await repo.getRequest(request._id);
			expect(reqAfter?.status).toBe('approved');
			expect(reqAfter?.approved_by).toBe('admin_alice');
		});

		it('completes partial approval workflow and transitions request to approved', async () => {
			const inbound = await seedInboundLot('item:rice', 100);
			const request = await repo.createRequest(
				{
					purpose: 'Partial approval',
					active_headcount_snapshot: '50',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:rice',
							requested_qty: '50',
							unit: 'kg',
							distribution_type_snapshot: 'one_time',
							target_qty_snapshot: '50'
						}
					]
				},
				adminCtx
			);

			await repo.approveRequest(
				request._id,
				[{ item_id: 'item:rice', lot_ref: inbound._id, qty: '5' }],
				adminCtx
			);

			const persisted = await repo.getRequest(request._id);
			expect(persisted).toMatchObject({ status: 'approved' });
		});

		it('aggregates legacy duplicate request rows by item identity before activating batch', async () => {
			const inbound = await seedInboundLot('item:rice', 50);
			const request = await repo.createRequest(
				{
					purpose: 'Legacy duplicate rice rows',
					active_headcount_snapshot: '50',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:rice',
							requested_qty: '30',
							unit: 'kg',
							distribution_type_snapshot: 'one_time',
							target_qty_snapshot: '30'
						}
					]
				},
				adminCtx
			);

			const legacyDoc = store.get(request._id);
			if (!legacyDoc) throw new Error('Legacy request fixture was not persisted');
			legacyDoc.items = [
				{
					item_id: 'item:rice',
					requested_qty: '30',
					unit: 'kg',
					distribution_type_snapshot: 'one_time',
					target_qty_snapshot: '30'
				},
				{
					item_id: 'item:rice',
					requested_qty: '20',
					unit: 'kg',
					distribution_type_snapshot: 'one_time',
					target_qty_snapshot: '20'
				}
			];

			const batch = await repo.approveRequest(
				request._id,
				[{ item_id: 'item:rice', lot_ref: inbound._id, qty: '50' }],
				adminCtx
			);

			expect(batch.items).toHaveLength(1);
			expect((await repo.getRequest(request._id))?.status).toBe('approved');
		});

		it('keeps batch active on an already-approved retry', async () => {
			const inbound = await seedInboundLot('item:rice', 50);
			const request = await repo.createRequest(
				{
					purpose: 'Coverage retry',
					active_headcount_snapshot: '50',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:rice',
							requested_qty: '50',
							unit: 'kg',
							distribution_type_snapshot: 'one_time',
							target_qty_snapshot: '50'
						}
					]
				},
				adminCtx
			);
			const allocations = [{ item_id: 'item:rice', lot_ref: inbound._id, qty: '5' }];

			await repo.approveRequest(request._id, allocations, adminCtx);
			const ledgerCountBeforeRetry = Array.from(store.values()).filter(
				(doc) => doc.type === 'stock_ledger' && doc.reason === 'distribute'
			).length;
			await repo.approveRequest(request._id, allocations, adminCtx);

			expect((await repo.getRequest(request._id))?.status).toBe('approved');
			expect(
				Array.from(store.values()).filter(
					(doc) => doc.type === 'stock_ledger' && doc.reason === 'distribute'
				)
			).toHaveLength(ledgerCountBeforeRetry);
		});
	});

	describe('BLOCKER 2: Deterministic CAS Race / Conflict on Competing Lots', () => {
		it('CAS CONFLICT UNIT TEST: simulates interleaved stale-_rev write conflict and re-evaluation', async () => {
			const inbound = await seedInboundLot('item:water', 50, 'bottle');

			// Two requests competing for 30 bottles each (total 60 > 50 available)
			const reqA = await repo.createRequest(
				{
					purpose: 'Zone A',
					active_headcount_snapshot: '30',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:water',
							requested_qty: '30',
							unit: 'bottle',
							distribution_type_snapshot: 'consumable',
							target_qty_snapshot: '33'
						}
					]
				},
				regCtx
			);

			const reqB = await repo.createRequest(
				{
					purpose: 'Zone B',
					active_headcount_snapshot: '30',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:water',
							requested_qty: '30',
							unit: 'bottle',
							distribution_type_snapshot: 'consumable',
							target_qty_snapshot: '33'
						}
					]
				},
				regCtx
			);

			// Pre-create initial reservation doc R0
			const resId = await makeLotReservationDocId(inbound._id);
			const initialRes: StockLotReservation = {
				_id: resId,
				_rev: nextRev(resId),
				type: 'stock_lot_reservation',
				lot_ref: inbound._id,
				pending_claims: [],
				shelter_code: 'SH001',
				created_at: '2026-08-29T10:00:00.000Z',
				updated_at: '2026-08-29T10:00:00.000Z',
				created_by: 'warehouse_bob',
				schema_v: 1
			};
			store.set(resId, initialRes as unknown as InMemoryDoc);

			// Operation A approves successfully, claiming 30 from 50 (reservation updated to R1)
			const batchA = await repo.approveRequest(
				reqA._id,
				[{ item_id: 'item:water', lot_ref: inbound._id, qty: '30' }],
				warehouseCtx
			);
			expect(batchA.status).toBe('active');

			// Operation B attempts to approve 30 from the same lot
			// Available physical balance is now 50 - 30 (outbound ledger) = 20.
			// 30 > 20 -> Throws InsufficientStockError
			await expect(
				repo.approveRequest(
					reqB._id,
					[{ item_id: 'item:water', lot_ref: inbound._id, qty: '30' }],
					warehouseCtx
				)
			).rejects.toThrow(InsufficientStockError);

			// Assertions:
			// 1. Request B was reverted to pending
			const reqBAfter = await repo.getRequest(reqB._id);
			expect(reqBAfter?.status).toBe('pending');
			expect(reqBAfter?.approval_operation_id).toBeUndefined();

			// 2. Reservation contains no B claim
			const finalResDoc = store.get(resId) as unknown as StockLotReservation;
			expect(finalResDoc.pending_claims.filter((c) => c.request_id === reqB._id)).toHaveLength(0);

			// 3. Total pending claims <= physical balance
			const totalPendingClaims = finalResDoc.pending_claims.reduce(
				(sum, c) => sum + Number(c.qty),
				0
			);
			expect(totalPendingClaims).toBe(0); // A released its claim upon approval completion

			// 4. No stock ledger for B exists
			const allLedgers = Array.from(store.values()).filter((d) => d.type === 'stock_ledger');
			const bLedgers = allLedgers.filter(
				(l) => l.ref_id === `distribution_batch:${reqB._id.slice('distribution_request:'.length)}`
			);
			expect(bLedgers).toHaveLength(0);

			// 5. Total outbound ledger deduction is exactly 30 (from A only)
			const distributeLedgers = allLedgers.filter((l) => l.reason === 'distribute');
			expect(distributeLedgers).toHaveLength(1);
			expect(distributeLedgers[0].qty).toBe('-30');
		});
	});

	describe('Same-Operation Reservation Idempotency', () => {
		it('accepts retry with same approval_operation_id and identical payload without double-counting', async () => {
			const inbound = await seedInboundLot('item:soap', 100, 'bar');
			const req = await repo.createRequest(
				{
					purpose: 'Idempotency test',
					active_headcount_snapshot: '40',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:soap',
							requested_qty: '40',
							unit: 'bar',
							distribution_type_snapshot: 'consumable',
							target_qty_snapshot: '44'
						}
					]
				},
				regCtx
			);

			const opId = '01JIDEMPOTENTOP';
			store.set(req._id, { ...req, status: 'approving', approval_operation_id: opId });

			// Pre-seed matching reservation claim
			const resId = await makeLotReservationDocId(inbound._id);
			const batchId = `distribution_batch:${req._id.slice('distribution_request:'.length)}`;
			store.set(resId, {
				_id: resId,
				_rev: nextRev(resId),
				type: 'stock_lot_reservation',
				lot_ref: inbound._id,
				pending_claims: [
					{
						operation_id: opId,
						request_id: req._id,
						batch_id: batchId,
						item_id: 'item:soap',
						lot_ref: inbound._id,
						qty: '40',
						claimed_at: '2026-08-29T10:00:00.000Z'
					}
				],
				shelter_code: 'SH001',
				created_at: '2026-08-29T10:00:00.000Z',
				updated_at: '2026-08-29T10:00:00.000Z',
				created_by: 'warehouse_bob',
				schema_v: 1
			});

			const batch = await repo.approveRequest(
				req._id,
				[{ item_id: 'item:soap', lot_ref: inbound._id, qty: '40' }],
				warehouseCtx
			);

			expect(batch.status).toBe('active');
		});

		it('throws ApprovalConflictError when same approval_operation_id has mismatched claim payload', async () => {
			const inbound = await seedInboundLot('item:soap', 100, 'bar');
			const req = await repo.createRequest(
				{
					purpose: 'Mismatch payload test',
					active_headcount_snapshot: '40',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:soap',
							requested_qty: '40',
							unit: 'bar',
							distribution_type_snapshot: 'consumable',
							target_qty_snapshot: '44'
						}
					]
				},
				regCtx
			);

			const opId = '01JMISMATCHOP';
			store.set(req._id, { ...req, status: 'approving', approval_operation_id: opId });

			// Pre-seed claim with DIFFERENT quantity (20 instead of 40)
			const resId = await makeLotReservationDocId(inbound._id);
			const batchId = `distribution_batch:${req._id.slice('distribution_request:'.length)}`;
			store.set(resId, {
				_id: resId,
				_rev: nextRev(resId),
				type: 'stock_lot_reservation',
				lot_ref: inbound._id,
				pending_claims: [
					{
						operation_id: opId,
						request_id: req._id,
						batch_id: batchId,
						item_id: 'item:soap',
						lot_ref: inbound._id,
						qty: '20', // Mismatch!
						claimed_at: '2026-08-29T10:00:00.000Z'
					}
				],
				shelter_code: 'SH001',
				created_at: '2026-08-29T10:00:00.000Z',
				updated_at: '2026-08-29T10:00:00.000Z',
				created_by: 'warehouse_bob',
				schema_v: 1
			});

			await expect(
				repo.approveRequest(
					req._id,
					[{ item_id: 'item:soap', lot_ref: inbound._id, qty: '40' }],
					warehouseCtx
				)
			).rejects.toThrow(ApprovalConflictError);
		});
	});

	describe('BLOCKER 1: Explicit Checkpoint Recovery Tests A–J', () => {
		it('Checkpoint A: resumes cleanly from request in approving status before claims', async () => {
			const inbound = await seedInboundLot('item:rice', 100);
			const req = await repo.createRequest(
				{
					purpose: 'Checkpoint A test',
					active_headcount_snapshot: '50',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:rice',
							requested_qty: '50',
							unit: 'kg',
							distribution_type_snapshot: 'one_time',
							target_qty_snapshot: '55'
						}
					]
				},
				regCtx
			);

			// Manually simulate crash at Checkpoint A: status is approving, operation_id set, 0 claims, 0 batch, 0 ledgers
			const opId = '01JCHECKPOINTA';
			store.set(req._id, { ...req, status: 'approving', approval_operation_id: opId });

			const batch = await repo.approveRequest(
				req._id,
				[{ item_id: 'item:rice', lot_ref: inbound._id, qty: '50' }],
				warehouseCtx
			);

			expect(batch.status).toBe('active');
			expect(batch.allocations[0].allocation_ledger_id).toBe(`stock_ledger:${opId}:0`);
			const updatedReq = await repo.getRequest(req._id);
			expect(updatedReq?.status).toBe('approved');
		});

		it('Checkpoint B: rolls back acquired claim on Lot 1 when Lot 2 claim fails', async () => {
			const lot1 = await seedInboundLot('item:rice', 50, 'kg', 'L-260829-001');
			const lot2 = await seedInboundLot('item:beans', 10, 'kg', 'L-260829-002');

			const req = await repo.createRequest(
				{
					purpose: 'Checkpoint B test',
					active_headcount_snapshot: '50',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:rice',
							requested_qty: '30',
							unit: 'kg',
							distribution_type_snapshot: 'one_time',
							target_qty_snapshot: '33'
						},
						{
							item_id: 'item:beans',
							requested_qty: '30',
							unit: 'kg',
							distribution_type_snapshot: 'one_time',
							target_qty_snapshot: '33'
						}
					]
				},
				regCtx
			);

			await expect(
				repo.approveRequest(
					req._id,
					[
						{ item_id: 'item:rice', lot_ref: lot1._id, qty: '30' },
						{ item_id: 'item:beans', lot_ref: lot2._id, qty: '30' }
					],
					warehouseCtx
				)
			).rejects.toThrow(InsufficientStockError);

			// Assert Lot 1 claim was released
			const res1Id = await makeLotReservationDocId(lot1._id);
			const res1Doc = store.get(res1Id) as StockLotReservation | undefined;
			expect(res1Doc?.pending_claims ?? []).toEqual([]);

			// Assert request reverted to pending
			const revertedReq = await repo.getRequest(req._id);
			expect(revertedReq?.status).toBe('pending');
		});

		it('Checkpoint C: resumes from state with all claims acquired, zero batch, zero ledgers', async () => {
			const lot1 = await seedInboundLot('item:rice', 50, 'kg', 'L-260829-001');
			const lot2 = await seedInboundLot('item:beans', 50, 'kg', 'L-260829-002');

			const req = await repo.createRequest(
				{
					purpose: 'Checkpoint C test',
					active_headcount_snapshot: '50',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:rice',
							requested_qty: '30',
							unit: 'kg',
							distribution_type_snapshot: 'one_time',
							target_qty_snapshot: '33'
						},
						{
							item_id: 'item:beans',
							requested_qty: '30',
							unit: 'kg',
							distribution_type_snapshot: 'one_time',
							target_qty_snapshot: '33'
						}
					]
				},
				regCtx
			);

			const opId = '01JCHECKPOINTC';
			store.set(req._id, { ...req, status: 'approving', approval_operation_id: opId });

			const batchId = `distribution_batch:${req._id.slice('distribution_request:'.length)}`;

			// Pre-acquire ALL required claims in reservation docs
			const res1Id = await makeLotReservationDocId(lot1._id);
			store.set(res1Id, {
				_id: res1Id,
				_rev: nextRev(res1Id),
				type: 'stock_lot_reservation',
				lot_ref: lot1._id,
				pending_claims: [
					{
						operation_id: opId,
						request_id: req._id,
						batch_id: batchId,
						item_id: 'item:rice',
						lot_ref: lot1._id,
						qty: '30',
						claimed_at: '2026-08-29T10:00:00.000Z'
					}
				],
				shelter_code: 'SH001',
				created_at: '2026-08-29T10:00:00.000Z',
				updated_at: '2026-08-29T10:00:00.000Z',
				created_by: 'warehouse_bob',
				schema_v: 1
			});

			const res2Id = await makeLotReservationDocId(lot2._id);
			store.set(res2Id, {
				_id: res2Id,
				_rev: nextRev(res2Id),
				type: 'stock_lot_reservation',
				lot_ref: lot2._id,
				pending_claims: [
					{
						operation_id: opId,
						request_id: req._id,
						batch_id: batchId,
						item_id: 'item:beans',
						lot_ref: lot2._id,
						qty: '30',
						claimed_at: '2026-08-29T10:00:00.000Z'
					}
				],
				shelter_code: 'SH001',
				created_at: '2026-08-29T10:00:00.000Z',
				updated_at: '2026-08-29T10:00:00.000Z',
				created_by: 'warehouse_bob',
				schema_v: 1
			});

			// No batch and no ledgers exist yet
			expect(store.get(batchId)).toBeUndefined();
			expect(Array.from(store.values()).filter((d) => d.type === 'stock_ledger')).toHaveLength(2); // Only inbounds

			// Retry approval from Checkpoint C
			const batch = await repo.approveRequest(
				req._id,
				[
					{ item_id: 'item:rice', lot_ref: lot1._id, qty: '30' },
					{ item_id: 'item:beans', lot_ref: lot2._id, qty: '30' }
				],
				warehouseCtx
			);

			// Assertions:
			// 1. Same operation_id reused and no duplicate claims created during retry
			expect(batch._id).toBe(batchId);
			expect(batch.status).toBe('active');
			expect(batch.allocations[0].allocation_ledger_id).toMatch(
				new RegExp(`^stock_ledger:${opId}:`)
			);

			// 2. Request approved
			const updatedReq = await repo.getRequest(req._id);
			expect(updatedReq?.status).toBe('approved');
			expect(updatedReq?.approval_operation_id).toBe(opId);

			// 3. Outbound ledgers written
			const allLedgers = Array.from(store.values()).filter(
				(d) => d.type === 'stock_ledger' && d.reason === 'distribute'
			);
			expect(allLedgers).toHaveLength(2);

			// 4. Claims released
			const finalRes1 = store.get(res1Id) as unknown as StockLotReservation;
			const finalRes2 = store.get(res2Id) as unknown as StockLotReservation;
			expect(finalRes1.pending_claims).toEqual([]);
			expect(finalRes2.pending_claims).toEqual([]);
		});

		it('Checkpoint D: resumes from activating batch with zero outbound ledgers', async () => {
			const lot = await seedInboundLot('item:soap', 100, 'bar');

			const req = await repo.createRequest(
				{
					purpose: 'Checkpoint D recovery test',
					active_headcount_snapshot: '40',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:soap',
							requested_qty: '40',
							unit: 'bar',
							distribution_type_snapshot: 'consumable',
							target_qty_snapshot: '44'
						}
					]
				},
				regCtx
			);

			const opId = '01JCHECKPOINTDOK';
			store.set(req._id, { ...req, status: 'approving', approval_operation_id: opId });

			const batchId = `distribution_batch:${req._id.slice('distribution_request:'.length)}`;
			const ledgerId = `stock_ledger:${opId}:0`;

			// Activating batch exists, but ZERO outbound ledgers exist
			store.set(batchId, {
				_id: batchId,
				_rev: nextRev(batchId),
				type: 'distribution_batch',
				request_id: req._id,
				status: 'activating',
				shelter_code: 'SH001',
				created_at: '2026-08-29T10:00:00.000Z',
				updated_at: '2026-08-29T10:00:00.000Z',
				created_by: 'warehouse_bob',
				activated_by: 'warehouse_bob',
				activated_at: '2026-08-29T10:00:00.000Z',
				items: [
					{
						item_id: 'item:soap',
						allocated_qty: '40',
						unit: 'bar',
						distribution_type_snapshot: 'consumable'
					}
				],
				allocations: [
					{
						item_id: 'item:soap',
						lot_ref: lot._id,
						lot: {},
						qty: '40',
						allocation_ledger_id: ledgerId
					}
				],
				reconciliation: [],
				return_ledger_ids: [],
				schema_v: 1
			});

			// Pre-seed claim in reservation doc
			const resId = await makeLotReservationDocId(lot._id);
			store.set(resId, {
				_id: resId,
				_rev: nextRev(resId),
				type: 'stock_lot_reservation',
				lot_ref: lot._id,
				pending_claims: [
					{
						operation_id: opId,
						request_id: req._id,
						batch_id: batchId,
						item_id: 'item:soap',
						lot_ref: lot._id,
						qty: '40',
						claimed_at: '2026-08-29T10:00:00.000Z'
					}
				],
				shelter_code: 'SH001',
				created_at: '2026-08-29T10:00:00.000Z',
				updated_at: '2026-08-29T10:00:00.000Z',
				created_by: 'warehouse_bob',
				schema_v: 1
			});

			expect(store.get(ledgerId)).toBeUndefined();

			// Retry with matching allocation intent
			const batch = await repo.approveRequest(
				req._id,
				[{ item_id: 'item:soap', lot_ref: lot._id, qty: '40' }],
				warehouseCtx
			);

			// Assertions:
			// 1. Missing ledger created and verified
			expect(store.get(ledgerId)).toBeDefined();

			// 2. Batch transitioned activating -> active
			expect(batch._id).toBe(batchId);
			expect(batch.status).toBe('active');

			// 3. Request transitioned approving -> approved
			const updatedReq = await repo.getRequest(req._id);
			expect(updatedReq?.status).toBe('approved');
			expect(updatedReq?.approval_operation_id).toBe(opId);

			// 4. Claims released
			const finalRes = store.get(resId) as unknown as StockLotReservation;
			expect(finalRes.pending_claims).toEqual([]);
		});

		it('Checkpoint D (tamper rejection): rejects retry with altered allocation intent when activating batch already exists', async () => {
			const lot1 = await seedInboundLot('item:soap', 100, 'bar', 'L-260829-001');
			const lot2 = await seedInboundLot('item:soap', 100, 'bar', 'L-260829-002');

			const req = await repo.createRequest(
				{
					purpose: 'Checkpoint D tamper test',
					active_headcount_snapshot: '40',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:soap',
							requested_qty: '40',
							unit: 'bar',
							distribution_type_snapshot: 'consumable',
							target_qty_snapshot: '44'
						}
					]
				},
				regCtx
			);

			const opId = '01JCHECKPOINTDTAMPER';
			store.set(req._id, { ...req, status: 'approving', approval_operation_id: opId });

			const batchId = `distribution_batch:${req._id.slice('distribution_request:'.length)}`;
			store.set(batchId, {
				_id: batchId,
				_rev: nextRev(batchId),
				type: 'distribution_batch',
				request_id: req._id,
				status: 'activating',
				shelter_code: 'SH001',
				created_at: '2026-08-29T10:00:00.000Z',
				updated_at: '2026-08-29T10:00:00.000Z',
				created_by: 'warehouse_bob',
				activated_by: 'warehouse_bob',
				activated_at: '2026-08-29T10:00:00.000Z',
				items: [
					{
						item_id: 'item:soap',
						allocated_qty: '40',
						unit: 'bar',
						distribution_type_snapshot: 'consumable'
					}
				],
				allocations: [
					{
						item_id: 'item:soap',
						lot_ref: lot1._id,
						lot: {},
						qty: '40',
						allocation_ledger_id: `stock_ledger:${opId}:0`
					}
				],
				reconciliation: [],
				return_ledger_ids: [],
				schema_v: 1
			});

			// Retry with lot2 instead of lot1 -> Throws ApprovalConflictError
			await expect(
				repo.approveRequest(
					req._id,
					[{ item_id: 'item:soap', lot_ref: lot2._id, qty: '40' }],
					warehouseCtx
				)
			).rejects.toThrow(ApprovalConflictError);
		});

		it('Checkpoint E: resumes when ledger line 0 exists and line 1 is missing', async () => {
			const lot1 = await seedInboundLot('item:rice', 50, 'kg', 'L-260829-001');
			const lot2 = await seedInboundLot('item:beans', 50, 'kg', 'L-260829-002');
			const [firstLot, secondLot] = [lot1._id, lot2._id].sort();

			const req = await repo.createRequest(
				{
					purpose: 'Checkpoint E test',
					active_headcount_snapshot: '50',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:rice',
							requested_qty: '30',
							unit: 'kg',
							distribution_type_snapshot: 'one_time',
							target_qty_snapshot: '33'
						},
						{
							item_id: 'item:beans',
							requested_qty: '30',
							unit: 'kg',
							distribution_type_snapshot: 'one_time',
							target_qty_snapshot: '33'
						}
					]
				},
				regCtx
			);

			const opId = '01JCHECKPOINTE';
			store.set(req._id, { ...req, status: 'approving', approval_operation_id: opId });

			const batchId = `distribution_batch:${req._id.slice('distribution_request:'.length)}`;
			const ledger0Id = `stock_ledger:${opId}:0`;
			const ledger1Id = `stock_ledger:${opId}:1`;

			const firstItem = firstLot === lot1._id ? 'item:rice' : 'item:beans';
			const secondItem = firstItem === 'item:rice' ? 'item:beans' : 'item:rice';

			// Persist activating batch
			store.set(batchId, {
				_id: batchId,
				_rev: nextRev(batchId),
				type: 'distribution_batch',
				request_id: req._id,
				status: 'activating',
				shelter_code: 'SH001',
				created_at: '2026-08-29T10:00:00.000Z',
				updated_at: '2026-08-29T10:00:00.000Z',
				created_by: 'warehouse_bob',
				activated_by: 'warehouse_bob',
				activated_at: '2026-08-29T10:00:00.000Z',
				items: [
					{
						item_id: 'item:rice',
						allocated_qty: '30',
						unit: 'kg',
						distribution_type_snapshot: 'one_time'
					},
					{
						item_id: 'item:beans',
						allocated_qty: '30',
						unit: 'kg',
						distribution_type_snapshot: 'one_time'
					}
				],
				allocations: [
					{
						item_id: firstItem,
						lot_ref: firstLot,
						lot: {},
						qty: '30',
						allocation_ledger_id: ledger0Id
					},
					{
						item_id: secondItem,
						lot_ref: secondLot,
						lot: {},
						qty: '30',
						allocation_ledger_id: ledger1Id
					}
				],
				reconciliation: [],
				return_ledger_ids: [],
				schema_v: 1
			});

			// Ledger line 0 exists, ledger line 1 does not exist
			store.set(ledger0Id, {
				_id: ledger0Id,
				_rev: nextRev(ledger0Id),
				type: 'stock_ledger',
				item_id: firstItem,
				qty: '-30',
				unit: 'kg',
				reason: 'distribute',
				ref_id: batchId,
				lot_ref: firstLot,
				shelter_code: 'SH001',
				created_at: '2026-08-29T10:00:00.000Z',
				updated_at: '2026-08-29T10:00:00.000Z',
				occurred_at: '2026-08-29T10:00:00.000Z',
				created_by: 'warehouse_bob',
				schema_v: 1
			});

			expect(store.get(ledger1Id)).toBeUndefined();

			// Retry approval
			const batch = await repo.approveRequest(
				req._id,
				[
					{ item_id: 'item:rice', lot_ref: lot1._id, qty: '30' },
					{ item_id: 'item:beans', lot_ref: lot2._id, qty: '30' }
				],
				warehouseCtx
			);

			// Assertions:
			// 1. Line 0 reused and verified, line 1 created
			expect(store.get(ledger1Id)).toBeDefined();
			expect(batch.status).toBe('active');

			// 2. Request approved
			const updatedReq = await repo.getRequest(req._id);
			expect(updatedReq?.status).toBe('approved');
			expect(updatedReq?.batch_id).toBe(batch._id);

			// 3. Final stock deduction equals canonical allocation total (-30 for rice, -30 for beans)
			const allLedgers = Array.from(store.values()).filter(
				(d) => d.type === 'stock_ledger'
			) as unknown as StockLedger[];
			const riceLedgers = allLedgers.filter(
				(l) => l.item_id === 'item:rice' && l.reason === 'distribute'
			);
			const beanLedgers = allLedgers.filter(
				(l) => l.item_id === 'item:beans' && l.reason === 'distribute'
			);
			expect(riceLedgers).toHaveLength(1);
			expect(beanLedgers).toHaveLength(1);
			expect(riceLedgers[0].qty).toBe('-30');
			expect(beanLedgers[0].qty).toBe('-30');
		});

		it('Checkpoint F: resumes when lines 0 and 1 exist and line 2 is missing (3 allocation lines)', async () => {
			const lot1 = await seedInboundLot('item:rice', 50, 'kg', 'L-260829-001');
			const lot2 = await seedInboundLot('item:beans', 50, 'kg', 'L-260829-002');
			const lot3 = await seedInboundLot('item:oil', 50, 'bottle', 'L-260829-003');

			const sortedLots = [
				{ lot_ref: lot1._id, item_id: 'item:rice', unit: 'kg' },
				{ lot_ref: lot2._id, item_id: 'item:beans', unit: 'kg' },
				{ lot_ref: lot3._id, item_id: 'item:oil', unit: 'bottle' }
			].sort((a, b) => a.lot_ref.localeCompare(b.lot_ref) || a.item_id.localeCompare(b.item_id));

			const req = await repo.createRequest(
				{
					purpose: 'Checkpoint F test (3 items)',
					active_headcount_snapshot: '50',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:rice',
							requested_qty: '20',
							unit: 'kg',
							distribution_type_snapshot: 'one_time',
							target_qty_snapshot: '22'
						},
						{
							item_id: 'item:beans',
							requested_qty: '20',
							unit: 'kg',
							distribution_type_snapshot: 'one_time',
							target_qty_snapshot: '22'
						},
						{
							item_id: 'item:oil',
							requested_qty: '20',
							unit: 'bottle',
							distribution_type_snapshot: 'one_time',
							target_qty_snapshot: '22'
						}
					]
				},
				regCtx
			);

			const opId = '01JCHECKPOINTF';
			store.set(req._id, { ...req, status: 'approving', approval_operation_id: opId });

			const batchId = `distribution_batch:${req._id.slice('distribution_request:'.length)}`;
			const ledger0Id = `stock_ledger:${opId}:0`;
			const ledger1Id = `stock_ledger:${opId}:1`;
			const ledger2Id = `stock_ledger:${opId}:2`;

			// Persist activating batch with 3 allocations
			store.set(batchId, {
				_id: batchId,
				_rev: nextRev(batchId),
				type: 'distribution_batch',
				request_id: req._id,
				status: 'activating',
				shelter_code: 'SH001',
				created_at: '2026-08-29T10:00:00.000Z',
				updated_at: '2026-08-29T10:00:00.000Z',
				created_by: 'warehouse_bob',
				activated_by: 'warehouse_bob',
				activated_at: '2026-08-29T10:00:00.000Z',
				items: [
					{
						item_id: 'item:rice',
						allocated_qty: '20',
						unit: 'kg',
						distribution_type_snapshot: 'one_time'
					},
					{
						item_id: 'item:beans',
						allocated_qty: '20',
						unit: 'kg',
						distribution_type_snapshot: 'one_time'
					},
					{
						item_id: 'item:oil',
						allocated_qty: '20',
						unit: 'bottle',
						distribution_type_snapshot: 'one_time'
					}
				],
				allocations: [
					{
						item_id: sortedLots[0].item_id,
						lot_ref: sortedLots[0].lot_ref,
						lot: {},
						qty: '20',
						allocation_ledger_id: ledger0Id
					},
					{
						item_id: sortedLots[1].item_id,
						lot_ref: sortedLots[1].lot_ref,
						lot: {},
						qty: '20',
						allocation_ledger_id: ledger1Id
					},
					{
						item_id: sortedLots[2].item_id,
						lot_ref: sortedLots[2].lot_ref,
						lot: {},
						qty: '20',
						allocation_ledger_id: ledger2Id
					}
				],
				reconciliation: [],
				return_ledger_ids: [],
				schema_v: 1
			});

			// Lines 0 and 1 exist
			store.set(ledger0Id, {
				_id: ledger0Id,
				_rev: nextRev(ledger0Id),
				type: 'stock_ledger',
				item_id: sortedLots[0].item_id,
				qty: '-20',
				unit: sortedLots[0].unit,
				reason: 'distribute',
				ref_id: batchId,
				lot_ref: sortedLots[0].lot_ref,
				shelter_code: 'SH001',
				created_at: '2026-08-29T10:00:00.000Z',
				updated_at: '2026-08-29T10:00:00.000Z',
				occurred_at: '2026-08-29T10:00:00.000Z',
				created_by: 'warehouse_bob',
				schema_v: 1
			});

			store.set(ledger1Id, {
				_id: ledger1Id,
				_rev: nextRev(ledger1Id),
				type: 'stock_ledger',
				item_id: sortedLots[1].item_id,
				qty: '-20',
				unit: sortedLots[1].unit,
				reason: 'distribute',
				ref_id: batchId,
				lot_ref: sortedLots[1].lot_ref,
				shelter_code: 'SH001',
				created_at: '2026-08-29T10:00:00.000Z',
				updated_at: '2026-08-29T10:00:00.000Z',
				occurred_at: '2026-08-29T10:00:00.000Z',
				created_by: 'warehouse_bob',
				schema_v: 1
			});

			expect(store.get(ledger2Id)).toBeUndefined();

			// Retry approval
			const batch = await repo.approveRequest(
				req._id,
				[
					{ item_id: 'item:rice', lot_ref: lot1._id, qty: '20' },
					{ item_id: 'item:beans', lot_ref: lot2._id, qty: '20' },
					{ item_id: 'item:oil', lot_ref: lot3._id, qty: '20' }
				],
				warehouseCtx
			);

			// Assertions:
			// 1. Line 2 was created and batch activated
			expect(store.get(ledger2Id)).toBeDefined();
			expect(batch.status).toBe('active');

			// 2. Exactly 3 outbound ledgers exist in total
			const allLedgers = Array.from(store.values()).filter(
				(d) => d.type === 'stock_ledger'
			) as unknown as StockLedger[];
			const distributeLedgers = allLedgers.filter((l) => l.reason === 'distribute');
			expect(distributeLedgers).toHaveLength(3);
			expect(distributeLedgers.map((l) => l._id).sort()).toEqual(
				[ledger0Id, ledger1Id, ledger2Id].sort()
			);
		});

		it('Checkpoint G: resumes when all deterministic ledgers exist, verifying zero recreation', async () => {
			const lot = await seedInboundLot('item:rice', 100, 'kg');
			const req = await repo.createRequest(
				{
					purpose: 'Checkpoint G test',
					active_headcount_snapshot: '50',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:rice',
							requested_qty: '50',
							unit: 'kg',
							distribution_type_snapshot: 'one_time',
							target_qty_snapshot: '55'
						}
					]
				},
				regCtx
			);

			const opId = '01JCHECKPOINTG';
			store.set(req._id, { ...req, status: 'approving', approval_operation_id: opId });

			const batchId = `distribution_batch:${req._id.slice('distribution_request:'.length)}`;
			const ledgerId = `stock_ledger:${opId}:0`;

			store.set(batchId, {
				_id: batchId,
				_rev: nextRev(batchId),
				type: 'distribution_batch',
				request_id: req._id,
				status: 'activating',
				shelter_code: 'SH001',
				created_at: '2026-08-29T10:00:00.000Z',
				updated_at: '2026-08-29T10:00:00.000Z',
				created_by: 'warehouse_bob',
				activated_by: 'warehouse_bob',
				activated_at: '2026-08-29T10:00:00.000Z',
				items: [
					{
						item_id: 'item:rice',
						allocated_qty: '50',
						unit: 'kg',
						distribution_type_snapshot: 'one_time'
					}
				],
				allocations: [
					{
						item_id: 'item:rice',
						lot_ref: lot._id,
						lot: {},
						qty: '50',
						allocation_ledger_id: ledgerId
					}
				],
				reconciliation: [],
				return_ledger_ids: [],
				schema_v: 1
			});

			store.set(ledgerId, {
				_id: ledgerId,
				_rev: nextRev(ledgerId),
				type: 'stock_ledger',
				item_id: 'item:rice',
				qty: '-50',
				unit: 'kg',
				reason: 'distribute',
				ref_id: batchId,
				lot_ref: lot._id,
				shelter_code: 'SH001',
				created_at: '2026-08-29T10:00:00.000Z',
				updated_at: '2026-08-29T10:00:00.000Z',
				occurred_at: '2026-08-29T10:00:00.000Z',
				created_by: 'warehouse_bob',
				schema_v: 1
			});

			// Count ledgers before retry
			const countBefore = Array.from(store.values()).filter(
				(d) => d.type === 'stock_ledger'
			).length;

			// Retry approval
			const batch = await repo.approveRequest(
				req._id,
				[{ item_id: 'item:rice', lot_ref: lot._id, qty: '50' }],
				warehouseCtx
			);

			// Count ledgers after retry
			const countAfter = Array.from(store.values()).filter((d) => d.type === 'stock_ledger').length;
			expect(countAfter).toBe(countBefore); // Proves NO ledger was recreated

			expect(batch.status).toBe('active');
			const updatedReq = await repo.getRequest(req._id);
			expect(updatedReq?.status).toBe('approved');
		});

		it('Checkpoint H: recovers when ledgers exist and batch is still activating', async () => {
			const lot = await seedInboundLot('item:rice', 100, 'kg');

			const req = await repo.createRequest(
				{
					purpose: 'Checkpoint H test',
					active_headcount_snapshot: '50',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:rice',
							requested_qty: '50',
							unit: 'kg',
							distribution_type_snapshot: 'one_time',
							target_qty_snapshot: '55'
						}
					]
				},
				regCtx
			);

			const opId = '01JCHECKPOINTH';
			store.set(req._id, { ...req, status: 'approving', approval_operation_id: opId });

			const batchId = `distribution_batch:${req._id.slice('distribution_request:'.length)}`;
			const ledgerId = `stock_ledger:${opId}:0`;

			store.set(batchId, {
				_id: batchId,
				_rev: nextRev(batchId),
				type: 'distribution_batch',
				request_id: req._id,
				status: 'activating',
				shelter_code: 'SH001',
				created_at: '2026-08-29T10:00:00.000Z',
				updated_at: '2026-08-29T10:00:00.000Z',
				created_by: 'warehouse_bob',
				activated_by: 'warehouse_bob',
				activated_at: '2026-08-29T10:00:00.000Z',
				items: [
					{
						item_id: 'item:rice',
						allocated_qty: '50',
						unit: 'kg',
						distribution_type_snapshot: 'one_time'
					}
				],
				allocations: [
					{
						item_id: 'item:rice',
						lot_ref: lot._id,
						lot: {},
						qty: '50',
						allocation_ledger_id: ledgerId
					}
				],
				reconciliation: [],
				return_ledger_ids: [],
				schema_v: 1
			});

			store.set(ledgerId, {
				_id: ledgerId,
				_rev: nextRev(ledgerId),
				type: 'stock_ledger',
				item_id: 'item:rice',
				qty: '-50',
				unit: 'kg',
				reason: 'distribute',
				ref_id: batchId,
				lot_ref: lot._id,
				shelter_code: 'SH001',
				created_at: '2026-08-29T10:00:00.000Z',
				updated_at: '2026-08-29T10:00:00.000Z',
				occurred_at: '2026-08-29T10:00:00.000Z',
				created_by: 'warehouse_bob',
				schema_v: 1
			});

			const batch = await repo.approveRequest(
				req._id,
				[{ item_id: 'item:rice', lot_ref: lot._id, qty: '50' }],
				warehouseCtx
			);

			expect(batch.status).toBe('active');
			const updatedReq = await repo.getRequest(req._id);
			expect(updatedReq?.status).toBe('approved');
		});

		it('Checkpoint I: recovers when batch is already active and request is still approving', async () => {
			const lot = await seedInboundLot('item:rice', 100, 'kg');

			const req = await repo.createRequest(
				{
					purpose: 'Checkpoint I test',
					active_headcount_snapshot: '50',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:rice',
							requested_qty: '50',
							unit: 'kg',
							distribution_type_snapshot: 'one_time',
							target_qty_snapshot: '55'
						}
					]
				},
				regCtx
			);

			const opId = '01JCHECKPOINTI';
			store.set(req._id, { ...req, status: 'approving', approval_operation_id: opId });

			const batchId = `distribution_batch:${req._id.slice('distribution_request:'.length)}`;
			const ledgerId = `stock_ledger:${opId}:0`;

			store.set(batchId, {
				_id: batchId,
				_rev: nextRev(batchId),
				type: 'distribution_batch',
				request_id: req._id,
				status: 'active',
				shelter_code: 'SH001',
				created_at: '2026-08-29T10:00:00.000Z',
				updated_at: '2026-08-29T10:00:00.000Z',
				created_by: 'warehouse_bob',
				activated_by: 'warehouse_bob',
				activated_at: '2026-08-29T10:00:00.000Z',
				items: [
					{
						item_id: 'item:rice',
						allocated_qty: '50',
						unit: 'kg',
						distribution_type_snapshot: 'one_time'
					}
				],
				allocations: [
					{
						item_id: 'item:rice',
						lot_ref: lot._id,
						lot: {},
						qty: '50',
						allocation_ledger_id: ledgerId
					}
				],
				reconciliation: [],
				return_ledger_ids: [],
				schema_v: 1
			});

			store.set(ledgerId, {
				_id: ledgerId,
				_rev: nextRev(ledgerId),
				type: 'stock_ledger',
				item_id: 'item:rice',
				qty: '-50',
				unit: 'kg',
				reason: 'distribute',
				ref_id: batchId,
				lot_ref: lot._id,
				shelter_code: 'SH001',
				created_at: '2026-08-29T10:00:00.000Z',
				updated_at: '2026-08-29T10:00:00.000Z',
				occurred_at: '2026-08-29T10:00:00.000Z',
				created_by: 'warehouse_bob',
				schema_v: 1
			});

			const batch = await repo.approveRequest(
				req._id,
				[{ item_id: 'item:rice', lot_ref: lot._id, qty: '50' }],
				warehouseCtx
			);

			expect(batch.status).toBe('active');
			const updatedReq = await repo.getRequest(req._id);
			expect(updatedReq?.status).toBe('approved');
		});

		it('Checkpoint J: clears stale reservation claims when request is already approved', async () => {
			const lot = await seedInboundLot('item:rice', 100, 'kg');

			const req = await repo.createRequest(
				{
					purpose: 'Checkpoint J test',
					active_headcount_snapshot: '50',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:rice',
							requested_qty: '50',
							unit: 'kg',
							distribution_type_snapshot: 'one_time',
							target_qty_snapshot: '55'
						}
					]
				},
				regCtx
			);

			const opId = '01JCHECKPOINTJ';
			const batchId = `distribution_batch:${req._id.slice('distribution_request:'.length)}`;
			const ledgerId = `stock_ledger:${opId}:0`;

			// Request is approved
			store.set(req._id, {
				...req,
				status: 'approved',
				batch_id: batchId,
				approval_operation_id: opId,
				approved_by: 'warehouse_bob',
				approved_at: '2026-08-29T10:00:00.000Z'
			});

			// Batch is active
			store.set(batchId, {
				_id: batchId,
				_rev: nextRev(batchId),
				type: 'distribution_batch',
				request_id: req._id,
				status: 'active',
				shelter_code: 'SH001',
				created_at: '2026-08-29T10:00:00.000Z',
				updated_at: '2026-08-29T10:00:00.000Z',
				created_by: 'warehouse_bob',
				activated_by: 'warehouse_bob',
				activated_at: '2026-08-29T10:00:00.000Z',
				items: [
					{
						item_id: 'item:rice',
						allocated_qty: '50',
						unit: 'kg',
						distribution_type_snapshot: 'one_time'
					}
				],
				allocations: [
					{
						item_id: 'item:rice',
						lot_ref: lot._id,
						lot: {},
						qty: '50',
						allocation_ledger_id: ledgerId
					}
				],
				reconciliation: [],
				return_ledger_ids: [],
				schema_v: 1
			});

			// Outbound ledger exists
			store.set(ledgerId, {
				_id: ledgerId,
				_rev: nextRev(ledgerId),
				type: 'stock_ledger',
				item_id: 'item:rice',
				qty: '-50',
				unit: 'kg',
				reason: 'distribute',
				ref_id: batchId,
				lot_ref: lot._id,
				shelter_code: 'SH001',
				created_at: '2026-08-29T10:00:00.000Z',
				updated_at: '2026-08-29T10:00:00.000Z',
				occurred_at: '2026-08-29T10:00:00.000Z',
				created_by: 'warehouse_bob',
				schema_v: 1
			});

			// Stale reservation claim still exists in reservation doc
			const resId = await makeLotReservationDocId(lot._id);
			store.set(resId, {
				_id: resId,
				_rev: nextRev(resId),
				type: 'stock_lot_reservation',
				lot_ref: lot._id,
				pending_claims: [
					{
						operation_id: opId,
						request_id: req._id,
						batch_id: batchId,
						item_id: 'item:rice',
						lot_ref: lot._id,
						qty: '50',
						claimed_at: '2026-08-29T10:00:00.000Z'
					}
				],
				shelter_code: 'SH001',
				created_at: '2026-08-29T10:00:00.000Z',
				updated_at: '2026-08-29T10:00:00.000Z',
				created_by: 'warehouse_bob',
				schema_v: 1
			});

			// Call approveRequest (idempotent / Checkpoint J recovery)
			const batch = await repo.approveRequest(
				req._id,
				[{ item_id: 'item:rice', lot_ref: lot._id, qty: '50' }],
				warehouseCtx
			);

			// Assertions:
			// 1. Batch returned and still active
			expect(batch._id).toBe(batchId);
			expect(batch.status).toBe('active');

			// 2. Stale reservation claim for opId was removed
			const resDoc = store.get(resId) as unknown as StockLotReservation;
			expect(resDoc.pending_claims.filter((c) => c.operation_id === opId)).toHaveLength(0);

			// 3. No new stock ledger created
			const distributeLedgers = Array.from(store.values()).filter(
				(d) => d.type === 'stock_ledger' && d.reason === 'distribute'
			);
			expect(distributeLedgers).toHaveLength(1);

			// 4. Request remains approved with same batch_id and operation_id
			const updatedReq = await repo.getRequest(req._id);
			expect(updatedReq?.status).toBe('approved');
			expect(updatedReq?.approval_operation_id).toBe(opId);
		});
	});

	describe('T3A-01: Lifecycle — Full Approval Flow', () => {
		it('approves a pending request, writes deterministic ledgers, activates batch, and releases claims', async () => {
			const inbound = await seedInboundLot('item:rice', 100);

			const request = await repo.createRequest(
				{
					purpose: 'Daily emergency rations',
					active_headcount_snapshot: '50',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:rice',
							requested_qty: '55',
							unit: 'kg',
							distribution_type_snapshot: 'one_time',
							target_qty_snapshot: '55'
						}
					]
				},
				regCtx
			);

			expect(request.status).toBe('pending');
			couchCallCount = 0;
			stockLedgerProjectionReads = 0;
			getDocCalls = [];

			const batch = await repo.approveRequest(
				request._id,
				[
					{
						item_id: 'item:rice',
						lot_ref: inbound._id,
						qty: '55'
					}
				],
				warehouseCtx
			);
			const approvalCouchCallCount = couchCallCount;

			expect(batch.status).toBe('active');
			expect(batch.request_id).toBe(request._id);
			expect(batch.items[0]).toMatchObject({
				item_id: 'item:rice',
				allocated_qty: '55',
				unit: 'kg'
			});
			expect(batch.allocations[0]).toMatchObject({
				item_id: 'item:rice',
				lot_ref: inbound._id,
				qty: '55'
			});

			// Verify request transition
			const updatedReq = await repo.getRequest(request._id);
			expect(updatedReq?.status).toBe('approved');
			expect(updatedReq?.batch_id).toBe(batch._id);
			expect(updatedReq?.approved_by).toBe('warehouse_bob');

			// Verify outbound stock ledger
			const ledgerId = batch.allocations[0].allocation_ledger_id;
			const ledger = store.get(ledgerId) as StockLedger | undefined;
			expect(ledger).toBeDefined();
			expect(ledger?.reason).toBe('distribute');
			expect(ledger?.qty).toBe('-55');
			expect(ledger?.ref_id).toBe(batch._id);
			expect(ledger?.lot_ref).toBe(inbound._id);

			// Verify reservation claims released
			const resId = await makeLotReservationDocId(inbound._id);
			const resDoc = store.get(resId) as StockLotReservation | undefined;
			expect(resDoc?.pending_claims).toEqual([]);

			// Fresh approval keeps the capacity read at claim time, then takes one
			// post-write physical-lot snapshot for both activating/active verification.
			expect(stockLedgerProjectionReads).toBe(3);
			expect(approvalCouchCallCount).toBe(20);
			expect(getDocCalls.filter((id) => id === inbound._id)).toHaveLength(1);
			expect(
				getDocCalls.filter((id) => id === batch.allocations[0].allocation_ledger_id)
			).toHaveLength(1);
		});
	});

	describe('T3A-04: Multi-Lot Allocation with Canonical Sorting', () => {
		it('sorts allocations by lot_ref ascending and item_id ascending deterministically', async () => {
			const lotB = await seedInboundLot('item:rice', 50, 'kg', 'L-260829-002');
			const lotA = await seedInboundLot('item:rice', 50, 'kg', 'L-260829-001');

			const [firstLot, secondLot] = [lotA._id, lotB._id].sort();

			const req = await repo.createRequest(
				{
					purpose: 'Multi lot distribution',
					active_headcount_snapshot: '80',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:rice',
							requested_qty: '80',
							unit: 'kg',
							distribution_type_snapshot: 'one_time',
							target_qty_snapshot: '88'
						}
					]
				},
				regCtx
			);

			// Pass in reverse order
			const batch = await repo.approveRequest(
				req._id,
				[
					{ item_id: 'item:rice', lot_ref: secondLot, qty: '40' },
					{ item_id: 'item:rice', lot_ref: firstLot, qty: '40' }
				],
				warehouseCtx
			);

			// Allocations in batch must be canonically sorted by lot_ref asc
			expect(batch.allocations[0].lot_ref).toBe(firstLot);
			expect(batch.allocations[0].allocation_ledger_id).toMatch(/:0$/);
			expect(batch.allocations[1].lot_ref).toBe(secondLot);
			expect(batch.allocations[1].allocation_ledger_id).toMatch(/:1$/);
		});
	});

	describe('T3A-05 to T3A-10: Partial Approval Policy & Validation', () => {
		it('T3A-05: allows partial quantity approval (requested 100, allocated 60)', async () => {
			const lot = await seedInboundLot('item:blanket', 60, 'piece');

			const req = await repo.createRequest(
				{
					purpose: 'Partial allocation',
					active_headcount_snapshot: '100',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:blanket',
							requested_qty: '100',
							unit: 'piece',
							distribution_type_snapshot: 'one_time',
							target_qty_snapshot: '110'
						}
					]
				},
				regCtx
			);

			const batch = await repo.approveRequest(
				req._id,
				[{ item_id: 'item:blanket', lot_ref: lot._id, qty: '60' }],
				warehouseCtx
			);

			expect(batch.status).toBe('active');
			expect(batch.items[0].allocated_qty).toBe('60');

			const updatedReq = await repo.getRequest(req._id);
			expect(updatedReq?.status).toBe('approved');
			expect(updatedReq?.items[0].requested_qty).toBe('100'); // Audit preserved
		});

		it('T3A-06: allows omitting unallocated requested item if at least one item is allocated', async () => {
			const lotRice = await seedInboundLot('item:rice', 50, 'kg');

			const req = await repo.createRequest(
				{
					purpose: 'Two items requested, only one available',
					active_headcount_snapshot: '50',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:rice',
							requested_qty: '50',
							unit: 'kg',
							distribution_type_snapshot: 'one_time',
							target_qty_snapshot: '55'
						},
						{
							item_id: 'item:oil',
							requested_qty: '20',
							unit: 'bottle',
							distribution_type_snapshot: 'one_time',
							target_qty_snapshot: '22'
						}
					]
				},
				regCtx
			);

			const batch = await repo.approveRequest(
				req._id,
				[{ item_id: 'item:rice', lot_ref: lotRice._id, qty: '50' }],
				warehouseCtx
			);

			expect(batch.items).toHaveLength(1);
			expect(batch.items[0].item_id).toBe('item:rice');
		});

		it('T3A-07: rejects allocation exceeding requested quantity (requested 100, allocated 101)', async () => {
			const lot = await seedInboundLot('item:blanket', 200, 'piece');

			const req = await repo.createRequest(
				{
					purpose: 'Exceed test',
					active_headcount_snapshot: '100',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:blanket',
							requested_qty: '100',
							unit: 'piece',
							distribution_type_snapshot: 'one_time',
							target_qty_snapshot: '110'
						}
					]
				},
				regCtx
			);

			await expect(
				repo.approveRequest(
					req._id,
					[{ item_id: 'item:blanket', lot_ref: lot._id, qty: '101' }],
					warehouseCtx
				)
			).rejects.toThrow(ValidationError);
		});

		it('T3A-08: rejects approval with zero allocation lines (empty batch forbidden)', async () => {
			const req = await repo.createRequest(
				{
					purpose: 'Empty test',
					active_headcount_snapshot: '50',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:rice',
							requested_qty: '50',
							unit: 'kg',
							distribution_type_snapshot: 'one_time',
							target_qty_snapshot: '55'
						}
					]
				},
				regCtx
			);

			await expect(repo.approveRequest(req._id, [], warehouseCtx)).rejects.toThrow(ValidationError);
		});

		it('T3A-09: rejects allocation line with zero quantity', async () => {
			const lot = await seedInboundLot('item:rice', 50, 'kg');

			const req = await repo.createRequest(
				{
					purpose: 'Zero qty test',
					active_headcount_snapshot: '50',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:rice',
							requested_qty: '50',
							unit: 'kg',
							distribution_type_snapshot: 'one_time',
							target_qty_snapshot: '55'
						}
					]
				},
				regCtx
			);

			await expect(
				repo.approveRequest(
					req._id,
					[{ item_id: 'item:rice', lot_ref: lot._id, qty: '0' }],
					warehouseCtx
				)
			).rejects.toThrow(ValidationError);
		});

		it('T3A-10: rejects duplicate allocation lines for the same (item_id, lot_ref)', async () => {
			const lot = await seedInboundLot('item:rice', 50, 'kg');

			const req = await repo.createRequest(
				{
					purpose: 'Duplicate line test',
					active_headcount_snapshot: '50',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:rice',
							requested_qty: '50',
							unit: 'kg',
							distribution_type_snapshot: 'one_time',
							target_qty_snapshot: '55'
						}
					]
				},
				regCtx
			);

			await expect(
				repo.approveRequest(
					req._id,
					[
						{ item_id: 'item:rice', lot_ref: lot._id, qty: '20' },
						{ item_id: 'item:rice', lot_ref: lot._id, qty: '20' }
					],
					warehouseCtx
				)
			).rejects.toThrow(ValidationError);
		});
	});

	describe('T3A-14: Integrity Mismatch Detection', () => {
		it('fails closed with IntegrityError if an existing deterministic ledger has tampered fields', async () => {
			const lot = await seedInboundLot('item:soap', 1000, 'bar');

			const req = await repo.createRequest(
				{
					purpose: 'Tamper ledger test',
					active_headcount_snapshot: '40',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:soap',
							requested_qty: '40',
							unit: 'bar',
							distribution_type_snapshot: 'consumable',
							target_qty_snapshot: '44'
						}
					]
				},
				regCtx
			);

			// Pre-populate colliding ledger ID with wrong quantity (-50 instead of -40)
			const opId = '01JCOLLISIONOP';
			store.set(req._id, { ...req, status: 'approving', approval_operation_id: opId });

			const collidingLedgerId = `stock_ledger:${opId}:0`;
			store.set(collidingLedgerId, {
				_id: collidingLedgerId,
				_rev: nextRev(collidingLedgerId),
				type: 'stock_ledger',
				item_id: 'item:soap',
				qty: '-50',
				unit: 'bar',
				reason: 'distribute',
				ref_id: `distribution_batch:${req._id.slice('distribution_request:'.length)}`,
				lot_ref: lot._id,
				shelter_code: 'SH001',
				created_at: '2026-08-29T10:00:00.000Z',
				updated_at: '2026-08-29T10:00:00.000Z',
				occurred_at: '2026-08-29T23:59:59.000Z',
				created_by: 'attacker',
				schema_v: 1
			});

			await expect(
				repo.approveRequest(
					req._id,
					[{ item_id: 'item:soap', lot_ref: lot._id, qty: '40' }],
					warehouseCtx
				)
			).rejects.toThrow(IntegrityError);
		});
	});

	describe('T3A-16: Scope Isolation & Rejection', () => {
		it('rejects cross-shelter request approval', async () => {
			const req = await repo.createRequest(
				{
					purpose: 'Cross shelter',
					active_headcount_snapshot: '10',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:soap',
							requested_qty: '10',
							unit: 'bar',
							distribution_type_snapshot: 'consumable',
							target_qty_snapshot: '11'
						}
					]
				},
				regCtx
			);

			const otherCtx: AuthorContext = {
				shelterCode: 'SH002',
				createdBy: 'other_staff',
				roles: ['warehouse_staff']
			};
			await expect(
				repo.approveRequest(
					req._id,
					[{ item_id: 'item:soap', lot_ref: 'stock_ledger:01J', qty: '10' }],
					otherCtx
				)
			).rejects.toThrow('Cross-shelter access denied');
		});

		it('allows rejecting a pending request with a valid reason by warehouse staff', async () => {
			const req = await repo.createRequest(
				{
					purpose: 'To be rejected',
					active_headcount_snapshot: '10',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:soap',
							requested_qty: '10',
							unit: 'bar',
							distribution_type_snapshot: 'consumable',
							target_qty_snapshot: '11'
						}
					]
				},
				regCtx
			);

			const rejected = await repo.rejectRequest(req._id, 'Insufficient budget', warehouseCtx);
			expect(rejected.status).toBe('rejected');
			expect(rejected.rejection_reason).toBe('Insufficient budget');
			expect(rejected.rejected_by).toBe('warehouse_bob');
		});
	});

	describe('T3A-02: Concurrency Race on Same Pending Request', () => {
		it('allows exactly one operator to win approving, while loser encounters conflict and fails', async () => {
			await seedInboundLot('item:rice', 100);

			const request = await repo.createRequest(
				{
					purpose: 'Flood relief',
					active_headcount_snapshot: '10',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:rice',
							requested_qty: '11',
							unit: 'kg',
							distribution_type_snapshot: 'one_time',
							target_qty_snapshot: '11'
						}
					]
				},
				regCtx
			);

			// First operator begins approval on non-existent lot (will fail on missing lot, but transitions request)
			const op1Promise = repo.approveRequest(
				request._id,
				[{ item_id: 'item:rice', lot_ref: 'stock_ledger:inbound1', qty: '11' }],
				warehouseCtx
			);

			await expect(op1Promise).rejects.toThrow();
			const inFlightReq = await repo.getRequest(request._id);
			expect(inFlightReq?.status).toBe('pending');
		});
	});

	describe('T3A-17: Claim Release CAS Failure Safety & Retry', () => {
		it('safely reloads and retries claim release when encountering CAS conflict during rollback', async () => {
			const lot1 = await seedInboundLot('item:rice', 50, 'kg', 'L-260829-001');
			const lot2 = await seedInboundLot('item:beans', 10, 'kg', 'L-260829-002');

			const req = await repo.createRequest(
				{
					purpose: 'Rollback CAS conflict test',
					active_headcount_snapshot: '50',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:rice',
							requested_qty: '30',
							unit: 'kg',
							distribution_type_snapshot: 'one_time',
							target_qty_snapshot: '33'
						},
						{
							item_id: 'item:beans',
							requested_qty: '30',
							unit: 'kg',
							distribution_type_snapshot: 'one_time',
							target_qty_snapshot: '33'
						}
					]
				},
				regCtx
			);

			// Approval attempts 30 from lot2 (which only has 10) -> Fails on lot2
			await expect(
				repo.approveRequest(
					req._id,
					[
						{ item_id: 'item:rice', lot_ref: lot1._id, qty: '30' },
						{ item_id: 'item:beans', lot_ref: lot2._id, qty: '30' }
					],
					warehouseCtx
				)
			).rejects.toThrow(InsufficientStockError);

			// Lot 1 claim confirmed released
			const res1Id = await makeLotReservationDocId(lot1._id);
			const res1Doc = store.get(res1Id) as StockLotReservation | undefined;
			expect(res1Doc?.pending_claims ?? []).toEqual([]);

			// Request reverted to pending
			const reqAfter = await repo.getRequest(req._id);
			expect(reqAfter?.status).toBe('pending');
		});
	});

	describe('Corrective audit regressions', () => {
		it('rejects item, unit, unknown, and cross-shelter physical lots before any Phase 3A write', async () => {
			const water = await seedInboundLot('item:water', 10, 'bottle');
			const riceWrongUnit = await seedInboundLot('item:rice', 10, 'box');
			const crossShelter = createReceiveEntry(
				{
					item_id: 'item:rice',
					qty: '10',
					unit: 'kg',
					source: 'donation',
					ref_id: DONATION_REF
				},
				{ shelterCode: 'SH002', createdBy: 'other', roles: ['warehouse_staff'] }
			);
			store.set(crossShelter._id, { ...crossShelter, _rev: nextRev(crossShelter._id) });
			const request = await repo.createRequest(
				{
					purpose: 'Rice',
					active_headcount_snapshot: '1',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:rice',
							requested_qty: '1',
							unit: 'kg',
							distribution_type_snapshot: 'consumable',
							target_qty_snapshot: '1'
						}
					]
				},
				regCtx
			);
			for (const lotRef of [
				water._id,
				riceWrongUnit._id,
				'stock_ledger:UNKNOWN',
				crossShelter._id
			]) {
				await expect(
					repo.approveRequest(
						request._id,
						[{ item_id: 'item:rice', lot_ref: lotRef, qty: '1' }],
						warehouseCtx
					)
				).rejects.toThrow();
				const current = await repo.getRequest(request._id);
				expect(current?.status).toBe('pending');
				expect(await repo.listBatches()).toHaveLength(0);
				expect(
					Array.from(store.values()).filter((doc) => doc.reason === 'distribute')
				).toHaveLength(0);
			}
		});

		it('normalizes equivalent quantity spellings before persisting the canonical plan', async () => {
			const lot = await seedInboundLot('item:rice', 10);
			const request = await repo.createRequest(
				{
					purpose: 'Normalization',
					active_headcount_snapshot: '1',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:rice',
							requested_qty: '1',
							unit: 'kg',
							distribution_type_snapshot: 'consumable',
							target_qty_snapshot: '1'
						}
					]
				},
				regCtx
			);
			const batch = await repo.approveRequest(
				request._id,
				[{ item_id: 'item:rice', lot_ref: lot._id, qty: '01.0' }],
				warehouseCtx
			);
			expect(batch.allocations[0].qty).toBe('1');
			const ledgerDoc = store.get(batch.allocations[0].allocation_ledger_id);
			if (!ledgerDoc) throw new Error('Expected deterministic ledger fixture to exist');
			const ledger = parseStockLedger(ledgerDoc);
			expect(ledger.qty).toBe('-1');
		});

		it('fails closed before recovery writes when a persisted batch violates request invariants', async () => {
			const lot = await seedInboundLot('item:rice', 10);
			const request = await repo.createRequest(
				{
					purpose: 'Corrupt recovery',
					active_headcount_snapshot: '1',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:rice',
							requested_qty: '1',
							unit: 'kg',
							distribution_type_snapshot: 'consumable',
							target_qty_snapshot: '1'
						}
					]
				},
				regCtx
			);
			const batch = await repo.approveRequest(
				request._id,
				[{ item_id: 'item:rice', lot_ref: lot._id, qty: '1' }],
				warehouseCtx
			);
			const approved = await repo.getRequest(request._id);
			if (!approved) throw new Error('Expected approved request fixture to exist');
			store.set(request._id, { ...approved, status: 'approving', _rev: nextRev(request._id) });
			store.set(batch._id, {
				...batch,
				status: 'activating',
				request_id: 'distribution_request:OTHER',
				_rev: nextRev(batch._id)
			});
			const ledgersBefore = Array.from(store.values()).filter(
				(doc) => doc.reason === 'distribute'
			).length;
			await expect(
				repo.approveRequest(
					request._id,
					[{ item_id: 'item:rice', lot_ref: lot._id, qty: '1' }],
					warehouseCtx
				)
			).rejects.toThrow(IntegrityError);
			expect(Array.from(store.values()).filter((doc) => doc.reason === 'distribute')).toHaveLength(
				ledgersBefore
			);
		});

		it('rejects same-operation reservation claims with mismatched request, item, or lot identity', async () => {
			for (const mismatch of ['request_id', 'item_id', 'lot_ref'] as const) {
				const lot = await seedInboundLot(`item:soap-${mismatch}`, 10, 'bar');
				const request = await repo.createRequest(
					{
						purpose: `Claim ${mismatch}`,
						active_headcount_snapshot: '1',
						buffer_percent: 10,
						items: [
							{
								item_id: `item:soap-${mismatch}`,
								requested_qty: '1',
								unit: 'bar',
								distribution_type_snapshot: 'consumable',
								target_qty_snapshot: '1'
							}
						]
					},
					regCtx
				);
				const operationId = `01JCLAIM${mismatch.toUpperCase()}`;
				store.set(request._id, {
					...request,
					status: 'approving',
					approval_operation_id: operationId,
					_rev: nextRev(request._id)
				});
				const batchId = `distribution_batch:${request._id.slice('distribution_request:'.length)}`;
				const resId = await makeLotReservationDocId(lot._id);
				store.set(resId, {
					...createStockLotReservation(
						{
							lot_ref: lot._id,
							pending_claims: [
								{
									operation_id: operationId,
									request_id:
										mismatch === 'request_id' ? 'distribution_request:OTHER' : request._id,
									batch_id: batchId,
									item_id: mismatch === 'item_id' ? 'item:other' : `item:soap-${mismatch}`,
									lot_ref: mismatch === 'lot_ref' ? 'stock_ledger:OTHER' : lot._id,
									qty: '1',
									claimed_at: '2026-08-29T10:00:00.000Z'
								}
							]
						},
						resId.slice('stock_lot_reservation:'.length),
						warehouseCtx
					),
					_rev: nextRev(resId)
				});
				await expect(
					repo.approveRequest(
						request._id,
						[{ item_id: `item:soap-${mismatch}`, lot_ref: lot._id, qty: '1' }],
						warehouseCtx
					)
				).rejects.toThrow(ApprovalConflictError);
			}
		});

		it('retries confirmed claim cleanup after a deterministic stale-revision conflict', async () => {
			const lot = await seedInboundLot('item:cleanup', 10, 'bar');
			const request = await repo.createRequest(
				{
					purpose: 'Cleanup retry',
					active_headcount_snapshot: '1',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:cleanup',
							requested_qty: '1',
							unit: 'bar',
							distribution_type_snapshot: 'consumable',
							target_qty_snapshot: '1'
						}
					]
				},
				regCtx
			);
			let failOnce = true;
			beforeStrictWrite = (doc) => {
				if (
					failOnce &&
					doc.type === 'stock_lot_reservation' &&
					Array.isArray(doc.pending_claims) &&
					doc.pending_claims.length === 0
				) {
					failOnce = false;
					throw new Error('simulated stale _rev conflict');
				}
			};
			const batch = await repo.approveRequest(
				request._id,
				[{ item_id: 'item:cleanup', lot_ref: lot._id, qty: '1' }],
				warehouseCtx
			);
			const reservationDoc = store.get(await makeLotReservationDocId(lot._id));
			if (!reservationDoc) throw new Error('Expected reservation fixture to exist');
			const reservation = stockLotReservationDocSchema.parse(reservationDoc);
			expect(batch.status).toBe('active');
			expect(reservation.pending_claims).toEqual([]);
		});

		it('Checkpoint B durable partial-claim state resumes without duplicating the existing claim', async () => {
			const rice = await seedInboundLot('item:rice', 10);
			const beans = await seedInboundLot('item:beans', 10);
			const request = await repo.createRequest(
				{
					purpose: 'Checkpoint B durable resume',
					active_headcount_snapshot: '1',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:rice',
							requested_qty: '1',
							unit: 'kg',
							distribution_type_snapshot: 'consumable',
							target_qty_snapshot: '1'
						},
						{
							item_id: 'item:beans',
							requested_qty: '1',
							unit: 'kg',
							distribution_type_snapshot: 'consumable',
							target_qty_snapshot: '1'
						}
					]
				},
				regCtx
			);
			const operationId = '01JCHECKPOINTBRESUME';
			const batchId = `distribution_batch:${request._id.slice('distribution_request:'.length)}`;
			store.set(request._id, {
				...request,
				status: 'approving',
				approval_operation_id: operationId,
				_rev: nextRev(request._id)
			});
			const riceReservationId = await makeLotReservationDocId(rice._id);
			store.set(riceReservationId, {
				...createStockLotReservation(
					{
						lot_ref: rice._id,
						pending_claims: [
							{
								operation_id: operationId,
								request_id: request._id,
								batch_id: batchId,
								item_id: 'item:rice',
								lot_ref: rice._id,
								qty: '1',
								claimed_at: '2026-08-29T10:00:00.000Z'
							}
						]
					},
					riceReservationId.slice('stock_lot_reservation:'.length),
					warehouseCtx
				),
				_rev: nextRev(riceReservationId)
			});
			const batch = await repo.approveRequest(
				request._id,
				[
					{ item_id: 'item:beans', lot_ref: beans._id, qty: '1' },
					{ item_id: 'item:rice', lot_ref: rice._id, qty: '1' }
				],
				warehouseCtx
			);
			expect(batch.status).toBe('active');
			expect((await repo.getRequest(request._id))?.status).toBe('approved');
			const riceReservationDoc = store.get(riceReservationId);
			if (!riceReservationDoc) throw new Error('Expected rice reservation fixture to exist');
			expect(stockLotReservationDocSchema.parse(riceReservationDoc).pending_claims).toEqual([]);
		});

		it('SAME-REQUEST STALE-_rev CAS CONFLICT TEST persists exactly one operation', async () => {
			const lot = await seedInboundLot('item:rice', 10);
			const request = await repo.createRequest(
				{
					purpose: 'Request race',
					active_headcount_snapshot: '1',
					buffer_percent: 10,
					items: [
						{
							item_id: 'item:rice',
							requested_qty: '1',
							unit: 'kg',
							distribution_type_snapshot: 'consumable',
							target_qty_snapshot: '1'
						}
					]
				},
				regCtx
			);
			let reached = 0;
			let release!: () => void;
			const barrier = new Promise<void>((resolve) => {
				release = resolve;
			});
			beforeStrictWrite = async (doc) => {
				if (doc._id !== request._id || doc.status !== 'approving') return;
				reached += 1;
				if (reached === 2) release();
				await barrier;
			};
			const allocation = [{ item_id: 'item:rice', lot_ref: lot._id, qty: '1' }];
			const [first, second] = await Promise.allSettled([
				repo.approveRequest(request._id, allocation, warehouseCtx),
				repo.approveRequest(request._id, allocation, warehouseCtx)
			]);
			expect([first, second].filter((result) => result.status === 'rejected')).toHaveLength(1);
			const durable = await repo.getRequest(request._id);
			expect(durable?.approval_operation_id).toBeTruthy();
			expect(await repo.listBatches()).toHaveLength(1);
			expect(Array.from(store.values()).filter((doc) => doc.reason === 'distribute')).toHaveLength(
				1
			);
		});

		it('DETERMINISTIC STALE-_rev LOT CAS CONFLICT TEST reloads and rejects the second 30 of 50 claim', async () => {
			const lot = await seedInboundLot('item:water', 50, 'bottle');
			const input = (purpose: string) => ({
				purpose,
				active_headcount_snapshot: '1',
				buffer_percent: 10,
				items: [
					{
						item_id: 'item:water',
						requested_qty: '30',
						unit: 'bottle',
						distribution_type_snapshot: 'consumable' as const,
						target_qty_snapshot: '1'
					}
				]
			});
			const [requestA, requestB] = await Promise.all([
				repo.createRequest(input('A'), regCtx),
				repo.createRequest(input('B'), regCtx)
			]);
			const resId = await makeLotReservationDocId(lot._id);
			store.set(resId, {
				...createStockLotReservation(
					{ lot_ref: lot._id, pending_claims: [] },
					resId.slice('stock_lot_reservation:'.length),
					warehouseCtx
				),
				_rev: nextRev(resId)
			});
			let reached = 0;
			let release!: () => void;
			const barrier = new Promise<void>((resolve) => {
				release = resolve;
			});
			beforeStrictWrite = async (doc) => {
				if (
					doc._id !== resId ||
					!Array.isArray(doc.pending_claims) ||
					doc.pending_claims.length !== 1
				)
					return;
				reached += 1;
				if (reached === 2) release();
				await barrier;
			};
			const allocation = [{ item_id: 'item:water', lot_ref: lot._id, qty: '30' }];
			const [first, second] = await Promise.allSettled([
				repo.approveRequest(requestA._id, allocation, warehouseCtx),
				repo.approveRequest(requestB._id, allocation, warehouseCtx)
			]);
			expect([first, second].filter((result) => result.status === 'fulfilled')).toHaveLength(1);
			expect([first, second].filter((result) => result.status === 'rejected')).toHaveLength(1);
			expect(Array.from(store.values()).filter((doc) => doc.reason === 'distribute')).toHaveLength(
				1
			);
		});
	});
});

describe('DistributionRemoteRepository cancelRequest (Phase 4A)', () => {
	let repo: DistributionRemoteRepository;

	beforeEach(() => {
		store = new Map();
		revCounters = new Map();
		beforeStrictWrite = undefined;
		repo = new DistributionRemoteRepository('shelter_sh001');
	});

	async function createPendingRequest() {
		return repo.createRequest(
			{
				purpose: 'Cancel pending request',
				active_headcount_snapshot: '1',
				buffer_percent: 10,
				items: [
					{
						item_id: 'item:water',
						requested_qty: '1',
						unit: 'bottle',
						distribution_type_snapshot: 'consumable',
						target_qty_snapshot: '1'
					}
				]
			},
			regCtx
		);
	}

	it.each([
		['registration_staff', regCtx],
		['shelter_manager', managerCtx],
		['system_admin', adminCtx]
	])('allows %s to cancel a same-shelter pending request', async (_role, ctx) => {
		const request = await createPendingRequest();
		const cancelled = await repo.cancelRequest(request._id, ctx);

		expect(cancelled._id).toBe(request._id);
		expect(cancelled.status).toBe('cancelled');
		expect((await repo.getRequest(request._id, adminCtx))?.status).toBe('cancelled');
		expect(
			Array.from(store.values()).filter((doc) => doc.type === 'distribution_batch')
		).toHaveLength(0);
		expect(Array.from(store.values()).filter((doc) => doc.type === 'stock_ledger')).toHaveLength(0);
	});

	it('denies warehouse_staff, kitchen_staff, and callers without a qualifying role before cancelling', async () => {
		const request = await createPendingRequest();
		await expect(repo.cancelRequest(request._id, warehouseCtx)).rejects.toThrow(/Unauthorized/);
		await expect(repo.cancelRequest(request._id, kitchenCtx)).rejects.toThrow(/Unauthorized/);
		await expect(
			repo.cancelRequest(request._id, { shelterCode: 'SH001', createdBy: 'unknown' })
		).rejects.toThrow(/Unauthorized/);
		expect((await repo.getRequest(request._id, adminCtx))?.status).toBe('pending');
	});

	it('denies cross-shelter cancellation without changing the request', async () => {
		const request = await createPendingRequest();
		await expect(
			repo.cancelRequest(request._id, {
				shelterCode: 'SH002',
				createdBy: 'other_manager',
				roles: ['shelter_manager']
			})
		).rejects.toThrow(/Cross-shelter/);
		expect((await repo.getRequest(request._id, adminCtx))?.status).toBe('pending');
	});

	it.each(['approving', 'approved', 'rejected', 'cancelled'] as const)(
		'rejects cancellation from %s',
		async (status) => {
			const request = await createPendingRequest();
			store.set(request._id, { ...request, status, _rev: nextRev(request._id) });
			await expect(repo.cancelRequest(request._id, regCtx)).rejects.toThrow(ValidationError);
		}
	);

	it('surfaces a strict-write conflict instead of silently retrying cancellation', async () => {
		const request = await createPendingRequest();
		beforeStrictWrite = (doc) => {
			if (doc._id !== request._id || doc.status !== 'cancelled') return;
			const current = store.get(request._id);
			if (current) store.set(request._id, { ...current, _rev: nextRev(request._id) });
		};

		await expect(repo.cancelRequest(request._id, regCtx)).rejects.toThrow(/Conflict/);
		expect((await repo.getRequest(request._id, adminCtx))?.status).toBe('pending');
	});

	it.each([
		['registration_staff', regCtx],
		['shelter_manager', managerCtx],
		['warehouse_staff', warehouseCtx],
		['system_admin', adminCtx]
	])('allows %s to list same-shelter distribution requests', async (_role, ctx) => {
		const request = await createPendingRequest();
		await expect(repo.listRequests(undefined, ctx)).resolves.toEqual([request]);
	});

	it('filters requests by lifecycle status', async () => {
		const pending = await createPendingRequest();
		const approved = await createPendingRequest();
		store.set(approved._id, {
			...approved,
			_id: `${approved._id}:approved`,
			status: 'approved',
			batch_id: 'distribution_batch:BATCH1',
			_rev: nextRev(`${approved._id}:approved`)
		});

		const pendingOnly = await repo.listRequests('pending', adminCtx);
		const approvedOnly = await repo.listRequests('approved', adminCtx);

		expect(pendingOnly.map((r) => r._id)).toContain(pending._id);
		expect(pendingOnly.map((r) => r._id)).not.toContain(`${approved._id}:approved`);
		expect(approvedOnly.map((r) => r._id)).toContain(`${approved._id}:approved`);
	});

	it('bulk-fetches batches by IDs in a single operation with shelter isolation', async () => {
		const ulid1 = '01JABCDEFGHJKMNPQRSTVWXYZ1';
		const ulid2 = '01JABCDEFGHJKMNPQRSTVWXYZ2';
		const batch1 = createDistributionBatch(
			{
				request_id: `distribution_request:${ulid1}`,
				items: [
					{
						item_id: 'item:rice',
						allocated_qty: '50',
						unit: 'kg',
						distribution_type_snapshot: 'one_time'
					}
				],
				allocations: [
					{
						item_id: 'item:rice',
						lot_ref: 'stock_ledger:01JABCDEFGHJKMNPQRSTVWXYZ3',
						lot: { lot_no: 'L1' },
						qty: '50',
						allocation_ledger_id: 'stock_ledger:01JABCDEFGHJKMNPQRSTVWXYZ4'
					}
				]
			},
			adminCtx
		);
		const batchOtherShelter = {
			...batch1,
			_id: `distribution_batch:${ulid2}`,
			request_id: `distribution_request:${ulid2}`,
			shelter_code: 'SH002'
		};
		store.set(batch1._id, batch1 as unknown as InMemoryDoc);
		store.set(batchOtherShelter._id, batchOtherShelter as unknown as InMemoryDoc);

		const batches = await repo.getBatches(
			[batch1._id, batchOtherShelter._id, 'distribution_batch:01JNONEXISTENT0000000000000'],
			adminCtx
		);

		expect(batches).toHaveLength(1);
		expect(batches[0]._id).toBe(batch1._id);

		const empty = await repo.getBatches([], adminCtx);
		expect(empty).toEqual([]);
	});

	it('denies kitchen_staff and missing-role callers before returning distribution requests', async () => {
		await createPendingRequest();
		await expect(repo.listRequests(undefined, kitchenCtx)).rejects.toThrow(/Unauthorized/);
		await expect(
			repo.getRequest('distribution_request:unknown', {
				shelterCode: 'SH001',
				createdBy: 'unknown'
			})
		).rejects.toThrow(/Unauthorized/);
	});

	it('filters cross-shelter request documents and does not expose cross-shelter lookup data', async () => {
		const request = await createPendingRequest();
		const crossShelterId = 'distribution_request:01JCROSSSHELTER';
		store.set(crossShelterId, {
			...request,
			_id: crossShelterId,
			shelter_code: 'SH002',
			_rev: nextRev(crossShelterId)
		});

		await expect(repo.listRequests(undefined, adminCtx)).resolves.toEqual([request]);
		await expect(repo.getRequest(crossShelterId, adminCtx)).resolves.toBeNull();
	});

	it('applies the same view authorization and shelter scope to public batch reads', async () => {
		const request = await createPendingRequest();
		const batch = createDistributionBatch(
			{
				request_id: request._id,
				items: [
					{
						item_id: 'item:water',
						allocated_qty: '1',
						unit: 'bottle',
						distribution_type_snapshot: 'consumable'
					}
				],
				allocations: [
					{
						item_id: 'item:water',
						lot_ref: 'stock_ledger:01JREADLOT',
						lot: {},
						qty: '1',
						allocation_ledger_id: 'stock_ledger:01JREADLEDGER'
					}
				]
			},
			adminCtx
		);
		store.set(batch._id, { ...batch, status: 'active', _rev: nextRev(batch._id) });
		const crossShelterId = 'distribution_batch:01JCROSSSHELTER';
		store.set(crossShelterId, {
			...batch,
			_id: crossShelterId,
			request_id: 'distribution_request:01JCROSSSHELTER',
			shelter_code: 'SH002',
			_rev: nextRev(crossShelterId)
		});

		await expect(repo.listBatches(undefined, adminCtx)).resolves.toEqual([
			expect.objectContaining({ _id: batch._id })
		]);
		await expect(repo.getBatch(crossShelterId, adminCtx)).resolves.toBeNull();
		await expect(repo.listBatches(undefined, kitchenCtx)).rejects.toThrow(/Unauthorized/);
	});
});

describe('DistributionRemoteRepository createRequest (Phase 4B)', () => {
	let repo: DistributionRemoteRepository;

	beforeEach(() => {
		store = new Map();
		revCounters = new Map();
		beforeStrictWrite = undefined;
		repo = new DistributionRemoteRepository('shelter_sh001');
	});

	const sampleInput = {
		purpose: 'Emergency water distribution',
		note: 'Zone A delivery',
		active_headcount_snapshot: '120',
		buffer_percent: 10,
		items: [
			{
				item_id: 'item:water',
				requested_qty: '132',
				unit: 'bottle',
				distribution_type_snapshot: 'consumable' as const,
				target_qty_snapshot: '132'
			}
		]
	};

	it.each([
		['registration_staff', regCtx],
		['shelter_manager', managerCtx],
		['system_admin', adminCtx]
	])('allows %s to create a distribution request', async (_role, ctx) => {
		const request = await repo.createRequest(sampleInput, ctx);
		expect(request._id).toMatch(/^distribution_request:[0-9A-HJKMNP-TV-Z]{26}$/);
		expect(request.status).toBe('pending');
		expect(request.shelter_code).toBe(ctx.shelterCode);
		expect(request.created_by).toBe(ctx.createdBy);
		expect(request.requested_by).toBe(ctx.createdBy);
		expect(request.purpose).toBe('Emergency water distribution');
		expect(request.note).toBe('Zone A delivery');
		expect(request.active_headcount_snapshot).toBe('120');
		expect(request.buffer_percent).toBe(10);
		expect(request.items).toHaveLength(1);
		expect(request.items[0]).toEqual({
			item_id: 'item:water',
			requested_qty: '132',
			unit: 'bottle',
			distribution_type_snapshot: 'consumable',
			target_qty_snapshot: '132'
		});
		expect(request.approval_operation_id).toBeUndefined();
		expect(request.approved_by).toBeUndefined();
		expect(request.approved_at).toBeUndefined();
		expect(request.batch_id).toBeUndefined();
		expect(request.rejected_by).toBeUndefined();
		expect(request.rejected_at).toBeUndefined();
		expect(request.rejection_reason).toBeUndefined();

		// Verify no batches or stock ledgers were minted
		const allDocs = Array.from(store.values());
		expect(allDocs.filter((d) => d.type === 'distribution_batch')).toHaveLength(0);
		expect(allDocs.filter((d) => d.type === 'stock_ledger')).toHaveLength(0);
	});

	it.each([
		['warehouse_staff', warehouseCtx],
		['kitchen_staff', kitchenCtx],
		['missing role', { shelterCode: 'SH001', createdBy: 'guest', roles: [] as string[] }]
	])('rejects %s from creating a distribution request', async (_role, ctx) => {
		await expect(repo.createRequest(sampleInput, ctx)).rejects.toThrow(
			/Unauthorized: distribution request creation requires registration_staff, shelter_manager, or system_admin role/
		);
		expect(store.size).toBe(0);
	});

	it('rejects createRequest when AuthorContext has undefined roles', async () => {
		await expect(
			repo.createRequest(sampleInput, { shelterCode: 'SH001', createdBy: 'noroles' })
		).rejects.toThrow(
			/Unauthorized: distribution request creation requires registration_staff, shelter_manager, or system_admin role/
		);
		expect(store.size).toBe(0);
	});
});
