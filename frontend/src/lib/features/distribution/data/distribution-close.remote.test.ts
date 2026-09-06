// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AuthorContext } from '$lib/db/model';
import { ulid } from '$lib/db/ulid';
import { addQty } from '$lib/utils/qty';
import {
	createDistributionIssueCapacity,
	type DistributionBatch,
	type DistributionIssue
} from '../domain/distribution';
import {
	IssueInFlightError,
	makeIssueCapacityDocId,
	makeIssueGateDocId,
	ReconciliationIntegrityError,
	BatchClosingConflictError,
	IntegrityError
} from '../index';
import { DistributionRemoteRepository } from './distribution.remote';

interface InMemoryDoc {
	_id: string;
	_rev?: string;
	type?: string;
	[key: string]: unknown;
}

interface InMemoryIssueGate extends InMemoryDoc {
	state: 'open' | 'sealed';
	pending_claims: unknown[];
}

let store: Map<string, InMemoryDoc>;
let revCounters: Map<string, number>;
let getDocHook: ((id: string) => Promise<unknown> | unknown) | null = null;
let putDocHook: ((doc: InMemoryDoc) => Promise<unknown> | unknown) | null = null;
let putDocStrictHook: ((doc: InMemoryDoc) => Promise<unknown> | unknown) | null = null;
let putDocStrictCalls: InMemoryDoc[] = [];

function requireIssueGate(id: string): InMemoryIssueGate {
	const gate = store.get(id);
	if (
		!gate ||
		(gate.state !== 'open' && gate.state !== 'sealed') ||
		!Array.isArray(gate.pending_claims)
	) {
		throw new Error(`Expected a valid issue gate at ${id}`);
	}
	return gate as InMemoryIssueGate;
}

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
		if (getDocHook) {
			const hooked = await getDocHook(id);
			if (hooked !== undefined) return hooked as T;
		}
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
		if (putDocHook) {
			await putDocHook(doc as unknown as InMemoryDoc);
		}
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
		if (putDocStrictHook) {
			await putDocStrictHook(doc as unknown as InMemoryDoc);
		}
		putDocStrictCalls.push(JSON.parse(JSON.stringify(doc)));
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

describe('DistributionRemoteRepository closeBatch (Phase A Step 2)', () => {
	let repo: DistributionRemoteRepository;

	const WAREHOUSE_CTX: AuthorContext = {
		shelterCode: 'SH001',
		createdBy: 'ws-1',
		roles: ['SH001:warehouse_staff']
	};
	const ADMIN_CTX: AuthorContext = {
		shelterCode: 'SH001',
		createdBy: 'admin-1',
		roles: ['system_admin']
	};
	const MANAGER_CTX: AuthorContext = {
		shelterCode: 'SH001',
		createdBy: 'mgr-1',
		roles: ['SH001:shelter_manager']
	};
	const REGISTRATION_CTX: AuthorContext = {
		shelterCode: 'SH001',
		createdBy: 'reg-1',
		roles: ['SH001:registration_staff']
	};
	const SUPPLY_CTX: AuthorContext = {
		shelterCode: 'SH001',
		createdBy: 'supply-1',
		roles: ['SH001:supply_coordinator']
	};
	const CROSS_SHELTER_WS_CTX: AuthorContext = {
		shelterCode: 'SH001',
		createdBy: 'ws-cross',
		roles: ['SH002:warehouse_staff']
	};

	beforeEach(() => {
		store = new Map();
		revCounters = new Map();
		getDocHook = null;
		putDocHook = null;
		putDocStrictHook = null;
		putDocStrictCalls = [];
		repo = new DistributionRemoteRepository('shelter_sh001');
	});

	function computeStockBalance(itemId: string, lotRef?: string): string {
		let balance = '0';
		for (const doc of store.values()) {
			if (doc.type === 'stock_ledger' && doc.item_id === itemId) {
				if (!lotRef || doc.lot_ref === lotRef) {
					balance = addQty(balance, doc.qty as string);
				}
			}
		}
		return balance;
	}

	function seedBatch(overrides: Partial<DistributionBatch> = {}): DistributionBatch {
		const ulidPart = ulid();
		const batch: DistributionBatch = {
			_id: `distribution_batch:${ulidPart}`,
			type: 'distribution_batch',
			request_id: `distribution_request:${ulidPart}`,
			shelter_code: 'SH001',
			status: 'active',
			activated_by: 'ws-1',
			activated_at: '2026-09-01T00:00:00.000Z',
			created_by: 'ws-1',
			created_at: '2026-09-01T00:00:00.000Z',
			updated_at: '2026-09-01T00:00:00.000Z',
			schema_v: 1,
			items: [
				{
					item_id: 'item:blanket',
					allocated_qty: '40',
					unit: 'piece',
					distribution_type_snapshot: 'one_time'
				}
			],
			allocations: [
				{
					item_id: 'item:blanket',
					lot_ref: 'stock_ledger:01JLOT00000000000000000001',
					qty: '40',
					allocation_ledger_id: 'stock_ledger:01JALLOC00000000000000001',
					lot: { lot_no: 'L-260901-001' }
				}
			],
			reconciliation: [],
			return_ledger_ids: [],
			...overrides
		};
		const rev = nextRev(batch._id);
		const saved = { ...batch, _rev: rev };
		store.set(batch._id, JSON.parse(JSON.stringify(saved)));
		return saved;
	}

	function seedIssue(batchId: string, itemId: string, qty: string): DistributionIssue {
		const issueUlid = ulid();
		const issue: DistributionIssue = {
			_id: `distribution_issue:${issueUlid}`,
			type: 'distribution_issue',
			batch_id: batchId,
			evacuee_id: `evacuee:${ulid()}`,
			item_id: itemId,
			qty,
			unit: 'piece',
			distributed_at: '2026-09-01T01:00:00.000Z',
			distributed_by: 'reg-1',
			distribution_type_snapshot: 'one_time',
			eligibility_snapshot: {
				eligible: true,
				distribution_type: 'one_time',
				decision: 'first_receipt',
				had_previous_receipt: false,
				previous_receipt_count: 0
			},
			idempotency_key: `key-${issueUlid}`,
			shelter_code: 'SH001',
			created_by: 'reg-1',
			created_at: '2026-09-01T01:00:00.000Z',
			updated_at: '2026-09-01T01:00:00.000Z',
			schema_v: 1
		};
		const rev = nextRev(issue._id);
		const saved = { ...issue, _rev: rev };
		store.set(issue._id, JSON.parse(JSON.stringify(saved)));
		return saved;
	}

	it('1. authorized active Batch can enter closing and successfully close', async () => {
		const batch = seedBatch();
		seedIssue(batch._id, 'item:blanket', '20');
		seedIssue(batch._id, 'item:blanket', '15'); // total distributed = 35

		const closed = await repo.closeBatch(
			batch._id,
			{
				reconciliation: [
					{
						item_id: 'item:blanket',
						lot_ref: 'stock_ledger:01JLOT00000000000000000001',
						damaged_qty: '2',
						damaged_note: 'ถุงฉีกขาด',
						lost_qty: '1',
						lost_note: 'สูญหายระหว่างขนส่ง'
					}
				]
			},
			WAREHOUSE_CTX
		);

		expect(closed.status).toBe('closed');
		expect(closed.closing_operation_id).toBeDefined();
		expect(closed.closed_by).toBe('ws-1');
		expect(closed.reconciliation).toHaveLength(1);

		const row = closed.reconciliation[0];
		expect(row.allocated_qty).toBe('40');
		expect(row.distributed_qty).toBe('35');
		expect(row.damaged_qty).toBe('2');
		expect(row.lost_qty).toBe('1');
		expect(row.return_qty).toBe('2'); // 40 - (35 + 2 + 1) = 2

		// Return ledger should be written
		expect(closed.return_ledger_ids).toHaveLength(1);
		const returnLedgerId = closed.return_ledger_ids[0];
		const returnLedger = store.get(returnLedgerId);
		expect(returnLedger).toBeDefined();
		expect(returnLedger?.type).toBe('stock_ledger');
		expect(returnLedger?.reason).toBe('distribution_return');
		expect(returnLedger?.qty).toBe('2');
		expect(returnLedger?.ref_id).toBe(batch._id);
		expect(returnLedger?.lot_ref).toBe('stock_ledger:01JLOT00000000000000000001');
	});

	it('2. unauthorized roles rejected (shelter_manager, registration_staff, supply_coordinator)', async () => {
		const batch = seedBatch();

		await expect(repo.closeBatch(batch._id, {}, MANAGER_CTX)).rejects.toThrow(
			/Unauthorized: distribution closeBatch/
		);
		await expect(repo.closeBatch(batch._id, {}, REGISTRATION_CTX)).rejects.toThrow(
			/Unauthorized: distribution closeBatch/
		);
		await expect(repo.closeBatch(batch._id, {}, SUPPLY_CTX)).rejects.toThrow(
			/Unauthorized: distribution closeBatch/
		);

		// system_admin is allowed
		const closedByAdmin = await repo.closeBatch(batch._id, {}, ADMIN_CTX);
		expect(closedByAdmin.status).toBe('closed');
	});

	it('3. distributed qty comes from committed Issues in CouchDB', async () => {
		const batch = seedBatch();
		seedIssue(batch._id, 'item:blanket', '12');

		// Calling closeBatch without providing any distributed_qty (operator provides empty input)
		const closed = await repo.closeBatch(batch._id, {}, WAREHOUSE_CTX);

		expect(closed.reconciliation[0].distributed_qty).toBe('12');
		expect(closed.reconciliation[0].return_qty).toBe('28'); // 40 - 12 = 28
	});

	it('4. client cannot forge distributed qty or allocated qty', async () => {
		const batch = seedBatch();
		seedIssue(batch._id, 'item:blanket', '5');

		// Malicious client tries to inject fake distributed_qty or allocated_qty
		const maliciousInput = {
			reconciliation: [
				{
					item_id: 'item:blanket',
					lot_ref: 'stock_ledger:01JLOT00000000000000000001',
					distributed_qty: '999',
					allocated_qty: '999',
					return_qty: '999'
				}
			]
		};

		const closed = await repo.closeBatch(batch._id, maliciousInput, WAREHOUSE_CTX);
		// Authoritative data was used, not client fake numbers
		expect(closed.reconciliation[0].allocated_qty).toBe('40');
		expect(closed.reconciliation[0].distributed_qty).toBe('5');
		expect(closed.reconciliation[0].return_qty).toBe('35');
	});

	it('5. damaged/lost validation rejects negative quantities', async () => {
		const batch = seedBatch();

		await expect(
			repo.closeBatch(
				batch._id,
				{
					reconciliation: [
						{
							item_id: 'item:blanket',
							lot_ref: 'stock_ledger:01JLOT00000000000000000001',
							damaged_qty: '-5'
						}
					]
				},
				WAREHOUSE_CTX
			)
		).rejects.toThrow();
	});

	it('6. required notes: damaged > 0 or lost > 0 requires explanatory note', async () => {
		const batch = seedBatch();

		// Damaged > 0 without note
		await expect(
			repo.closeBatch(
				batch._id,
				{
					reconciliation: [
						{
							item_id: 'item:blanket',
							lot_ref: 'stock_ledger:01JLOT00000000000000000001',
							damaged_qty: '1'
						}
					]
				},
				WAREHOUSE_CTX
			)
		).rejects.toThrow(/damaged_note is required/);

		// Lost > 0 without note
		await expect(
			repo.closeBatch(
				batch._id,
				{
					reconciliation: [
						{
							item_id: 'item:blanket',
							lot_ref: 'stock_ledger:01JLOT00000000000000000001',
							lost_qty: '1'
						}
					]
				},
				WAREHOUSE_CTX
			)
		).rejects.toThrow(/lost_note is required/);
	});

	it('7. negative return rejected (accounted exceeds allocation)', async () => {
		const batch = seedBatch();
		seedIssue(batch._id, 'item:blanket', '35');

		// 35 distributed + 5 damaged + 2 lost = 42 > 40 allocated -> return would be -2
		await expect(
			repo.closeBatch(
				batch._id,
				{
					reconciliation: [
						{
							item_id: 'item:blanket',
							lot_ref: 'stock_ledger:01JLOT00000000000000000001',
							damaged_qty: '5',
							damaged_note: 'เสียหาย',
							lost_qty: '2',
							lost_note: 'สูญหาย'
						}
					]
				},
				WAREHOUSE_CTX
			)
		).rejects.toThrow(ReconciliationIntegrityError);
	});

	it('8. lot-level reconciliation preserved across multiple physical lots', async () => {
		// Multi-lot batch: Item blanket allocated from Lot 1 (20) and Lot 2 (20)
		const batch = seedBatch({
			items: [
				{
					item_id: 'item:blanket',
					allocated_qty: '40',
					unit: 'piece',
					distribution_type_snapshot: 'one_time'
				}
			],
			allocations: [
				{
					item_id: 'item:blanket',
					lot_ref: 'stock_ledger:LOT-1',
					qty: '20',
					allocation_ledger_id: 'stock_ledger:ALLOC-1',
					lot: { lot_no: 'L-260901-001' }
				},
				{
					item_id: 'item:blanket',
					lot_ref: 'stock_ledger:LOT-2',
					qty: '20',
					allocation_ledger_id: 'stock_ledger:ALLOC-2',
					lot: { lot_no: 'L-260901-002' }
				}
			]
		});

		// Total distributed = 25 (FIFO: 20 from LOT-1, 5 from LOT-2)
		seedIssue(batch._id, 'item:blanket', '25');

		const closed = await repo.closeBatch(
			batch._id,
			{
				reconciliation: [
					{
						item_id: 'item:blanket',
						lot_ref: 'stock_ledger:LOT-2',
						damaged_qty: '1',
						damaged_note: 'ขาด'
					}
				]
			},
			WAREHOUSE_CTX
		);

		expect(closed.reconciliation).toHaveLength(2);

		const row1 = closed.reconciliation.find((r) => r.lot_ref === 'stock_ledger:LOT-1');
		expect(row1).toBeDefined();
		expect(row1?.allocated_qty).toBe('20');
		expect(row1?.distributed_qty).toBe('20');
		expect(row1?.return_qty).toBe('0');

		const row2 = closed.reconciliation.find((r) => r.lot_ref === 'stock_ledger:LOT-2');
		expect(row2).toBeDefined();
		expect(row2?.allocated_qty).toBe('20');
		expect(row2?.distributed_qty).toBe('5');
		expect(row2?.damaged_qty).toBe('1');
		expect(row2?.return_qty).toBe('14'); // 20 - (5 + 1) = 14

		// Return ledger is written specifically for LOT-2 with return_qty = 14
		expect(closed.return_ledger_ids).toHaveLength(1);
		const returnLedger = store.get(closed.return_ledger_ids[0]);
		expect(returnLedger?.lot_ref).toBe('stock_ledger:LOT-2');
		expect(returnLedger?.qty).toBe('14');
	});

	it('9. Issue in-flight blocks close with IssueInFlightError', async () => {
		const batch = seedBatch();

		// Seed a pending claim on capacity document for item:blanket
		const capDocId = await makeIssueCapacityDocId(batch._id, 'item:blanket');
		const hash = capDocId.slice('distribution_issue_capacity:'.length);
		const capDoc = createDistributionIssueCapacity(
			{
				batch_id: batch._id,
				item_id: 'item:blanket',
				pending_claims: [
					{
						operation_id: 'op-inflight-1',
						issue_id: `distribution_issue:${ulid()}`,
						batch_id: batch._id,
						item_id: 'item:blanket',
						qty: '1',
						claimed_at: '2026-09-01T01:00:00.000Z'
					}
				]
			},
			hash,
			WAREHOUSE_CTX
		);
		store.set(capDocId, JSON.parse(JSON.stringify(capDoc)));

		await expect(repo.closeBatch(batch._id, {}, WAREHOUSE_CTX)).rejects.toThrow(IssueInFlightError);
	});

	it('10. same-shelter enforcement succeeds', async () => {
		const batch = seedBatch({ shelter_code: 'SH001' });
		const closed = await repo.closeBatch(batch._id, {}, WAREHOUSE_CTX);
		expect(closed.status).toBe('closed');
	});

	it('11. cross-shelter rejection for wrong shelter context', async () => {
		const batch = seedBatch({ shelter_code: 'SH001' });

		// Staff from SH002 cannot close batch belonging to SH001
		await expect(repo.closeBatch(batch._id, {}, CROSS_SHELTER_WS_CTX)).rejects.toThrow(
			/Unauthorized: distribution closeBatch/
		);
	});

	it('12. closing_operation_id created once during close', async () => {
		const batch = seedBatch();
		const closed = await repo.closeBatch(batch._id, {}, WAREHOUSE_CTX);

		expect(closed.closing_operation_id).toBeDefined();
		expect(closed.closing_operation_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
	});

	it('13. retry of existing closing Batch does not create a new closing operation', async () => {
		const existingClosingOpId = ulid();
		const batch = seedBatch({
			status: 'closing',
			closing_operation_id: existingClosingOpId,
			reconciliation: [
				{
					item_id: 'item:blanket',
					lot_ref: 'stock_ledger:01JLOT00000000000000000001',
					allocated_qty: '40',
					distributed_qty: '30',
					damaged_qty: '0',
					lost_qty: '0',
					return_qty: '10'
				}
			]
		});

		// Calling closeBatch resumes the existing closing operation
		const closed = await repo.closeBatch(batch._id, {}, WAREHOUSE_CTX);

		expect(closed.status).toBe('closed');
		// Must preserve existing closing operation ID!
		expect(closed.closing_operation_id).toBe(existingClosingOpId);

		// Return ledger is generated with the existing closing operation ID prefix
		expect(closed.return_ledger_ids).toHaveLength(1);
		expect(closed.return_ledger_ids[0]).toBe(`stock_ledger:${existingClosingOpId}:0`);
	});

	it('14. retry with conflicting reconciliation input throws BatchClosingConflictError', async () => {
		const existingClosingOpId = ulid();
		const batch = seedBatch({
			status: 'closing',
			closing_operation_id: existingClosingOpId,
			reconciliation: [
				{
					item_id: 'item:blanket',
					lot_ref: 'stock_ledger:01JLOT00000000000000000001',
					allocated_qty: '40',
					distributed_qty: '30',
					damaged_qty: '0',
					lost_qty: '0',
					return_qty: '10'
				}
			]
		});

		// Caller retries with conflicting damaged_qty
		await expect(
			repo.closeBatch(
				batch._id,
				{
					reconciliation: [
						{
							item_id: 'item:blanket',
							lot_ref: 'stock_ledger:01JLOT00000000000000000001',
							damaged_qty: '5',
							damaged_note: 'conflicting'
						}
					]
				},
				WAREHOUSE_CTX
			)
		).rejects.toThrow(BatchClosingConflictError);
	});

	describe('Step 2.5 Correctness & Concurrency Audit', () => {
		it('Case 1: same item across 2 lots + damaged/lost is NOT duplicated', async () => {
			// Item A allocated across Lot A (20) and Lot B (20) = 40 total
			const batch = seedBatch({
				items: [
					{
						item_id: 'item:blanket',
						allocated_qty: '40',
						unit: 'piece',
						distribution_type_snapshot: 'one_time'
					}
				],
				allocations: [
					{
						item_id: 'item:blanket',
						lot_ref: 'stock_ledger:01JLOT00000000000000000001',
						qty: '20',
						allocation_ledger_id: 'stock_ledger:01JALLOC00000000000000001',
						lot: { lot_no: 'L-260901-001' }
					},
					{
						item_id: 'item:blanket',
						lot_ref: 'stock_ledger:01JLOT00000000000000000002',
						qty: '20',
						allocation_ledger_id: 'stock_ledger:01JALLOC00000000000000002',
						lot: { lot_no: 'L-260901-002' }
					}
				]
			});

			// Operator enters facts at item level: damaged = 2, lost = 1 (total loss/damage = 3)
			const closed = await repo.closeBatch(
				batch._id,
				{
					reconciliation: [
						{
							item_id: 'item:blanket',
							damaged_qty: '2',
							lost_qty: '1',
							damaged_note: '2 blankets torn',
							lost_note: '1 blanket dropped in mud'
						}
					]
				},
				WAREHOUSE_CTX
			);

			expect(closed.status).toBe('closed');
			expect(closed.reconciliation).toHaveLength(2);

			// Lot A absorbed the 2 damaged + 1 lost (capacity = 20 undistributed)
			const lotARow = closed.reconciliation.find(
				(r) => r.lot_ref === 'stock_ledger:01JLOT00000000000000000001'
			)!;
			expect(lotARow.allocated_qty).toBe('20');
			expect(lotARow.distributed_qty).toBe('0');
			expect(lotARow.damaged_qty).toBe('2');
			expect(lotARow.lost_qty).toBe('1');
			expect(lotARow.return_qty).toBe('17');

			// Lot B had 0 damaged + 0 lost because operator input was already satisfied
			const lotBRow = closed.reconciliation.find(
				(r) => r.lot_ref === 'stock_ledger:01JLOT00000000000000000002'
			)!;
			expect(lotBRow.allocated_qty).toBe('20');
			expect(lotBRow.distributed_qty).toBe('0');
			expect(lotBRow.damaged_qty).toBe('0');
			expect(lotBRow.lost_qty).toBe('0');
			expect(lotBRow.return_qty).toBe('20');

			// Total damaged across both lots must equal EXACTLY 2 (NOT 4!)
			const totalDamaged = closed.reconciliation.reduce(
				(sum, r) => (Number(sum) + Number(r.damaged_qty)).toString(),
				'0'
			);
			expect(totalDamaged).toBe('2');

			// Total lost across both lots must equal EXACTLY 1 (NOT 2!)
			const totalLost = closed.reconciliation.reduce(
				(sum, r) => (Number(sum) + Number(r.lost_qty)).toString(),
				'0'
			);
			expect(totalLost).toBe('1');

			// Total return across both lots = 17 + 20 = 37
			const totalReturn = closed.reconciliation.reduce(
				(sum, r) => (Number(sum) + Number(r.return_qty)).toString(),
				'0'
			);
			expect(totalReturn).toBe('37');
		});

		it('Case 2: issue starts in the close race window is rejected', async () => {
			const batch = seedBatch();
			const evacueeId = `evacuee:${ulid()}`;
			store.set(evacueeId, {
				_id: evacueeId,
				type: 'evacuee',
				shelter_code: 'SH001',
				current_stay: { status: 'active', zone: 'Zone 1' }
			});

			// Batch has transitioned to 'closing'
			const closingBatch = {
				...batch,
				status: 'closing' as const,
				closing_operation_id: ulid(),
				_rev: nextRev(batch._id)
			};
			store.set(batch._id, JSON.parse(JSON.stringify(closingBatch)));

			// createIssue attempts to commit on closing batch -> must be rejected
			await expect(
				repo.createIssue(
					{
						batch_id: batch._id,
						evacuee_id: evacueeId,
						item_id: 'item:blanket',
						qty: '1',
						idempotency_key: 'race-key-1'
					},
					REGISTRATION_CTX
				)
			).rejects.toThrow(/must be active to issue goods/);

			// Verify zero distribution_issue was persisted
			const allDocs = Array.from(store.values());
			const createdIssues = allDocs.filter((d) => d.type === 'distribution_issue');
			expect(createdIssues).toHaveLength(0);
		});

		it('Case 3: capacity doc 404 is tolerated and closing proceeds', async () => {
			const batch = seedBatch();
			// Ensure no capacity document exists in store (will return 404 / null)
			const capDocId = await makeIssueCapacityDocId(batch._id, 'item:blanket');
			store.delete(capDocId);

			const closed = await repo.closeBatch(batch._id, {}, WAREHOUSE_CTX);
			expect(closed.status).toBe('closed');
		});

		it('Case 4: capacity read 500/network error is NOT swallowed and fails closed', async () => {
			const batch = seedBatch();

			// Hook getDoc to simulate a 500 / network error on reading capacity document
			getDocHook = (id: string) => {
				if (id.startsWith('distribution_issue_capacity:')) {
					throw new Error('CouchDB 500: Connection refused / Internal error');
				}
				return undefined; // normal flow for others
			};

			await expect(repo.closeBatch(batch._id, {}, WAREHOUSE_CTX)).rejects.toThrow(
				'CouchDB 500: Connection refused / Internal error'
			);

			// Verify batch status was not modified to closed in store
			const currentBatch = store.get(batch._id) as unknown as DistributionBatch;
			expect(currentBatch.status).not.toBe('closed');
		});

		it('Case 5: closing Batch does not contain premature closed_at / closed_by', async () => {
			const batch = seedBatch();
			const closed = await repo.closeBatch(batch._id, {}, WAREHOUSE_CTX);
			expect(closed.status).toBe('closed');

			// Inspect the intermediate 'closing' write in putDocStrictCalls
			const closingCalls = putDocStrictCalls.filter(
				(d) => d.type === 'distribution_batch' && d.status === 'closing'
			);
			expect(closingCalls.length).toBeGreaterThan(0);
			for (const call of closingCalls) {
				expect(call.closed_at).toBeUndefined();
				expect(call.closed_by).toBeUndefined();
			}

			// Inspect the final 'closed' write in putDocStrictCalls
			const closedCalls = putDocStrictCalls.filter(
				(d) => d.type === 'distribution_batch' && d.status === 'closed'
			);
			expect(closedCalls).toHaveLength(1);
			expect(closedCalls[0].closed_at).toBeDefined();
			expect(closedCalls[0].closed_by).toBe('ws-1');
		});

		it('Case 6: closing retry missing reconciliation fails safely', async () => {
			const batch = seedBatch({
				status: 'closing',
				closing_operation_id: ulid(),
				reconciliation: []
			});

			await expect(repo.closeBatch(batch._id, {}, WAREHOUSE_CTX)).rejects.toThrow(IntegrityError);
		});

		it('Case 7: conflicting closing retry fails (quantities or notes)', async () => {
			const existingClosingOpId = ulid();
			const batch = seedBatch({
				status: 'closing',
				closing_operation_id: existingClosingOpId,
				reconciliation: [
					{
						item_id: 'item:blanket',
						lot_ref: 'stock_ledger:01JLOT00000000000000000001',
						allocated_qty: '40',
						distributed_qty: '30',
						damaged_qty: '2',
						lost_qty: '0',
						return_qty: '8',
						damaged_note: 'torn packaging'
					}
				]
			});

			// Conflicting quantity
			await expect(
				repo.closeBatch(
					batch._id,
					{
						reconciliation: [
							{
								item_id: 'item:blanket',
								lot_ref: 'stock_ledger:01JLOT00000000000000000001',
								damaged_qty: '5',
								damaged_note: 'torn packaging'
							}
						]
					},
					WAREHOUSE_CTX
				)
			).rejects.toThrow(BatchClosingConflictError);

			// Conflicting note
			await expect(
				repo.closeBatch(
					batch._id,
					{
						reconciliation: [
							{
								item_id: 'item:blanket',
								lot_ref: 'stock_ledger:01JLOT00000000000000000001',
								damaged_qty: '2',
								damaged_note: 'completely different note'
							}
						]
					},
					WAREHOUSE_CTX
				)
			).rejects.toThrow(BatchClosingConflictError);
		});

		it('Case 8: closed retry behavior matches documented contract', async () => {
			const closedBatch = seedBatch({
				status: 'closed',
				closing_operation_id: ulid(),
				closed_at: '2026-09-01T02:00:00.000Z',
				closed_by: 'ws-1',
				return_ledger_ids: ['stock_ledger:ret-1'],
				reconciliation: [
					{
						item_id: 'item:blanket',
						lot_ref: 'stock_ledger:01JLOT00000000000000000001',
						allocated_qty: '40',
						distributed_qty: '30',
						damaged_qty: '2',
						lost_qty: '0',
						return_qty: '8',
						damaged_note: 'torn packaging'
					}
				]
			});

			// A. Retry with empty input returns existing closed batch
			const retryEmpty = await repo.closeBatch(closedBatch._id, {}, WAREHOUSE_CTX);
			expect(retryEmpty.status).toBe('closed');
			expect(retryEmpty._id).toBe(closedBatch._id);

			// B. Retry with matching input returns existing closed batch
			const retryMatching = await repo.closeBatch(
				closedBatch._id,
				{
					reconciliation: [
						{
							item_id: 'item:blanket',
							lot_ref: 'stock_ledger:01JLOT00000000000000000001',
							damaged_qty: '2',
							damaged_note: 'torn packaging'
						}
					]
				},
				WAREHOUSE_CTX
			);
			expect(retryMatching.status).toBe('closed');

			// C. Retry with conflicting input throws BatchClosingConflictError
			await expect(
				repo.closeBatch(
					closedBatch._id,
					{
						reconciliation: [
							{
								item_id: 'item:blanket',
								lot_ref: 'stock_ledger:01JLOT00000000000000000001',
								damaged_qty: '99',
								damaged_note: 'torn packaging'
							}
						]
					},
					WAREHOUSE_CTX
				)
			).rejects.toThrow(BatchClosingConflictError);

			// D. Retry on corrupted closed batch missing reconciliation throws IntegrityError
			const corruptedClosed = seedBatch({
				status: 'closed',
				closing_operation_id: ulid(),
				closed_at: '2026-09-01T02:00:00.000Z',
				closed_by: 'ws-1',
				return_ledger_ids: ['stock_ledger:ret-1'],
				reconciliation: []
			});
			await expect(repo.closeBatch(corruptedClosed._id, {}, WAREHOUSE_CTX)).rejects.toThrow(
				IntegrityError
			);
		});
	});

	describe('Step 3 — Retry-Safe distribution_return Stock Ledger & Crash Recovery', () => {
		function seedMultiLotBatch(): DistributionBatch {
			const ulidPart = ulid();
			return seedBatch({
				_id: `distribution_batch:${ulidPart}`,
				request_id: `distribution_request:${ulidPart}`,
				items: [
					{
						item_id: 'item:blanket',
						allocated_qty: '40',
						unit: 'piece',
						distribution_type_snapshot: 'one_time'
					}
				],
				allocations: [
					{
						item_id: 'item:blanket',
						lot_ref: 'stock_ledger:01JLOT00000000000000000001',
						qty: '20',
						allocation_ledger_id: 'stock_ledger:01JALLOC00000000000000001',
						lot: { lot_no: 'L-260901-001' }
					},
					{
						item_id: 'item:blanket',
						lot_ref: 'stock_ledger:01JLOT00000000000000000002',
						qty: '20',
						allocation_ledger_id: 'stock_ledger:01JALLOC00000000000000002',
						lot: { lot_no: 'L-260901-002' }
					}
				]
			});
		}

		function seedInitialInventory(
			itemId: string,
			lotRef: string,
			initialQty: string,
			approvedQty: string,
			batchId: string
		) {
			const receiveLedger = {
				_id: lotRef,
				type: 'stock_ledger',
				item_id: itemId,
				qty: initialQty,
				unit: 'piece',
				reason: 'receive',
				ref_id: 'po-1',
				lot_ref: lotRef,
				shelter_code: 'SH001',
				created_by: 'ws-1',
				created_at: '2026-09-01T00:00:00.000Z'
			};
			store.set(receiveLedger._id, receiveLedger);

			const distributeLedgerId = `stock_ledger:outbound-${ulid()}`;
			const distributeLedger = {
				_id: distributeLedgerId,
				type: 'stock_ledger',
				item_id: itemId,
				qty: `-${approvedQty}`,
				unit: 'piece',
				reason: 'distribute',
				ref_id: batchId,
				lot_ref: lotRef,
				shelter_code: 'SH001',
				created_by: 'ws-1',
				created_at: '2026-09-01T00:05:00.000Z'
			};
			store.set(distributeLedger._id, distributeLedger);
		}

		it('T3-01: Normal positive return emits correct distribution_return ledger', async () => {
			const batch = seedBatch();
			seedIssue(batch._id, 'item:blanket', '30'); // allocated 40, distributed 30 -> return 10

			const closed = await repo.closeBatch(batch._id, {}, WAREHOUSE_CTX);
			expect(closed.status).toBe('closed');
			expect(closed.return_ledger_ids).toHaveLength(1);

			const ledgerId = closed.return_ledger_ids[0];
			const ledger = store.get(ledgerId)!;
			expect(ledger).toBeDefined();
			expect(ledger.type).toBe('stock_ledger');
			expect(ledger.reason).toBe('distribution_return');
			expect(ledger.qty).toBe('10');
			expect(ledger.ref_id).toBe(batch._id);
			expect(ledger.lot_ref).toBe('stock_ledger:01JLOT00000000000000000001');
			expect(ledger.shelter_code).toBe('SH001');
		});

		it('T3-02: return_qty = 0 emits no ledger', async () => {
			const batch = seedBatch();
			seedIssue(batch._id, 'item:blanket', '40'); // allocated 40, distributed 40 -> return 0

			const closed = await repo.closeBatch(batch._id, {}, WAREHOUSE_CTX);
			expect(closed.status).toBe('closed');
			expect(closed.return_ledger_ids).toEqual([]);

			const allLedgers = Array.from(store.values()).filter(
				(d) => d.type === 'stock_ledger' && d.reason === 'distribution_return'
			);
			expect(allLedgers).toHaveLength(0);
		});

		it('T3-03: original lot_ref preserved', async () => {
			const batch = seedBatch();
			seedIssue(batch._id, 'item:blanket', '35'); // return 5

			const closed = await repo.closeBatch(batch._id, {}, WAREHOUSE_CTX);
			const ledger = store.get(closed.return_ledger_ids[0])!;
			expect(ledger.lot_ref).toBe(batch.allocations[0].lot_ref);
		});

		it('T3-04: multiple lots create distinct deterministic return ledgers', async () => {
			const batch = seedMultiLotBatch(); // Lot A = 20, Lot B = 20
			// Distribute 17 from Lot A, 15 from Lot B (total distributed = 32)
			// Return: Lot A = 3, Lot B = 5
			seedIssue(batch._id, 'item:blanket', '20'); // exhausts Lot A
			seedIssue(batch._id, 'item:blanket', '12'); // takes 12 from Lot B (leaves 8 in Lot B)
			// Now operator enters item-level loss/damage: damaged = 0, lost = 0 -> Lot A return = 0, Lot B return = 8
			// Instead let's test specific returns on each lot by not distributing anything:
			const batch2 = seedMultiLotBatch();
			// Distribute 17 from Lot A (leaves 3), 15 from Lot B (leaves 5)
			seedIssue(batch2._id, 'item:blanket', '20'); // exhausts Lot A (0 return)
			// Let's test with no issues: Lot A return = 20, Lot B return = 20
			const batch3 = seedMultiLotBatch();
			const closed = await repo.closeBatch(batch3._id, {}, WAREHOUSE_CTX);

			expect(closed.return_ledger_ids).toHaveLength(2);
			const ledgerA = store.get(closed.return_ledger_ids[0])!;
			const ledgerB = store.get(closed.return_ledger_ids[1])!;

			expect(ledgerA.lot_ref).toBe('stock_ledger:01JLOT00000000000000000001');
			expect(ledgerA.qty).toBe('20');
			expect(ledgerB.lot_ref).toBe('stock_ledger:01JLOT00000000000000000002');
			expect(ledgerB.qty).toBe('20');
		});

		it('T3-05: deterministic IDs remain identical across repeated reconstruction', async () => {
			const batch = seedMultiLotBatch();
			const opId = ulid();
			const closingBatch = {
				...batch,
				status: 'closing' as const,
				closing_operation_id: opId,
				reconciliation: [
					{
						item_id: 'item:blanket',
						lot_ref: 'stock_ledger:01JLOT00000000000000000001',
						allocated_qty: '20',
						distributed_qty: '15',
						damaged_qty: '0',
						lost_qty: '0',
						return_qty: '5'
					},
					{
						item_id: 'item:blanket',
						lot_ref: 'stock_ledger:01JLOT00000000000000000002',
						allocated_qty: '20',
						distributed_qty: '10',
						damaged_qty: '0',
						lost_qty: '0',
						return_qty: '10'
					}
				],
				_rev: nextRev(batch._id)
			};
			store.set(batch._id, JSON.parse(JSON.stringify(closingBatch)));

			// First run
			const closed = await repo.closeBatch(batch._id, {}, WAREHOUSE_CTX);
			const idsFirstRun = [...closed.return_ledger_ids];
			expect(idsFirstRun).toEqual([`stock_ledger:${opId}:0`, `stock_ledger:${opId}:1`]);

			// Second run (retry on closed)
			const closedRetry = await repo.closeBatch(batch._id, {}, WAREHOUSE_CTX);
			expect(closedRetry.return_ledger_ids).toEqual(idsFirstRun);
		});

		it('T3-06: zero-return line does not destabilize later line IDs', async () => {
			const batch = seedMultiLotBatch();
			const opId = ulid();
			// Lot A has return = 0, Lot B has return = 10
			const closingBatch = {
				...batch,
				status: 'closing' as const,
				closing_operation_id: opId,
				reconciliation: [
					{
						item_id: 'item:blanket',
						lot_ref: 'stock_ledger:01JLOT00000000000000000001',
						allocated_qty: '20',
						distributed_qty: '20',
						damaged_qty: '0',
						lost_qty: '0',
						return_qty: '0'
					},
					{
						item_id: 'item:blanket',
						lot_ref: 'stock_ledger:01JLOT00000000000000000002',
						allocated_qty: '20',
						distributed_qty: '10',
						damaged_qty: '0',
						lost_qty: '0',
						return_qty: '10'
					}
				],
				_rev: nextRev(batch._id)
			};
			store.set(batch._id, JSON.parse(JSON.stringify(closingBatch)));

			const closed = await repo.closeBatch(batch._id, {}, WAREHOUSE_CTX);
			// Only Lot B (idx 1) produced a return ledger
			expect(closed.return_ledger_ids).toEqual([`stock_ledger:${opId}:1`]);

			// Retry keeps the exact same ID
			const closedRetry = await repo.closeBatch(batch._id, {}, WAREHOUSE_CTX);
			expect(closedRetry.return_ledger_ids).toEqual([`stock_ledger:${opId}:1`]);
		});

		it('T3-07: retry after identical existing ledger treats it as committed', async () => {
			const batch = seedBatch();
			const opId = ulid();
			const closingBatch = {
				...batch,
				status: 'closing' as const,
				closing_operation_id: opId,
				reconciliation: [
					{
						item_id: 'item:blanket',
						lot_ref: 'stock_ledger:01JLOT00000000000000000001',
						allocated_qty: '40',
						distributed_qty: '30',
						damaged_qty: '0',
						lost_qty: '0',
						return_qty: '10'
					}
				],
				_rev: nextRev(batch._id)
			};
			store.set(batch._id, JSON.parse(JSON.stringify(closingBatch)));

			// Pre-populate identical return ledger in store (as if committed before crash)
			const ledgerId = `stock_ledger:${opId}:0`;
			store.set(ledgerId, {
				_id: ledgerId,
				type: 'stock_ledger',
				item_id: 'item:blanket',
				qty: '10',
				unit: 'piece',
				reason: 'distribution_return',
				ref_id: batch._id,
				lot_ref: 'stock_ledger:01JLOT00000000000000000001',
				lot: { lot_no: 'L-260901-001' },
				shelter_code: 'SH001',
				created_by: 'ws-1',
				created_at: '2026-09-01T00:00:00.000Z',
				occurred_at: closingBatch.updated_at,
				_rev: '1-existing'
			});

			const closed = await repo.closeBatch(batch._id, {}, WAREHOUSE_CTX);
			expect(closed.status).toBe('closed');
			expect(closed.return_ledger_ids).toEqual([ledgerId]);
		});

		it('T3-08: existing deterministic ledger with different qty throws IntegrityError', async () => {
			const batch = seedBatch();
			const opId = ulid();
			const closingBatch = {
				...batch,
				status: 'closing' as const,
				closing_operation_id: opId,
				reconciliation: [
					{
						item_id: 'item:blanket',
						lot_ref: 'stock_ledger:01JLOT00000000000000000001',
						allocated_qty: '40',
						distributed_qty: '30',
						damaged_qty: '0',
						lost_qty: '0',
						return_qty: '10'
					}
				],
				_rev: nextRev(batch._id)
			};
			store.set(batch._id, JSON.parse(JSON.stringify(closingBatch)));

			// Pre-populate mismatched ledger with qty 99 instead of 10
			const ledgerId = `stock_ledger:${opId}:0`;
			store.set(ledgerId, {
				_id: ledgerId,
				type: 'stock_ledger',
				item_id: 'item:blanket',
				qty: '99',
				unit: 'piece',
				reason: 'distribution_return',
				ref_id: batch._id,
				lot_ref: 'stock_ledger:01JLOT00000000000000000001',
				shelter_code: 'SH001',
				_rev: '1-tampered'
			});

			await expect(repo.closeBatch(batch._id, {}, WAREHOUSE_CTX)).rejects.toThrow(IntegrityError);
		});

		it('T3-09: existing deterministic ledger with different lot_ref throws IntegrityError', async () => {
			const batch = seedBatch();
			const opId = ulid();
			const closingBatch = {
				...batch,
				status: 'closing' as const,
				closing_operation_id: opId,
				reconciliation: [
					{
						item_id: 'item:blanket',
						lot_ref: 'stock_ledger:01JLOT00000000000000000001',
						allocated_qty: '40',
						distributed_qty: '30',
						damaged_qty: '0',
						lost_qty: '0',
						return_qty: '10'
					}
				],
				_rev: nextRev(batch._id)
			};
			store.set(batch._id, JSON.parse(JSON.stringify(closingBatch)));

			// Pre-populate mismatched ledger with wrong lot_ref
			const ledgerId = `stock_ledger:${opId}:0`;
			store.set(ledgerId, {
				_id: ledgerId,
				type: 'stock_ledger',
				item_id: 'item:blanket',
				qty: '10',
				unit: 'piece',
				reason: 'distribution_return',
				ref_id: batch._id,
				lot_ref: 'stock_ledger:WRONG_LOT_REF',
				shelter_code: 'SH001',
				_rev: '1-tampered'
			});

			await expect(repo.closeBatch(batch._id, {}, WAREHOUSE_CTX)).rejects.toThrow(IntegrityError);
		});

		it('T3-10: crash before first ledger resumes safely', async () => {
			const batch = seedBatch();
			seedIssue(batch._id, 'item:blanket', '30'); // return 10

			// Simulate crash before first ledger write: putDoc throws on return ledger
			putDocHook = (doc) => {
				if (doc.type === 'stock_ledger' && doc.reason === 'distribution_return') {
					throw new Error('Simulated crash before first return ledger write');
				}
			};

			await expect(repo.closeBatch(batch._id, {}, WAREHOUSE_CTX)).rejects.toThrow(
				'Simulated crash before first return ledger write'
			);

			// Batch is now in 'closing' status in CouchDB
			const closingBatch = store.get(batch._id) as unknown as DistributionBatch;
			expect(closingBatch.status).toBe('closing');
			const opId = closingBatch.closing_operation_id;
			expect(opId).toBeDefined();

			// Remove failure hook and retry close
			putDocHook = null;
			const closed = await repo.closeBatch(batch._id, {}, WAREHOUSE_CTX);
			expect(closed.status).toBe('closed');
			expect(closed.closing_operation_id).toBe(opId);
			expect(closed.return_ledger_ids).toEqual([`stock_ledger:${opId}:0`]);
		});

		it('T3-11: partial multi-ledger crash writes only missing ledger(s)', async () => {
			const batch = seedMultiLotBatch(); // Lot A = 20, Lot B = 20 -> both have positive return
			let writtenCount = 0;

			// Crash on second ledger
			putDocHook = (doc) => {
				if (doc.type === 'stock_ledger' && doc.reason === 'distribution_return') {
					writtenCount++;
					if (writtenCount === 2) {
						throw new Error('Simulated crash on second return ledger write');
					}
				}
			};

			await expect(repo.closeBatch(batch._id, {}, WAREHOUSE_CTX)).rejects.toThrow(
				'Simulated crash on second return ledger write'
			);

			// Ledger 0 exists, Ledger 1 was not persisted
			const closingBatch = store.get(batch._id) as unknown as DistributionBatch;
			const opId = closingBatch.closing_operation_id!;
			expect(store.has(`stock_ledger:${opId}:0`)).toBe(true);
			expect(store.has(`stock_ledger:${opId}:1`)).toBe(false);

			// Remove failure hook and retry close
			putDocHook = null;
			const closed = await repo.closeBatch(batch._id, {}, WAREHOUSE_CTX);
			expect(closed.status).toBe('closed');
			expect(store.has(`stock_ledger:${opId}:0`)).toBe(true);
			expect(store.has(`stock_ledger:${opId}:1`)).toBe(true);
			expect(closed.return_ledger_ids).toEqual([
				`stock_ledger:${opId}:0`,
				`stock_ledger:${opId}:1`
			]);
		});

		it('T3-12: all ledgers exist + Batch closing resumes to closed', async () => {
			const batch = seedBatch();
			const opId = ulid();
			const ledgerId = `stock_ledger:${opId}:0`;

			// Seed closing batch
			const closingBatch = {
				...batch,
				status: 'closing' as const,
				closing_operation_id: opId,
				reconciliation: [
					{
						item_id: 'item:blanket',
						lot_ref: 'stock_ledger:01JLOT00000000000000000001',
						allocated_qty: '40',
						distributed_qty: '30',
						damaged_qty: '0',
						lost_qty: '0',
						return_qty: '10'
					}
				],
				_rev: nextRev(batch._id)
			};
			store.set(batch._id, JSON.parse(JSON.stringify(closingBatch)));

			// Seed existing return ledger
			store.set(ledgerId, {
				_id: ledgerId,
				type: 'stock_ledger',
				item_id: 'item:blanket',
				qty: '10',
				unit: 'piece',
				reason: 'distribution_return',
				ref_id: batch._id,
				lot_ref: 'stock_ledger:01JLOT00000000000000000001',
				lot: { lot_no: 'L-260901-001' },
				shelter_code: 'SH001',
				created_by: 'ws-1',
				created_at: '2026-09-01T00:00:00.000Z',
				occurred_at: closingBatch.updated_at,
				_rev: '1-done'
			});

			// Close resume
			const closed = await repo.closeBatch(batch._id, {}, WAREHOUSE_CTX);
			expect(closed.status).toBe('closed');
			expect(closed.return_ledger_ids).toEqual([ledgerId]);
		});

		it('T3-13: repeated close retry produces zero duplicate stock credits', async () => {
			const batch = seedBatch();
			seedIssue(batch._id, 'item:blanket', '30'); // return 10

			// Call closeBatch 5 times
			const r1 = await repo.closeBatch(batch._id, {}, WAREHOUSE_CTX);
			const r2 = await repo.closeBatch(batch._id, {}, WAREHOUSE_CTX);
			const r3 = await repo.closeBatch(batch._id, {}, WAREHOUSE_CTX);
			const r4 = await repo.closeBatch(batch._id, {}, WAREHOUSE_CTX);
			const r5 = await repo.closeBatch(batch._id, {}, WAREHOUSE_CTX);

			expect(r1.status).toBe('closed');
			expect(r2.status).toBe('closed');
			expect(r3.status).toBe('closed');
			expect(r4.status).toBe('closed');
			expect(r5.status).toBe('closed');

			// Count total distribution_return stock ledgers in entire store
			const returnLedgers = Array.from(store.values()).filter(
				(d) => d.type === 'stock_ledger' && d.reason === 'distribution_return'
			);
			expect(returnLedgers).toHaveLength(1);
		});

		it('T3-14: closed Batch retry produces no additional ledger', async () => {
			const batch = seedBatch();
			seedIssue(batch._id, 'item:blanket', '30');
			await repo.closeBatch(batch._id, {}, WAREHOUSE_CTX);

			const initialDocCount = store.size;

			// Retry 3 times
			await repo.closeBatch(batch._id, {}, WAREHOUSE_CTX);
			await repo.closeBatch(batch._id, {}, WAREHOUSE_CTX);
			await repo.closeBatch(batch._id, {}, WAREHOUSE_CTX);

			expect(store.size).toBe(initialDocCount);
		});

		it('T3-15: same logical closing operation keeps same return_ledger_ids ordering', async () => {
			const batch = seedMultiLotBatch();
			const closed1 = await repo.closeBatch(batch._id, {}, WAREHOUSE_CTX);
			const closed2 = await repo.closeBatch(batch._id, {}, WAREHOUSE_CTX);
			const closed3 = await repo.closeBatch(batch._id, {}, WAREHOUSE_CTX);

			expect(closed1.return_ledger_ids).toEqual(closed2.return_ledger_ids);
			expect(closed2.return_ledger_ids).toEqual(closed3.return_ledger_ids);
		});

		it('T3-16: network uncertainty after PUT is safe on retry', async () => {
			const batch = seedBatch();
			seedIssue(batch._id, 'item:blanket', '35'); // return 5

			// Simulate network timeout after document is written to CouchDB
			let droppedResponse = false;
			putDocHook = (doc) => {
				if (doc.type === 'stock_ledger' && !droppedResponse) {
					droppedResponse = true;
					// Save to store (CouchDB committed it)
					const rev = nextRev(doc._id);
					store.set(doc._id, JSON.parse(JSON.stringify({ ...doc, _rev: rev })));
					// But network drops before client receives 201 response:
					throw new Error('ETIMEDOUT: Connection reset by peer');
				}
			};

			await expect(repo.closeBatch(batch._id, {}, WAREHOUSE_CTX)).rejects.toThrow('ETIMEDOUT');

			// Retry: putDoc encounters existing doc, catches 409, fetches, semantic matches, and finishes
			putDocHook = null;
			const closed = await repo.closeBatch(batch._id, {}, WAREHOUSE_CTX);
			expect(closed.status).toBe('closed');
			expect(closed.return_ledger_ids).toHaveLength(1);
		});

		it('T3-17: retry by another authorized actor does not produce duplicate credit or false semantic mismatch', async () => {
			const batch = seedBatch();
			seedIssue(batch._id, 'item:blanket', '30'); // return 10

			// Staff A starts closing, crashes on ledger write
			putDocHook = (doc) => {
				if (doc.type === 'stock_ledger') {
					throw new Error('Staff A network failure');
				}
			};
			const STAFF_A_CTX: AuthorContext = {
				shelterCode: 'SH001',
				createdBy: 'ws-staff-a',
				roles: ['SH001:warehouse_staff']
			};
			await expect(repo.closeBatch(batch._id, {}, STAFF_A_CTX)).rejects.toThrow(
				'Staff A network failure'
			);

			// Staff B retries the same closing operation
			putDocHook = null;
			const STAFF_B_CTX: AuthorContext = {
				shelterCode: 'SH001',
				createdBy: 'ws-staff-b',
				roles: ['SH001:warehouse_staff']
			};
			const closed = await repo.closeBatch(batch._id, {}, STAFF_B_CTX);
			expect(closed.status).toBe('closed');
			expect(closed.closed_by).toBe('ws-staff-b');

			// Retry again with Admin
			const closedByAdmin = await repo.closeBatch(batch._id, {}, ADMIN_CTX);
			expect(closedByAdmin.status).toBe('closed');
		});

		it('T3-18: stable timestamp/audit metadata survives retry', async () => {
			const batch = seedBatch();
			seedIssue(batch._id, 'item:blanket', '30'); // return 10

			const closed = await repo.closeBatch(batch._id, {}, WAREHOUSE_CTX);
			const ledger1 = store.get(closed.return_ledger_ids[0])!;
			const occurredAt = ledger1.occurred_at;

			// Retry
			const closedRetry = await repo.closeBatch(batch._id, {}, WAREHOUSE_CTX);
			const ledger2 = store.get(closedRetry.return_ledger_ids[0])!;
			expect(ledger2.occurred_at).toBe(occurredAt);
		});

		it('T3-18b: retry reconstructs the same durable return-ledger occurred_at', async () => {
			const batch = seedBatch();
			seedIssue(batch._id, 'item:blanket', '30');
			const proposedOccurredAt: string[] = [];
			let failFirstLedger = true;

			putDocHook = (doc) => {
				if (doc.type === 'stock_ledger' && doc.reason === 'distribution_return') {
					proposedOccurredAt.push(doc.occurred_at as string);
					if (failFirstLedger) {
						failFirstLedger = false;
						throw new Error('Simulated crash before return ledger persistence');
					}
				}
			};

			await expect(repo.closeBatch(batch._id, {}, WAREHOUSE_CTX)).rejects.toThrow(
				'Simulated crash before return ledger persistence'
			);
			const durableClosing = store.get(batch._id) as unknown as DistributionBatch;
			expect(durableClosing.status).toBe('closing');

			const closed = await repo.closeBatch(batch._id, {}, WAREHOUSE_CTX);
			expect(closed.status).toBe('closed');
			expect(proposedOccurredAt).toEqual([durableClosing.updated_at, durableClosing.updated_at]);
		});

		it('T3-19: mismatched deterministic ledger fails closed', async () => {
			const batch = seedBatch();
			const opId = ulid();
			const closingBatch = {
				...batch,
				status: 'closing' as const,
				closing_operation_id: opId,
				reconciliation: [
					{
						item_id: 'item:blanket',
						lot_ref: 'stock_ledger:01JLOT00000000000000000001',
						allocated_qty: '40',
						distributed_qty: '30',
						damaged_qty: '0',
						lost_qty: '0',
						return_qty: '10'
					}
				],
				_rev: nextRev(batch._id)
			};
			store.set(batch._id, JSON.parse(JSON.stringify(closingBatch)));

			// Pre-populate ledger with mismatched shelter_code
			const ledgerId = `stock_ledger:${opId}:0`;
			store.set(ledgerId, {
				_id: ledgerId,
				type: 'stock_ledger',
				item_id: 'item:blanket',
				qty: '10',
				unit: 'piece',
				reason: 'distribution_return',
				ref_id: batch._id,
				lot_ref: 'stock_ledger:01JLOT00000000000000000001',
				shelter_code: 'SH002_FORGED',
				_rev: '1-forged'
			});

			await expect(repo.closeBatch(batch._id, {}, WAREHOUSE_CTX)).rejects.toThrow(IntegrityError);
		});

		it('T3-20: final closing -> closed CAS retry remains idempotent', async () => {
			const batch = seedBatch();
			seedIssue(batch._id, 'item:blanket', '30'); // return 10

			let firstAttempt = true;
			// Simulate concurrent close on final CAS: another worker closes it just before putDocStrict
			putDocStrictHook = (doc) => {
				if (doc.type === 'distribution_batch' && doc.status === 'closed' && firstAttempt) {
					firstAttempt = false;
					// Simulate another worker successfully closed it
					const concurrentClosed = {
						...doc,
						_rev: nextRev(doc._id)
					};
					store.set(doc._id, JSON.parse(JSON.stringify(concurrentClosed)));
					// Current worker hits conflict:
					throw new Error('Conflict on final close');
				}
			};

			const closed = await repo.closeBatch(batch._id, {}, WAREHOUSE_CTX);
			expect(closed.status).toBe('closed');
		});

		it('T3-21 (Section 26): Assert stock balance exactly-once proof across retries', async () => {
			const batch = seedBatch();
			// Initial inventory = 100, approved = 40 (leaves 60)
			seedInitialInventory(
				'item:blanket',
				'stock_ledger:01JLOT00000000000000000001',
				'100',
				'40',
				batch._id
			);

			// Pre-close stock balance = 100 - 40 = 60
			expect(computeStockBalance('item:blanket')).toBe('60');

			// Distributed 38 units, so return_qty = 40 - 38 = 2
			seedIssue(batch._id, 'item:blanket', '38');

			// Close batch -> stock balance should increase from 60 to 62
			const closed = await repo.closeBatch(batch._id, {}, WAREHOUSE_CTX);
			expect(closed.status).toBe('closed');
			expect(computeStockBalance('item:blanket')).toBe('62');

			// Retry close 5 times!
			for (let i = 0; i < 5; i++) {
				await repo.closeBatch(batch._id, {}, WAREHOUSE_CTX);
				// MUST REMAIN 62, NEVER 64, 66, 68...
				expect(computeStockBalance('item:blanket')).toBe('62');
			}

			// Duplicate ledger count must be 0 (exactly 1 return ledger exists)
			const returnLedgers = Array.from(store.values()).filter(
				(d) => d.type === 'stock_ledger' && d.reason === 'distribution_return'
			);
			expect(returnLedgers).toHaveLength(1);
		});

		it('T3-22 (Section 27): Multi-lot balance test across retries', async () => {
			const batch = seedMultiLotBatch(); // Lot A = 20, Lot B = 20
			const lotARef = 'stock_ledger:01JLOT00000000000000000001';
			const lotBRef = 'stock_ledger:01JLOT00000000000000000002';

			// Seed initial 50 in Lot A, 50 in Lot B
			seedInitialInventory('item:blanket', lotARef, '50', '20', batch._id);
			seedInitialInventory('item:blanket', lotBRef, '50', '20', batch._id);

			expect(computeStockBalance('item:blanket', lotARef)).toBe('30');
			expect(computeStockBalance('item:blanket', lotBRef)).toBe('30');

			// Distribute 17 from Lot A, 15 from Lot B (total distributed = 32)
			// Return: Lot A = 3, Lot B = 5
			// We achieve this via FIFO: 20 from Lot A, 12 from Lot B = 32 distributed
			// Wait, to get Lot A return 3, distributed from Lot A must be 17.
			// Let's seed an explicit closing batch with Lot A return = 3 and Lot B return = 5:
			const opId = ulid();
			const closingBatch = {
				...batch,
				status: 'closing' as const,
				closing_operation_id: opId,
				reconciliation: [
					{
						item_id: 'item:blanket',
						lot_ref: lotARef,
						allocated_qty: '20',
						distributed_qty: '17',
						damaged_qty: '0',
						lost_qty: '0',
						return_qty: '3'
					},
					{
						item_id: 'item:blanket',
						lot_ref: lotBRef,
						allocated_qty: '20',
						distributed_qty: '15',
						damaged_qty: '0',
						lost_qty: '0',
						return_qty: '5'
					}
				],
				_rev: nextRev(batch._id)
			};
			store.set(batch._id, JSON.parse(JSON.stringify(closingBatch)));

			// Close batch
			const closed = await repo.closeBatch(batch._id, {}, WAREHOUSE_CTX);
			expect(closed.status).toBe('closed');

			// Lot A net return = +3 -> balance becomes 30 + 3 = 33
			// Lot B net return = +5 -> balance becomes 30 + 5 = 35
			expect(computeStockBalance('item:blanket', lotARef)).toBe('33');
			expect(computeStockBalance('item:blanket', lotBRef)).toBe('35');
			expect(computeStockBalance('item:blanket')).toBe('68');

			// Retry 5 times
			for (let i = 0; i < 5; i++) {
				await repo.closeBatch(batch._id, {}, WAREHOUSE_CTX);
				expect(computeStockBalance('item:blanket', lotARef)).toBe('33');
				expect(computeStockBalance('item:blanket', lotBRef)).toBe('35');
				expect(computeStockBalance('item:blanket')).toBe('68');
			}
		});

		it('Step 4: concurrent active close attempts converge on one logical operation', async () => {
			const batch = seedBatch();
			seedIssue(batch._id, 'item:blanket', '38');
			const actorB: AuthorContext = {
				shelterCode: 'SH001',
				createdBy: 'ws-2',
				roles: ['SH001:warehouse_staff']
			};

			const attempts = await Promise.allSettled([
				repo.closeBatch(batch._id, {}, WAREHOUSE_CTX),
				repo.closeBatch(batch._id, {}, actorB)
			]);
			expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
			expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1);

			const resumed = await repo.closeBatch(batch._id, {}, actorB);
			const returnLedgers = Array.from(store.values()).filter(
				(doc) => doc.type === 'stock_ledger' && doc.reason === 'distribution_return'
			);
			expect(resumed.status).toBe('closed');
			expect(returnLedgers).toHaveLength(1);
			expect(resumed.return_ledger_ids).toEqual([returnLedgers[0]._id]);
		});

		it('GATE-01: admitted Issue blocks close until it commits and releases its gate claim', async () => {
			const batch = seedBatch();
			const evacueeId = `evacuee:${ulid()}`;
			store.set(evacueeId, {
				_id: evacueeId,
				type: 'evacuee',
				shelter_code: 'SH001',
				current_stay: { status: 'active' }
			});
			let releaseIssue!: () => void;
			let issueAtPersist!: () => void;
			const mayPersist = new Promise<void>((resolve) => (releaseIssue = resolve));
			const reachedPersist = new Promise<void>((resolve) => (issueAtPersist = resolve));
			putDocHook = async (doc) => {
				if (doc.type === 'distribution_issue') {
					issueAtPersist();
					await mayPersist;
				}
			};

			const issuePromise = repo.createIssue(
				{
					batch_id: batch._id,
					evacuee_id: evacueeId,
					item_id: 'item:blanket',
					qty: '1',
					idempotency_key: 'gate-issue-wins'
				},
				REGISTRATION_CTX
			);
			await reachedPersist;
			await expect(repo.closeBatch(batch._id, {}, WAREHOUSE_CTX)).rejects.toThrow(
				IssueInFlightError
			);
			releaseIssue();
			await issuePromise;
			const gateId = await makeIssueGateDocId(batch._id);
			expect(requireIssueGate(gateId).pending_claims).toEqual([]);
			expect((await repo.closeBatch(batch._id, {}, WAREHOUSE_CTX)).status).toBe('closed');
		});

		it('GATE-07: close pre-forward failure reopens its sealed gate', async () => {
			const batch = seedBatch();
			seedIssue(batch._id, 'item:blanket', '39');
			await expect(
				repo.closeBatch(
					batch._id,
					{
						reconciliation: [
							{
								item_id: 'item:blanket',
								lot_ref: 'stock_ledger:01JLOT00000000000000000001',
								damaged_qty: '2',
								damaged_note: 'damaged'
							}
						]
					},
					WAREHOUSE_CTX
				)
			).rejects.toThrow(ReconciliationIntegrityError);
			const gateId = await makeIssueGateDocId(batch._id);
			const gate = requireIssueGate(gateId);
			expect(store.get(batch._id)?.status).toBe('active');
			expect(gate.state).toBe('open');
			expect(gate.pending_claims).toEqual([]);
		});

		it('GATE-04: Issue failure after admission releases its gate claim', async () => {
			const batch = seedBatch();
			const evacueeId = `evacuee:${ulid()}`;
			store.set(evacueeId, {
				_id: evacueeId,
				type: 'evacuee',
				shelter_code: 'SH001',
				current_stay: { status: 'active' }
			});
			await expect(
				repo.createIssue(
					{
						batch_id: batch._id,
						evacuee_id: evacueeId,
						item_id: 'item:blanket',
						qty: '41',
						idempotency_key: 'gate-cleanup-failure'
					},
					REGISTRATION_CTX
				)
			).rejects.toThrow();
			const gate = requireIssueGate(await makeIssueGateDocId(batch._id));
			expect(gate.state).toBe('open');
			expect(gate.pending_claims).toEqual([]);
		});

		it('GATE-06: retry after Issue write uncertainty releases the durable gate claim', async () => {
			const batch = seedBatch();
			const evacueeId = `evacuee:${ulid()}`;
			store.set(evacueeId, {
				_id: evacueeId,
				type: 'evacuee',
				shelter_code: 'SH001',
				current_stay: { status: 'active' }
			});
			let droppedResponse = false;
			putDocHook = (doc) => {
				if (doc.type === 'distribution_issue' && !droppedResponse) {
					droppedResponse = true;
					store.set(doc._id, JSON.parse(JSON.stringify({ ...doc, _rev: nextRev(doc._id) })));
					throw new Error('ETIMEDOUT after Issue PUT');
				}
			};
			const input = {
				batch_id: batch._id,
				evacuee_id: evacueeId,
				item_id: 'item:blanket',
				qty: '1',
				idempotency_key: 'gate-post-write-crash'
			};
			await expect(repo.createIssue(input, REGISTRATION_CTX)).rejects.toThrow('ETIMEDOUT');
			putDocHook = null;
			await expect(repo.createIssue(input, REGISTRATION_CTX)).resolves.toMatchObject({
				batch_id: batch._id
			});
			expect(requireIssueGate(await makeIssueGateDocId(batch._id)).pending_claims).toEqual([]);
		});

		it('Step 4: issue cannot persist after close crosses the closing barrier', async () => {
			const batch = seedBatch();
			const evacueeId = `evacuee:${ulid()}`;
			store.set(evacueeId, {
				_id: evacueeId,
				type: 'evacuee',
				shelter_code: 'SH001',
				current_stay: { status: 'active', zone: 'Zone 1' }
			});

			let releaseClosing!: () => void;
			let closingReached!: () => void;
			const closingMayPersist = new Promise<void>((resolve) => (releaseClosing = resolve));
			const closingAtCas = new Promise<void>((resolve) => (closingReached = resolve));
			putDocStrictHook = async (doc) => {
				if (doc.type === 'distribution_batch' && doc.status === 'closing') {
					closingReached();
					await closingMayPersist;
				}
			};

			const closePromise = repo.closeBatch(batch._id, {}, WAREHOUSE_CTX);
			await closingAtCas;

			await expect(
				repo.createIssue(
					{
						batch_id: batch._id,
						evacuee_id: evacueeId,
						item_id: 'item:blanket',
						qty: '1',
						idempotency_key: 'close-race-window'
					},
					REGISTRATION_CTX
				)
			).rejects.toThrow(/closing and cannot accept new issues/);

			releaseClosing();
			const closed = await closePromise;
			expect(closed.status).toBe('closed');
			const gate = requireIssueGate(await makeIssueGateDocId(batch._id));
			expect(gate.state).toBe('sealed');
			expect(
				Array.from(store.values()).filter((doc) => doc.type === 'distribution_issue')
			).toHaveLength(0);
		});
	});
});
