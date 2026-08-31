// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AuthorContext } from '$lib/db/model';
import { now } from '$lib/db/model';
import {
	createDistributionBatch,
	createDistributionIssueIdempotency,
	createDistributionIssueCapacity,
	createDistributionOneTimeGuard
} from '../domain/distribution';
import {
	IssueConflictError,
	IssueCapacityError,
	RecipientNotActiveError,
	DistributionEligibilityError,
	ValidationError,
	makeIssueCapacityDocId,
	makeOneTimeGuardDocId,
	makeIssueIdempotencyDocId
} from './semantic-verify';
import { DistributionRemoteRepository } from './distribution.remote';
import { ConflictError } from '$lib/utils/errors';

interface InMemoryDoc {
	_id: string;
	_rev?: string;
	type?: string;
	[key: string]: unknown;
}

let store: Map<string, InMemoryDoc>;
let revCounters: Map<string, number>;
let beforeStrictWrite: ((doc: InMemoryDoc) => Promise<void> | void) | undefined;

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
		const existing = store.get(doc._id);
		const onConflict = options?.onConflict ?? 'throw';

		if (existing) {
			if (doc._rev && doc._rev !== existing._rev) {
				if (onConflict === 'return-existing') {
					return JSON.parse(JSON.stringify(existing)) as T;
				}
				throw new ConflictError(`Conflict on document ${doc._id}`);
			}
			if (!doc._rev && onConflict === 'return-existing') {
				return JSON.parse(JSON.stringify(existing)) as T;
			}
			if (!doc._rev && onConflict === 'throw') {
				throw new ConflictError(`Conflict on document ${doc._id}`);
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
		await beforeStrictWrite?.(doc as InMemoryDoc);
		const existing = store.get(doc._id);
		if (existing) {
			if (!doc._rev || doc._rev !== existing._rev) {
				throw new ConflictError(`Conflict on document ${doc._id}`);
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
	}
}));

const regStaffCtx: AuthorContext = {
	createdBy: 'Registration Staff',
	shelterCode: 'SH001',
	roles: ['registration_staff']
};

const managerCtx: AuthorContext = {
	createdBy: 'Shelter Manager',
	shelterCode: 'SH001',
	roles: ['shelter_manager']
};

const adminCtx: AuthorContext = {
	createdBy: 'System Admin',
	shelterCode: 'SH001',
	roles: ['system_admin']
};

const warehouseCtx: AuthorContext = {
	createdBy: 'Warehouse Staff',
	shelterCode: 'SH001',
	roles: ['warehouse_staff']
};

const kitchenCtx: AuthorContext = {
	createdBy: 'Kitchen Staff',
	shelterCode: 'SH001',
	roles: ['kitchen_staff']
};

describe('DistributionRemoteRepository — Phase 3B Issue Execution', () => {
	let repo: DistributionRemoteRepository;

	beforeEach(() => {
		store = new Map();
		revCounters = new Map();
		beforeStrictWrite = undefined;
		repo = new DistributionRemoteRepository('shelter_sh001');
	});

	function seedActiveEvacuee(id = 'evacuee:01JEVACUEE1', over: Record<string, unknown> = {}) {
		const doc: InMemoryDoc = {
			_id: id,
			type: 'evacuee',
			schema_v: 2,
			shelter_code: 'SH001',
			first_name: 'สมชาย',
			last_name: 'ใจดี',
			nickname: 'ชาย',
			current_stay: {
				status: 'active',
				zone: 'Zone-A'
			},
			created_at: now(),
			updated_at: now(),
			created_by: 'Registration Staff',
			...over
		};
		doc._rev = nextRev(id);
		store.set(id, doc);
		return doc;
	}

	function seedActiveBatch(
		id = 'distribution_batch:01JBATCH1',
		over: Record<string, unknown> = {}
	) {
		const reqId = `distribution_request:${id.slice('distribution_batch:'.length)}`;
		const doc = {
			...createDistributionBatch(
				{
					request_id: reqId,
					items: [
						{
							item_id: 'item:water',
							allocated_qty: '10',
							unit: 'bottle',
							distribution_type_snapshot: 'consumable' as const
						},
						{
							item_id: 'item:blanket',
							allocated_qty: '5',
							unit: 'piece',
							distribution_type_snapshot: 'one_time' as const
						}
					],
					allocations: [
						{
							item_id: 'item:water',
							lot_ref: 'stock_ledger:01JLOT1',
							lot: { note: 'water lot' },
							qty: '10',
							allocation_ledger_id: 'stock_ledger:01JALLOC1'
						},
						{
							item_id: 'item:blanket',
							lot_ref: 'stock_ledger:01JLOT2',
							lot: { note: 'blanket lot' },
							qty: '5',
							allocation_ledger_id: 'stock_ledger:01JALLOC2'
						}
					]
				},
				warehouseCtx
			),
			status: 'active' as const,
			activated_at: now(),
			activated_by: 'Warehouse Staff',
			...over
		};
		const saved: InMemoryDoc = { ...doc, _rev: nextRev(id) };
		store.set(id, saved);
		return saved;
	}

	describe('Recipient Search & Data Minimization', () => {
		it('authorizes recipient lookup before reading data and enforces shelter scope', async () => {
			seedActiveEvacuee('evacuee:01J1');
			seedActiveEvacuee('evacuee:OTHER', { shelter_code: 'SH002' });
			for (const ctx of [regStaffCtx, managerCtx, adminCtx]) {
				expect(await repo.listActiveRecipients(ctx)).toHaveLength(1);
				expect((await repo.getRecipient('evacuee:01J1', ctx))?._id).toBe('evacuee:01J1');
			}
			for (const ctx of [warehouseCtx, kitchenCtx, { ...regStaffCtx, roles: [] }]) {
				await expect(repo.listActiveRecipients(ctx)).rejects.toThrow(/Unauthorized/);
				await expect(repo.getRecipient('evacuee:01J1', ctx)).rejects.toThrow(/Unauthorized/);
			}
			expect(await repo.getRecipient('evacuee:OTHER', regStaffCtx)).toBeNull();
		});

		it('returns only minimal recipient DTO without leaking sensitive fields', async () => {
			seedActiveEvacuee('evacuee:01J1', {
				first_name: 'สมศรี',
				last_name: 'มีสุข',
				medical: { allergies: ['peanut'] },
				emergency_contact: { phone: '0812345678' },
				photo_url: 'https://example.com/photo.jpg'
			});

			const recipients = await repo.listActiveRecipients(regStaffCtx);
			expect(recipients).toHaveLength(1);
			const r = recipients[0];
			expect(r).toEqual({
				_id: 'evacuee:01J1',
				first_name: 'สมศรี',
				last_name: 'มีสุข',
				nickname: 'ชาย',
				current_stay: {
					status: 'active',
					zone: 'Zone-A'
				}
			});
			expect((r as unknown as Record<string, unknown>).medical).toBeUndefined();
			expect((r as unknown as Record<string, unknown>).emergency_contact).toBeUndefined();
			expect((r as unknown as Record<string, unknown>).photo_url).toBeUndefined();
		});

		it('filters out inactive evacuees (checked_out, temporary_leave, deceased)', async () => {
			seedActiveEvacuee('evacuee:01J_ACTIVE', { current_stay: { status: 'active', zone: 'A' } });
			seedActiveEvacuee('evacuee:01J_LEAVE', {
				current_stay: { status: 'temporary_leave', zone: 'A' }
			});
			seedActiveEvacuee('evacuee:01J_OUT', { current_stay: { status: 'checked_out', zone: 'A' } });
			seedActiveEvacuee('evacuee:01J_DEAD', { current_stay: { status: 'deceased', zone: 'A' } });

			const list = await repo.listActiveRecipients(regStaffCtx);
			expect(list).toHaveLength(1);
			expect(list[0]._id).toBe('evacuee:01J_ACTIVE');

			expect(await repo.getRecipient('evacuee:01J_LEAVE', regStaffCtx)).toBeNull();
			expect(await repo.getRecipient('evacuee:01J_OUT', regStaffCtx)).toBeNull();
		});

		it('supports search query matching first_name, last_name, or nickname', async () => {
			seedActiveEvacuee('evacuee:01J1', {
				first_name: 'สมชาย',
				last_name: 'ทองคำ',
				nickname: 'โจ้'
			});
			seedActiveEvacuee('evacuee:01J2', {
				first_name: 'วิภา',
				last_name: 'ใจดี',
				nickname: 'กุ้ง'
			});

			const byName = await repo.listActiveRecipients(regStaffCtx, 'สมชาย');
			expect(byName).toHaveLength(1);
			expect(byName[0]._id).toBe('evacuee:01J1');

			const byNick = await repo.listActiveRecipients(regStaffCtx, 'กุ้ง');
			expect(byNick).toHaveLength(1);
			expect(byNick[0]._id).toBe('evacuee:01J2');
		});
	});

	describe('Security & Role Authorization Matrix', () => {
		it('allows registration_staff, shelter_manager, and system_admin to issue goods', async () => {
			seedActiveEvacuee('evacuee:01J1');
			seedActiveBatch('distribution_batch:01JBATCH1');

			const issue1 = await repo.createIssue(
				{
					batch_id: 'distribution_batch:01JBATCH1',
					evacuee_id: 'evacuee:01J1',
					item_id: 'item:water',
					qty: '1',
					idempotency_key: 'idem-reg'
				},
				regStaffCtx
			);
			expect(issue1._id).toMatch(/^distribution_issue:.+/);

			const issue2 = await repo.createIssue(
				{
					batch_id: 'distribution_batch:01JBATCH1',
					evacuee_id: 'evacuee:01J1',
					item_id: 'item:water',
					qty: '1',
					idempotency_key: 'idem-mgr'
				},
				managerCtx
			);
			expect(issue2._id).toMatch(/^distribution_issue:.+/);

			const issue3 = await repo.createIssue(
				{
					batch_id: 'distribution_batch:01JBATCH1',
					evacuee_id: 'evacuee:01J1',
					item_id: 'item:water',
					qty: '1',
					idempotency_key: 'idem-adm'
				},
				adminCtx
			);
			expect(issue3._id).toMatch(/^distribution_issue:.+/);
		});

		it('rejects warehouse_staff and kitchen_staff before creating any mutation docs', async () => {
			seedActiveEvacuee('evacuee:01J1');
			seedActiveBatch('distribution_batch:01JBATCH1');

			const countBefore = store.size;

			await expect(
				repo.createIssue(
					{
						batch_id: 'distribution_batch:01JBATCH1',
						evacuee_id: 'evacuee:01J1',
						item_id: 'item:water',
						qty: '1',
						idempotency_key: 'idem-wh'
					},
					warehouseCtx
				)
			).rejects.toThrow(/Unauthorized/);

			await expect(
				repo.createIssue(
					{
						batch_id: 'distribution_batch:01JBATCH1',
						evacuee_id: 'evacuee:01J1',
						item_id: 'item:water',
						qty: '1',
						idempotency_key: 'idem-kt'
					},
					kitchenCtx
				)
			).rejects.toThrow(/Unauthorized/);

			// Assert ZERO mutation documents created
			expect(store.size).toBe(countBefore);
			const createdTypes = Array.from(store.values()).map((d) => d.type);
			expect(createdTypes.filter((t) => t === 'distribution_issue')).toHaveLength(0);
			expect(createdTypes.filter((t) => t === 'distribution_issue_idempotency')).toHaveLength(0);
			expect(createdTypes.filter((t) => t === 'distribution_issue_capacity')).toHaveLength(0);
			expect(createdTypes.filter((t) => t === 'distribution_one_time_guard')).toHaveLength(0);
		});
	});

	describe('Issue Happy Paths & Rejections', () => {
		it('1. active recipient + active batch + consumable item -> issue created', async () => {
			seedActiveEvacuee('evacuee:01J1');
			seedActiveBatch('distribution_batch:01JBATCH1');

			const issue = await repo.createIssue(
				{
					batch_id: 'distribution_batch:01JBATCH1',
					evacuee_id: 'evacuee:01J1',
					item_id: 'item:water',
					qty: '2',
					idempotency_key: 'idem-water-1'
				},
				regStaffCtx
			);

			expect(issue.type).toBe('distribution_issue');
			expect(issue.qty).toBe('2');
			expect(issue.unit).toBe('bottle'); // Authoritative snapshot from batch
			expect(issue.distribution_type_snapshot).toBe('consumable');
			expect(issue.eligibility_snapshot.eligible).toBe(true);
			expect(issue.eligibility_snapshot.decision).toBe('consumable');
		});

		it('2. first one_time receipt -> issue created', async () => {
			seedActiveEvacuee('evacuee:01J1');
			seedActiveBatch('distribution_batch:01JBATCH1');

			const issue = await repo.createIssue(
				{
					batch_id: 'distribution_batch:01JBATCH1',
					evacuee_id: 'evacuee:01J1',
					item_id: 'item:blanket',
					qty: '1',
					idempotency_key: 'idem-blanket-1'
				},
				regStaffCtx
			);

			expect(issue.distribution_type_snapshot).toBe('one_time');
			expect(issue.unit).toBe('piece');
			expect(issue.eligibility_snapshot.decision).toBe('first_receipt');
		});

		it('3. repeat one_time without override -> rejected', async () => {
			seedActiveEvacuee('evacuee:01J1');
			seedActiveBatch('distribution_batch:01JBATCH1');

			// First issue
			await repo.createIssue(
				{
					batch_id: 'distribution_batch:01JBATCH1',
					evacuee_id: 'evacuee:01J1',
					item_id: 'item:blanket',
					qty: '1',
					idempotency_key: 'idem-blanket-1'
				},
				regStaffCtx
			);

			// Second issue without override
			await expect(
				repo.createIssue(
					{
						batch_id: 'distribution_batch:01JBATCH1',
						evacuee_id: 'evacuee:01J1',
						item_id: 'item:blanket',
						qty: '1',
						idempotency_key: 'idem-blanket-2'
					},
					regStaffCtx
				)
			).rejects.toThrow(DistributionEligibilityError);
		});

		it('4. repeat one_time lost override -> created', async () => {
			seedActiveEvacuee('evacuee:01J1');
			seedActiveBatch('distribution_batch:01JBATCH1');

			await repo.createIssue(
				{
					batch_id: 'distribution_batch:01JBATCH1',
					evacuee_id: 'evacuee:01J1',
					item_id: 'item:blanket',
					qty: '1',
					idempotency_key: 'idem-blanket-1'
				},
				regStaffCtx
			);

			const overrideIssue = await repo.createIssue(
				{
					batch_id: 'distribution_batch:01JBATCH1',
					evacuee_id: 'evacuee:01J1',
					item_id: 'item:blanket',
					qty: '1',
					idempotency_key: 'idem-blanket-lost',
					repeat_override_reason: 'lost',
					repeat_override_note: 'Lost during flood movement'
				},
				regStaffCtx
			);

			expect(overrideIssue.repeat_override_reason).toBe('lost');
			expect(overrideIssue.eligibility_snapshot.decision).toBe('repeat_override');
		});

		it('5. repeat one_time damaged override -> created', async () => {
			seedActiveEvacuee('evacuee:01J1');
			seedActiveBatch('distribution_batch:01JBATCH1');

			await repo.createIssue(
				{
					batch_id: 'distribution_batch:01JBATCH1',
					evacuee_id: 'evacuee:01J1',
					item_id: 'item:blanket',
					qty: '1',
					idempotency_key: 'idem-blanket-1'
				},
				regStaffCtx
			);

			const overrideIssue = await repo.createIssue(
				{
					batch_id: 'distribution_batch:01JBATCH1',
					evacuee_id: 'evacuee:01J1',
					item_id: 'item:blanket',
					qty: '1',
					idempotency_key: 'idem-blanket-damaged',
					repeat_override_reason: 'damaged',
					repeat_override_note: 'Torn blanket'
				},
				regStaffCtx
			);

			expect(overrideIssue.repeat_override_reason).toBe('damaged');
			expect(overrideIssue.eligibility_snapshot.decision).toBe('repeat_override');
		});

		it('6. inactive recipient -> rejected', async () => {
			seedActiveEvacuee('evacuee:01J_OUT', { current_stay: { status: 'checked_out', zone: 'A' } });
			seedActiveBatch('distribution_batch:01JBATCH1');

			await expect(
				repo.createIssue(
					{
						batch_id: 'distribution_batch:01JBATCH1',
						evacuee_id: 'evacuee:01J_OUT',
						item_id: 'item:water',
						qty: '1',
						idempotency_key: 'idem-inactive'
					},
					regStaffCtx
				)
			).rejects.toThrow(RecipientNotActiveError);
		});

		it('7. missing recipient -> rejected', async () => {
			seedActiveBatch('distribution_batch:01JBATCH1');

			await expect(
				repo.createIssue(
					{
						batch_id: 'distribution_batch:01JBATCH1',
						evacuee_id: 'evacuee:MISSING',
						item_id: 'item:water',
						qty: '1',
						idempotency_key: 'idem-missing'
					},
					regStaffCtx
				)
			).rejects.toThrow(RecipientNotActiveError);
		});

		it('8. non-active batch -> rejected', async () => {
			seedActiveEvacuee('evacuee:01J1');
			seedActiveBatch('distribution_batch:01J_ACTIVATING', { status: 'activating' });

			await expect(
				repo.createIssue(
					{
						batch_id: 'distribution_batch:01J_ACTIVATING',
						evacuee_id: 'evacuee:01J1',
						item_id: 'item:water',
						qty: '1',
						idempotency_key: 'idem-act'
					},
					regStaffCtx
				)
			).rejects.toThrow(ValidationError);
		});

		it('9. item not in batch -> rejected', async () => {
			seedActiveEvacuee('evacuee:01J1');
			seedActiveBatch('distribution_batch:01JBATCH1');

			await expect(
				repo.createIssue(
					{
						batch_id: 'distribution_batch:01JBATCH1',
						evacuee_id: 'evacuee:01J1',
						item_id: 'item:nonexistent',
						qty: '1',
						idempotency_key: 'idem-none'
					},
					regStaffCtx
				)
			).rejects.toThrow(ValidationError);
		});

		it('10. quantity exactly remaining capacity -> accepted', async () => {
			seedActiveEvacuee('evacuee:01J1');
			seedActiveBatch('distribution_batch:01JBATCH1'); // water allocated = 10

			const issue = await repo.createIssue(
				{
					batch_id: 'distribution_batch:01JBATCH1',
					evacuee_id: 'evacuee:01J1',
					item_id: 'item:water',
					qty: '10',
					idempotency_key: 'idem-exact'
				},
				regStaffCtx
			);

			expect(issue.qty).toBe('10');
		});

		it('11. quantity above remaining capacity -> rejected', async () => {
			seedActiveEvacuee('evacuee:01J1');
			seedActiveBatch('distribution_batch:01JBATCH1'); // water allocated = 10

			await expect(
				repo.createIssue(
					{
						batch_id: 'distribution_batch:01JBATCH1',
						evacuee_id: 'evacuee:01J1',
						item_id: 'item:water',
						qty: '10.0001',
						idempotency_key: 'idem-over'
					},
					regStaffCtx
				)
			).rejects.toThrow(IssueCapacityError);
		});
	});

	describe('Zero Stock Deduction Regression (CR-059 Flow 2 Invariant)', () => {
		it('proves distribution_issue creation creates 0 new stock_ledger documents', async () => {
			seedActiveEvacuee('evacuee:01J1');
			seedActiveBatch('distribution_batch:01JBATCH1');

			// Seed existing Phase 3A stock ledgers
			const existingLedgers: InMemoryDoc[] = [
				{
					_id: 'stock_ledger:01J_OUT1',
					type: 'stock_ledger',
					schema_v: 2,
					shelter_code: 'SH001',
					item_id: 'item:water',
					qty: '-10',
					unit: 'bottle',
					reason: 'distribute',
					ref_id: 'distribution_batch:01JBATCH1',
					lot_ref: 'stock_ledger:01JLOT1',
					created_at: now(),
					updated_at: now(),
					created_by: 'Warehouse Staff'
				}
			];
			existingLedgers[0]._rev = nextRev(existingLedgers[0]._id);
			store.set(existingLedgers[0]._id, existingLedgers[0]);

			const ledgerCountBefore = Array.from(store.values()).filter(
				(d) => d.type === 'stock_ledger'
			).length;

			// Write distribution issue
			await repo.createIssue(
				{
					batch_id: 'distribution_batch:01JBATCH1',
					evacuee_id: 'evacuee:01J1',
					item_id: 'item:water',
					qty: '2',
					idempotency_key: 'idem-reg-stock'
				},
				regStaffCtx
			);

			const ledgerCountAfter = Array.from(store.values()).filter(
				(d) => d.type === 'stock_ledger'
			).length;

			expect(ledgerCountAfter).toBe(ledgerCountBefore);
		});
	});

	describe('Idempotency & Quantity Normalization', () => {
		it('returns same issue on retry with same idempotency key and same intent', async () => {
			seedActiveEvacuee('evacuee:01J1');
			seedActiveBatch('distribution_batch:01JBATCH1');

			const issue1 = await repo.createIssue(
				{
					batch_id: 'distribution_batch:01JBATCH1',
					evacuee_id: 'evacuee:01J1',
					item_id: 'item:water',
					qty: '2',
					idempotency_key: 'idem-key-1'
				},
				regStaffCtx
			);

			const issue2 = await repo.createIssue(
				{
					batch_id: 'distribution_batch:01JBATCH1',
					evacuee_id: 'evacuee:01J1',
					item_id: 'item:water',
					qty: '2',
					idempotency_key: 'idem-key-1'
				},
				regStaffCtx
			);

			expect(issue2._id).toBe(issue1._id);
			const allIssues = await repo.listIssuesByBatch('distribution_batch:01JBATCH1');
			expect(allIssues).toHaveLength(1);
		});

		it('normalizes quantities ("02.0" vs "2") and recognizes matching intent', async () => {
			seedActiveEvacuee('evacuee:01J1');
			seedActiveBatch('distribution_batch:01JBATCH1');

			const issue1 = await repo.createIssue(
				{
					batch_id: 'distribution_batch:01JBATCH1',
					evacuee_id: 'evacuee:01J1',
					item_id: 'item:water',
					qty: '02.00',
					idempotency_key: 'idem-norm'
				},
				regStaffCtx
			);

			const issue2 = await repo.createIssue(
				{
					batch_id: 'distribution_batch:01JBATCH1',
					evacuee_id: 'evacuee:01J1',
					item_id: 'item:water',
					qty: '2',
					idempotency_key: 'idem-norm'
				},
				regStaffCtx
			);

			expect(issue1.qty).toBe('2');
			expect(issue2._id).toBe(issue1._id);
		});

		it('fails closed with IssueConflictError if idempotency key is reused with different intent', async () => {
			seedActiveEvacuee('evacuee:01J1');
			seedActiveEvacuee('evacuee:01J2');
			seedActiveBatch('distribution_batch:01JBATCH1');

			await repo.createIssue(
				{
					batch_id: 'distribution_batch:01JBATCH1',
					evacuee_id: 'evacuee:01J1',
					item_id: 'item:water',
					qty: '2',
					idempotency_key: 'idem-conflict'
				},
				regStaffCtx
			);

			// Different evacuee
			await expect(
				repo.createIssue(
					{
						batch_id: 'distribution_batch:01JBATCH1',
						evacuee_id: 'evacuee:01J2',
						item_id: 'item:water',
						qty: '2',
						idempotency_key: 'idem-conflict'
					},
					regStaffCtx
				)
			).rejects.toThrow(IssueConflictError);

			// Different item
			await expect(
				repo.createIssue(
					{
						batch_id: 'distribution_batch:01JBATCH1',
						evacuee_id: 'evacuee:01J1',
						item_id: 'item:blanket',
						qty: '2',
						idempotency_key: 'idem-conflict'
					},
					regStaffCtx
				)
			).rejects.toThrow(IssueConflictError);

			// Different qty
			await expect(
				repo.createIssue(
					{
						batch_id: 'distribution_batch:01JBATCH1',
						evacuee_id: 'evacuee:01J1',
						item_id: 'item:water',
						qty: '3',
						idempotency_key: 'idem-conflict'
					},
					regStaffCtx
				)
			).rejects.toThrow(IssueConflictError);
		});
	});

	describe('DETERMINISTIC STALE-_rev ISSUE CAPACITY CAS CONFLICT TEST', () => {
		it('prevents over-allocation when two operations race on capacity coordination', async () => {
			seedActiveEvacuee('evacuee:01J1');
			seedActiveEvacuee('evacuee:01J2');
			seedActiveBatch('distribution_batch:01JBATCH1'); // water allocated = 10

			const capId = await makeIssueCapacityDocId('distribution_batch:01JBATCH1', 'item:water');
			store.set(capId, {
				...createDistributionIssueCapacity(
					{
						batch_id: 'distribution_batch:01JBATCH1',
						item_id: 'item:water',
						pending_claims: []
					},
					capId.slice('distribution_issue_capacity:'.length),
					regStaffCtx
				),
				_rev: nextRev(capId)
			});

			let reached = 0;
			let releaseBarrier!: () => void;
			const barrier = new Promise<void>((resolve) => {
				releaseBarrier = resolve;
			});

			beforeStrictWrite = async (doc) => {
				if (doc._id !== capId) return;
				reached += 1;
				if (reached === 2) {
					releaseBarrier();
				}
				await barrier;
			};

			const [resA, resB] = await Promise.allSettled([
				repo.createIssue(
					{
						batch_id: 'distribution_batch:01JBATCH1',
						evacuee_id: 'evacuee:01J1',
						item_id: 'item:water',
						qty: '6',
						idempotency_key: 'idem-race-A'
					},
					regStaffCtx
				),
				repo.createIssue(
					{
						batch_id: 'distribution_batch:01JBATCH1',
						evacuee_id: 'evacuee:01J2',
						item_id: 'item:water',
						qty: '6',
						idempotency_key: 'idem-race-B'
					},
					regStaffCtx
				)
			]);

			expect([resA, resB].filter((r) => r.status === 'fulfilled')).toHaveLength(1);
			expect([resA, resB].filter((r) => r.status === 'rejected')).toHaveLength(1);

			const rejectedResult = [resA, resB].find(
				(r) => r.status === 'rejected'
			) as PromiseRejectedResult;
			expect(rejectedResult.reason).toBeInstanceOf(IssueCapacityError);

			// Assert total committed quantity does not exceed 10
			const issues = await repo.listIssuesByBatch('distribution_batch:01JBATCH1');
			expect(issues).toHaveLength(1);
			expect(issues[0].qty).toBe('6');
		});
	});

	describe('DETERMINISTIC STALE-_rev ONE-TIME GUARD CAS CONFLICT TEST', () => {
		it('prevents duplicate first receipt when two operations race on one-time guard', async () => {
			seedActiveEvacuee('evacuee:01J1');
			seedActiveBatch('distribution_batch:01JBATCH1'); // blanket is one_time

			const guardId = await makeOneTimeGuardDocId('evacuee:01J1', 'item:blanket');
			store.set(guardId, {
				...createDistributionOneTimeGuard(
					{
						evacuee_id: 'evacuee:01J1',
						item_id: 'item:blanket',
						pending_claims: []
					},
					guardId.slice('distribution_one_time_guard:'.length),
					regStaffCtx
				),
				_rev: nextRev(guardId)
			});

			let reached = 0;
			let releaseBarrier!: () => void;
			const barrier = new Promise<void>((resolve) => {
				releaseBarrier = resolve;
			});

			beforeStrictWrite = async (doc) => {
				if (doc._id !== guardId) return;
				reached += 1;
				if (reached === 2) {
					releaseBarrier();
				}
				await barrier;
			};

			const [resA, resB] = await Promise.allSettled([
				repo.createIssue(
					{
						batch_id: 'distribution_batch:01JBATCH1',
						evacuee_id: 'evacuee:01J1',
						item_id: 'item:blanket',
						qty: '1',
						idempotency_key: 'idem-one-A'
					},
					regStaffCtx
				),
				repo.createIssue(
					{
						batch_id: 'distribution_batch:01JBATCH1',
						evacuee_id: 'evacuee:01J1',
						item_id: 'item:blanket',
						qty: '1',
						idempotency_key: 'idem-one-B'
					},
					regStaffCtx
				)
			]);

			expect([resA, resB].filter((r) => r.status === 'fulfilled')).toHaveLength(1);
			expect([resA, resB].filter((r) => r.status === 'rejected')).toHaveLength(1);

			const rejectedResult = [resA, resB].find(
				(r) => r.status === 'rejected'
			) as PromiseRejectedResult;
			expect(rejectedResult.reason).toBeInstanceOf(IssueConflictError);
			await expect(
				repo.createIssue(
					{
						batch_id: 'distribution_batch:01JBATCH1',
						evacuee_id: 'evacuee:01J1',
						item_id: 'item:blanket',
						qty: '1',
						idempotency_key: 'idem-one-B'
					},
					regStaffCtx
				)
			).rejects.toBeInstanceOf(DistributionEligibilityError);

			// Assert exactly 1 non-override issue exists
			const allIssues = Array.from(store.values()).filter(
				(d) => d.type === 'distribution_issue' && d.evacuee_id === 'evacuee:01J1'
			);
			expect(allIssues).toHaveLength(1);
		});
	});

	describe('Crash / Retry Recovery Matrix (B1–B7)', () => {
		const batchId = 'distribution_batch:01JBATCH1';
		const evacueeId = 'evacuee:01J1';
		const itemId = 'item:blanket';
		const idempotencyKey = 'idem-recovery-test';
		const issueId = 'distribution_issue:01JABCDEFGHJKMNPQRSTVWXYZ0';

		beforeEach(() => {
			seedActiveEvacuee(evacueeId);
			seedActiveBatch(batchId);
		});

		it('B1: Idempotency mapping exists only -> retry completes issue', async () => {
			const mapId = await makeIssueIdempotencyDocId(batchId, idempotencyKey);
			store.set(mapId, {
				...createDistributionIssueIdempotency(
					{
						batch_id: batchId,
						idempotency_key: idempotencyKey,
						issue_id: issueId,
						evacuee_id: evacueeId,
						item_id: itemId,
						qty: '1'
					},
					mapId.slice('distribution_issue_idempotency:'.length),
					regStaffCtx
				),
				_rev: nextRev(mapId)
			});

			const result = await repo.createIssue(
				{
					batch_id: batchId,
					evacuee_id: evacueeId,
					item_id: itemId,
					qty: '1',
					idempotency_key: idempotencyKey
				},
				regStaffCtx
			);

			expect(result._id).toBe(issueId);
			expect(result.qty).toBe('1');
		});

		it('B2: Idempotency map + one-time claim held -> retry completes without double claim', async () => {
			const mapId = await makeIssueIdempotencyDocId(batchId, idempotencyKey);
			store.set(mapId, {
				...createDistributionIssueIdempotency(
					{
						batch_id: batchId,
						idempotency_key: idempotencyKey,
						issue_id: issueId,
						evacuee_id: evacueeId,
						item_id: itemId,
						qty: '1'
					},
					mapId.slice('distribution_issue_idempotency:'.length),
					regStaffCtx
				),
				_rev: nextRev(mapId)
			});

			const guardId = await makeOneTimeGuardDocId(evacueeId, itemId);
			store.set(guardId, {
				...createDistributionOneTimeGuard(
					{
						evacuee_id: evacueeId,
						item_id: itemId,
						pending_claims: [
							{
								operation_id: await makeIssueIdempotencyDocId(batchId, idempotencyKey),
								issue_id: issueId,
								evacuee_id: evacueeId,
								item_id: itemId,
								claimed_at: now()
							}
						]
					},
					guardId.slice('distribution_one_time_guard:'.length),
					regStaffCtx
				),
				_rev: nextRev(guardId)
			});

			const result = await repo.createIssue(
				{
					batch_id: batchId,
					evacuee_id: evacueeId,
					item_id: itemId,
					qty: '1',
					idempotency_key: idempotencyKey
				},
				regStaffCtx
			);

			expect(result._id).toBe(issueId);
		});

		it('B3: Idempotency map + both claims held + issue absent -> retry creates issue', async () => {
			const mapId = await makeIssueIdempotencyDocId(batchId, idempotencyKey);
			store.set(mapId, {
				...createDistributionIssueIdempotency(
					{
						batch_id: batchId,
						idempotency_key: idempotencyKey,
						issue_id: issueId,
						evacuee_id: evacueeId,
						item_id: itemId,
						qty: '1'
					},
					mapId.slice('distribution_issue_idempotency:'.length),
					regStaffCtx
				),
				_rev: nextRev(mapId)
			});

			const guardId = await makeOneTimeGuardDocId(evacueeId, itemId);
			store.set(guardId, {
				...createDistributionOneTimeGuard(
					{
						evacuee_id: evacueeId,
						item_id: itemId,
						pending_claims: [
							{
								operation_id: await makeIssueIdempotencyDocId(batchId, idempotencyKey),
								issue_id: issueId,
								evacuee_id: evacueeId,
								item_id: itemId,
								claimed_at: now()
							}
						]
					},
					guardId.slice('distribution_one_time_guard:'.length),
					regStaffCtx
				),
				_rev: nextRev(guardId)
			});

			const capId = await makeIssueCapacityDocId(batchId, itemId);
			store.set(capId, {
				...createDistributionIssueCapacity(
					{
						batch_id: batchId,
						item_id: itemId,
						pending_claims: [
							{
								operation_id: await makeIssueIdempotencyDocId(batchId, idempotencyKey),
								issue_id: issueId,
								batch_id: batchId,
								item_id: itemId,
								qty: '1',
								claimed_at: now()
							}
						]
					},
					capId.slice('distribution_issue_capacity:'.length),
					regStaffCtx
				),
				_rev: nextRev(capId)
			});

			const result = await repo.createIssue(
				{
					batch_id: batchId,
					evacuee_id: evacueeId,
					item_id: itemId,
					qty: '1',
					idempotency_key: idempotencyKey
				},
				regStaffCtx
			);

			expect(result._id).toBe(issueId);
		});

		it('B4: Issue exists + claims remain -> retry cleans claims and returns issue', async () => {
			// First run to establish issue
			const issue = await repo.createIssue(
				{
					batch_id: batchId,
					evacuee_id: evacueeId,
					item_id: itemId,
					qty: '1',
					idempotency_key: idempotencyKey
				},
				regStaffCtx
			);

			// Re-inject lingering claims
			const guardId = await makeOneTimeGuardDocId(evacueeId, itemId);
			const capId = await makeIssueCapacityDocId(batchId, itemId);
			store.set(guardId, {
				...createDistributionOneTimeGuard(
					{
						evacuee_id: evacueeId,
						item_id: itemId,
						pending_claims: [
							{
								operation_id: await makeIssueIdempotencyDocId(batchId, idempotencyKey),
								issue_id: issue._id,
								evacuee_id: evacueeId,
								item_id: itemId,
								claimed_at: now()
							}
						]
					},
					guardId.slice('distribution_one_time_guard:'.length),
					regStaffCtx
				),
				_rev: nextRev(guardId)
			});
			store.set(capId, {
				...createDistributionIssueCapacity(
					{
						batch_id: batchId,
						item_id: itemId,
						pending_claims: [
							{
								operation_id: await makeIssueIdempotencyDocId(batchId, idempotencyKey),
								issue_id: issue._id,
								batch_id: batchId,
								item_id: itemId,
								qty: '1',
								claimed_at: now()
							}
						]
					},
					capId.slice('distribution_issue_capacity:'.length),
					regStaffCtx
				),
				_rev: nextRev(capId)
			});

			const retryResult = await repo.createIssue(
				{
					batch_id: batchId,
					evacuee_id: evacueeId,
					item_id: itemId,
					qty: '1',
					idempotency_key: idempotencyKey
				},
				regStaffCtx
			);

			expect(retryResult._id).toBe(issue._id);

			// Assert claims cleaned
			const guardAfter = store.get(guardId);
			expect(guardAfter?.pending_claims).toHaveLength(0);
			const capAfter = store.get(capId);
			expect(capAfter?.pending_claims).toHaveLength(0);
		});

		it('B5: Issue exists + capacity claim stale -> retry cleans and returns issue', async () => {
			const issue = await repo.createIssue(
				{
					batch_id: batchId,
					evacuee_id: evacueeId,
					item_id: itemId,
					qty: '1',
					idempotency_key: idempotencyKey
				},
				regStaffCtx
			);

			const capId = await makeIssueCapacityDocId(batchId, itemId);
			store.set(capId, {
				...createDistributionIssueCapacity(
					{
						batch_id: batchId,
						item_id: itemId,
						pending_claims: [
							{
								operation_id: await makeIssueIdempotencyDocId(batchId, idempotencyKey),
								issue_id: issue._id,
								batch_id: batchId,
								item_id: itemId,
								qty: '1',
								claimed_at: now()
							}
						]
					},
					capId.slice('distribution_issue_capacity:'.length),
					regStaffCtx
				),
				_rev: nextRev(capId)
			});

			const retry = await repo.createIssue(
				{
					batch_id: batchId,
					evacuee_id: evacueeId,
					item_id: itemId,
					qty: '1',
					idempotency_key: idempotencyKey
				},
				regStaffCtx
			);

			expect(retry._id).toBe(issue._id);
			const capAfter = store.get(capId);
			expect(capAfter?.pending_claims).toHaveLength(0);
		});

		it('B6: Issue exists + one-time claim stale -> retry cleans and returns issue', async () => {
			const issue = await repo.createIssue(
				{
					batch_id: batchId,
					evacuee_id: evacueeId,
					item_id: itemId,
					qty: '1',
					idempotency_key: idempotencyKey
				},
				regStaffCtx
			);

			const guardId = await makeOneTimeGuardDocId(evacueeId, itemId);
			store.set(guardId, {
				...createDistributionOneTimeGuard(
					{
						evacuee_id: evacueeId,
						item_id: itemId,
						pending_claims: [
							{
								operation_id: await makeIssueIdempotencyDocId(batchId, idempotencyKey),
								issue_id: issue._id,
								evacuee_id: evacueeId,
								item_id: itemId,
								claimed_at: now()
							}
						]
					},
					guardId.slice('distribution_one_time_guard:'.length),
					regStaffCtx
				),
				_rev: nextRev(guardId)
			});

			const retry = await repo.createIssue(
				{
					batch_id: batchId,
					evacuee_id: evacueeId,
					item_id: itemId,
					qty: '1',
					idempotency_key: idempotencyKey
				},
				regStaffCtx
			);

			expect(retry._id).toBe(issue._id);
			const guardAfter = store.get(guardId);
			expect(guardAfter?.pending_claims).toHaveLength(0);
		});

		it('B7: Issue exists + both claims stale -> retry cleans and returns issue', async () => {
			const issue = await repo.createIssue(
				{
					batch_id: batchId,
					evacuee_id: evacueeId,
					item_id: itemId,
					qty: '1',
					idempotency_key: idempotencyKey
				},
				regStaffCtx
			);

			const guardId = await makeOneTimeGuardDocId(evacueeId, itemId);
			const capId = await makeIssueCapacityDocId(batchId, itemId);
			store.set(guardId, {
				...createDistributionOneTimeGuard(
					{
						evacuee_id: evacueeId,
						item_id: itemId,
						pending_claims: [
							{
								operation_id: await makeIssueIdempotencyDocId(batchId, idempotencyKey),
								issue_id: issue._id,
								evacuee_id: evacueeId,
								item_id: itemId,
								claimed_at: now()
							}
						]
					},
					guardId.slice('distribution_one_time_guard:'.length),
					regStaffCtx
				),
				_rev: nextRev(guardId)
			});
			store.set(capId, {
				...createDistributionIssueCapacity(
					{
						batch_id: batchId,
						item_id: itemId,
						pending_claims: [
							{
								operation_id: await makeIssueIdempotencyDocId(batchId, idempotencyKey),
								issue_id: issue._id,
								batch_id: batchId,
								item_id: itemId,
								qty: '1',
								claimed_at: now()
							}
						]
					},
					capId.slice('distribution_issue_capacity:'.length),
					regStaffCtx
				),
				_rev: nextRev(capId)
			});

			const retry = await repo.createIssue(
				{
					batch_id: batchId,
					evacuee_id: evacueeId,
					item_id: itemId,
					qty: '1',
					idempotency_key: idempotencyKey
				},
				regStaffCtx
			);

			expect(retry._id).toBe(issue._id);
			expect(store.get(guardId)?.pending_claims).toHaveLength(0);
			expect(store.get(capId)?.pending_claims).toHaveLength(0);
		});
	});
});
