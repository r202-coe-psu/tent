import { describe, expect, it } from 'vitest';
import type { AuthorContext } from '$lib/db/model';
import {
	assertPoolTransition,
	bulkReturnPoolV3DocSchema,
	canAppendToPool,
	createBulkReturnPoolV3,
	type BulkReturnPoolV3
} from './bulk-return-pool-v3';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'staff:wh' };
const ULID = '01J00000000000000000000000';
const OP_ULID = '01J00000000000000000000009';
const TS = '2026-10-01T00:00:00.000Z';

const lock = { op: 'SUBMIT', op_id: OP_ULID, locked_at: TS, locked_by: 'staff:wh' } as const;

// Created once so every derived fixture shares identical created_at/updated_at.
const basePool = createBulkReturnPoolV3({ name: 'Zone A drop-off', location: 'Gate 1' }, ctx, ULID);
const openPool = (): BulkReturnPoolV3 => ({ ...basePool });

const submittedPool = (over: Record<string, unknown> = {}): BulkReturnPoolV3 =>
	({
		...openPool(),
		status: 'SUBMITTED',
		items_summary: [{ item_id: 'item_master:cot', qty: '3' }],
		submitted_at: TS,
		submitted_by: 'staff:wh',
		...over
	}) as BulkReturnPoolV3;

const accepts = (doc: unknown) =>
	expect(bulkReturnPoolV3DocSchema.safeParse(doc).success).toBe(true);
const rejects = (doc: unknown) =>
	expect(bulkReturnPoolV3DocSchema.safeParse(doc).success).toBe(false);

describe('createBulkReturnPoolV3', () => {
	it('creates an OPEN schema_v 3 pool without quantities, lock, summary or submit audit', () => {
		const pool = openPool();
		expect(pool).toMatchObject({
			_id: `bulk_return_pool:${ULID}`,
			type: 'bulk_return_pool',
			schema_v: 3,
			status: 'OPEN',
			name: 'Zone A drop-off',
			location: 'Gate 1',
			shelter_code: 'SH001',
			created_by: 'staff:wh'
		});
		for (const key of [
			'total_received_qty',
			'claimed_qty',
			'unclaimed_quota',
			'claim_ids',
			'stock_ledger_id',
			'item_id',
			'items_summary',
			'lock',
			'submitted_at',
			'return_ticket_id'
		]) {
			expect(pool).not.toHaveProperty(key);
		}
	});

	it('trims name and requires it to be non-empty; location is optional but non-empty', () => {
		expect(createBulkReturnPoolV3({ name: '  Zone B  ' }, ctx).name).toBe('Zone B');
		expect(() => createBulkReturnPoolV3({ name: '   ' }, ctx)).toThrow();
		expect(() => createBulkReturnPoolV3({} as never, ctx)).toThrow();
		expect(() => createBulkReturnPoolV3({ name: 'x', location: '  ' }, ctx)).toThrow();
		expect(createBulkReturnPoolV3({ name: 'x' }, ctx)).not.toHaveProperty('location');
	});

	it('mints a bulk_return_pool ULID id when none is given', () => {
		expect(createBulkReturnPoolV3({ name: 'x' }, ctx)._id).toMatch(
			/^bulk_return_pool:[0-9A-Z]{26}$/
		);
	});
});

describe('bulkReturnPoolV3DocSchema invariants', () => {
	it('accepts schema_v 3 only', () => {
		accepts(openPool());
		rejects({ ...openPool(), schema_v: 2 });
		rejects({ ...openPool(), schema_v: 1 });
	});

	it('accepts only OPEN | SUBMITTED | RECEIVED', () => {
		accepts(submittedPool({ status: 'RECEIVED' }));
		rejects({ ...openPool(), status: 'CANCELLED' });
		rejects({ ...openPool(), status: 'ACTIVE' });
	});

	it('OPEN: accepts an absent/null/valid lock; rejects summary and submit audit', () => {
		accepts({ ...openPool(), lock: null });
		accepts({ ...openPool(), lock });
		accepts({ ...openPool(), lock: { ...lock, op: 'DELETE' } });
		rejects({ ...openPool(), lock: { ...lock, op: 'CANCEL' } });
		rejects({ ...openPool(), lock: { ...lock, op_id: 'nope' } });
		rejects({ ...openPool(), items_summary: [] });
		rejects({ ...openPool(), submitted_at: TS });
		rejects({ ...openPool(), submitted_by: 'staff:wh' });
	});

	it('SUBMITTED/RECEIVED: requires items_summary, submitted_at and submitted_by', () => {
		accepts(submittedPool());
		accepts(submittedPool({ status: 'RECEIVED' }));
		for (const status of ['SUBMITTED', 'RECEIVED']) {
			rejects(submittedPool({ status, items_summary: undefined }));
			rejects(submittedPool({ status, submitted_at: undefined }));
			rejects(submittedPool({ status, submitted_by: undefined }));
		}
	});

	it('SUBMITTED/RECEIVED: lock must be null or absent', () => {
		accepts(submittedPool({ lock: null }));
		rejects(submittedPool({ lock }));
		rejects(submittedPool({ status: 'RECEIVED', lock }));
	});

	it('items_summary: empty array allowed, item_id unique, qty positive whole', () => {
		// TODO(#658 Q3): whether an empty pool may be submitted is undecided.
		accepts(submittedPool({ items_summary: [] }));
		accepts(
			submittedPool({
				items_summary: [
					{ item_id: 'item_master:a', qty: '1' },
					{ item_id: 'item_master:b', qty: '2' }
				]
			})
		);
		rejects(
			submittedPool({
				items_summary: [
					{ item_id: 'item_master:a', qty: '1' },
					{ item_id: 'item_master:a', qty: '2' }
				]
			})
		);
		for (const qty of ['0', '-1', '1.5', 'abc', '', 2]) {
			rejects(submittedPool({ items_summary: [{ item_id: 'item_master:a', qty }] }));
		}
		rejects(submittedPool({ items_summary: [{ item_id: '', qty: '1' }] }));
	});

	it('return_ticket_id is an optional non-empty string with no prefix or state rule', () => {
		accepts({ ...openPool(), return_ticket_id: 'anything' });
		accepts(submittedPool({ return_ticket_id: 'requisition_ticket:whatever' }));
		accepts(submittedPool());
		rejects({ ...openPool(), return_ticket_id: '' });
	});

	it('requires a bulk_return_pool ULID id', () => {
		rejects({ ...openPool(), _id: 'bulk_return_pool:short' });
		rejects({ ...openPool(), _id: `bulk_return_claim:${ULID}` });
	});
});

describe('canAppendToPool', () => {
	it('is true only for an OPEN, unlocked pool', () => {
		expect(canAppendToPool(openPool())).toBe(true);
		expect(canAppendToPool({ ...openPool(), lock: null })).toBe(true);
		expect(canAppendToPool({ ...openPool(), lock })).toBe(false);
		expect(canAppendToPool(submittedPool())).toBe(false);
		expect(canAppendToPool(submittedPool({ status: 'RECEIVED' }))).toBe(false);
	});
});

describe('assertPoolTransition', () => {
	it('allows OPEN -> SUBMITTED with summary, submit audit and cleared lock', () => {
		const prev = { ...openPool(), lock };
		expect(() => assertPoolTransition(prev, submittedPool({ lock: null }))).not.toThrow();
		expect(() => assertPoolTransition(openPool(), submittedPool())).not.toThrow();
	});

	it('rejects OPEN -> SUBMITTED missing summary or submit audit, or keeping the lock', () => {
		const prev = { ...openPool(), lock };
		expect(() => assertPoolTransition(prev, submittedPool({ items_summary: undefined }))).toThrow();
		expect(() => assertPoolTransition(prev, submittedPool({ submitted_at: undefined }))).toThrow();
		expect(() => assertPoolTransition(prev, submittedPool({ submitted_by: undefined }))).toThrow();
		expect(() => assertPoolTransition(prev, submittedPool({ lock }))).toThrow();
	});

	it('allows SUBMITTED -> RECEIVED with the snapshot unchanged', () => {
		expect(() =>
			assertPoolTransition(submittedPool(), submittedPool({ status: 'RECEIVED' }))
		).not.toThrow();
	});

	it('rejects every other transition and mentions the pending decision', () => {
		const received = submittedPool({ status: 'RECEIVED' });
		const cases: [BulkReturnPoolV3, BulkReturnPoolV3][] = [
			[openPool(), received],
			[submittedPool(), openPool()],
			[received, submittedPool()],
			[received, openPool()]
		];
		for (const [prev, next] of cases) {
			expect(() => assertPoolTransition(prev, next)).toThrow(/Q3/);
		}
	});

	it('allows same-status edits while OPEN (name, location, lock)', () => {
		const prev = openPool();
		expect(() =>
			assertPoolTransition(prev, { ...prev, name: 'Renamed', location: undefined, lock })
		).not.toThrow();
	});

	it('freezes name, location, summary and submit audit once SUBMITTED', () => {
		const prev = submittedPool();
		expect(() => assertPoolTransition(prev, { ...prev, name: 'Renamed' })).toThrow(/immutable/);
		expect(() => assertPoolTransition(prev, { ...prev, location: 'Gate 2' })).toThrow(/immutable/);
		expect(() =>
			assertPoolTransition(prev, {
				...prev,
				items_summary: [{ item_id: 'item_master:cot', qty: '4' }]
			})
		).toThrow(/immutable/);
		expect(() => assertPoolTransition(prev, { ...prev, submitted_by: 'staff:other' })).toThrow(
			/immutable/
		);
		expect(() =>
			assertPoolTransition(prev, { ...prev, submitted_at: '2026-10-02T00:00:00.000Z' })
		).toThrow(/immutable/);
		// return_ticket_id / notes remain settable.
		expect(() =>
			assertPoolTransition(prev, { ...prev, return_ticket_id: 'T-1', notes: 'ok' })
		).not.toThrow();
	});

	it('rejects changes to identity fields', () => {
		const prev = openPool();
		for (const patch of [
			{ _id: `bulk_return_pool:${OP_ULID}` },
			{ shelter_code: 'SH002' },
			{ created_at: '2026-01-01T00:00:00.000Z' },
			{ created_by: 'staff:other' }
		]) {
			expect(() => assertPoolTransition(prev, { ...prev, ...patch })).toThrow(/immutable/);
		}
	});
});
