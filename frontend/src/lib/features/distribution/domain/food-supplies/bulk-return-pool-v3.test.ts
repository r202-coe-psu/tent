import { describe, expect, it } from 'vitest';
import type { AuthorContext } from '$lib/db/model';
import {
	assertPoolTransition,
	BulkReturnReceiveInputError,
	buildBulkReturnReceivedItems,
	bulkReturnPoolV3DocSchema,
	canAppendToPool,
	cancelBulkReturnPoolV3,
	createBulkReturnPoolV3,
	isPoolNameTakenAmongOpen,
	normalizePoolName,
	receiveBulkReturnPoolV3,
	submitBulkReturnPoolV3,
	type BulkReturnPoolV3
} from './bulk-return-pool-v3';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'staff:wh' };
const ULID = '01J00000000000000000000000';
const OP_ULID = '01J00000000000000000000009';
const ENTRY_1 = 'bulk_return_entry:01J00000000000000000000001';
const ENTRY_2 = 'bulk_return_entry:01J00000000000000000000002';
const TS = '2026-10-01T00:00:00.000Z';
const TS2 = '2026-10-02T00:00:00.000Z';

const lock = { op: 'SUBMIT', op_id: OP_ULID, locked_at: TS, locked_by: 'staff:wh' } as const;
const cancelLock = { ...lock, op: 'CANCEL' } as const;

// Created once so every derived fixture shares identical created_at/updated_at.
const basePool = createBulkReturnPoolV3(
	{ name: 'Zone A drop-off', location_storage_point_id: 'sp-1', location_storage_zone: 'Gate 1' },
	ctx,
	ULID
);
const openPool = (): BulkReturnPoolV3 => ({ ...basePool });

const submittedPool = (over: Record<string, unknown> = {}): BulkReturnPoolV3 =>
	({
		...openPool(),
		status: 'SUBMITTED',
		items_summary: [{ item_id: 'item_master:cot', qty: '3' }],
		entry_ids: [ENTRY_1],
		submitted_at: TS,
		submitted_by: 'staff:wh',
		...over
	}) as BulkReturnPoolV3;

const receivedItem = { item_id: 'item_master:cot', expected_qty: '3', received_qty: '3' };

const receivedPool = (over: Record<string, unknown> = {}): BulkReturnPoolV3 =>
	submittedPool({
		status: 'RECEIVED',
		received_at: TS2,
		received_by: 'staff:wh',
		received_items: [receivedItem],
		...over
	});

const cancelledPool = (over: Record<string, unknown> = {}): BulkReturnPoolV3 =>
	({
		...openPool(),
		status: 'CANCELLED',
		cancelled_at: TS,
		cancelled_by: 'staff:wh',
		...over
	}) as BulkReturnPoolV3;

const accepts = (doc: unknown) =>
	expect(bulkReturnPoolV3DocSchema.safeParse(doc).success).toBe(true);
const rejects = (doc: unknown) =>
	expect(bulkReturnPoolV3DocSchema.safeParse(doc).success).toBe(false);

describe('createBulkReturnPoolV3', () => {
	it('creates an OPEN schema_v 3 pool without quantities, lock, snapshot or audit fields', () => {
		const pool = openPool();
		expect(pool).toMatchObject({
			_id: `bulk_return_pool:${ULID}`,
			type: 'bulk_return_pool',
			schema_v: 3,
			status: 'OPEN',
			name: 'Zone A drop-off',
			location_storage_point_id: 'sp-1',
			location_storage_zone: 'Gate 1',
			shelter_code: 'SH001',
			created_by: 'staff:wh'
		});
		for (const key of [
			'total_received_qty',
			'claimed_qty',
			'items_summary',
			'entry_ids',
			'lock',
			'submitted_at',
			'cancelled_at',
			'received_at',
			'return_ticket_id',
			'location'
		]) {
			expect(pool).not.toHaveProperty(key);
		}
	});

	it('trims name, requires 1..80 chars; notes optional non-empty', () => {
		expect(createBulkReturnPoolV3({ name: '  Zone B  ' }, ctx).name).toBe('Zone B');
		expect(createBulkReturnPoolV3({ name: 'x'.repeat(80) }, ctx).name).toHaveLength(80);
		expect(() => createBulkReturnPoolV3({ name: 'x'.repeat(81) }, ctx)).toThrow();
		expect(() => createBulkReturnPoolV3({ name: '   ' }, ctx)).toThrow();
		expect(() => createBulkReturnPoolV3({} as never, ctx)).toThrow();
		expect(() => createBulkReturnPoolV3({ name: 'x', notes: '  ' }, ctx)).toThrow();
	});

	it('location is an optional storage point pair: both present or both absent', () => {
		const pair = { location_storage_point_id: 'sp-1', location_storage_zone: ' Gate 1 ' };
		expect(createBulkReturnPoolV3({ name: 'x', ...pair }, ctx).location_storage_zone).toBe(
			'Gate 1'
		);
		expect(createBulkReturnPoolV3({ name: 'x' }, ctx)).not.toHaveProperty('location_storage_zone');
		expect(() =>
			createBulkReturnPoolV3({ name: 'x', location_storage_point_id: 'sp-1' }, ctx)
		).toThrow();
		expect(() =>
			createBulkReturnPoolV3({ name: 'x', location_storage_zone: 'Free text' }, ctx)
		).toThrow();
		expect(() =>
			createBulkReturnPoolV3({ name: 'x', ...pair, location_storage_zone: 'z'.repeat(101) }, ctx)
		).toThrow();
		expect(() =>
			createBulkReturnPoolV3({ name: 'x', ...pair, location_storage_point_id: '' }, ctx)
		).toThrow();
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

	it('accepts only OPEN | SUBMITTED | RECEIVED | CANCELLED', () => {
		accepts(submittedPool());
		accepts(receivedPool());
		accepts(cancelledPool());
		rejects({ ...openPool(), status: 'ACTIVE' });
		rejects({ ...openPool(), status: 'DELETED' });
	});

	it('OPEN: accepts an absent/null/valid lock; rejects snapshot, submit, cancel and receive fields', () => {
		accepts({ ...openPool(), lock: null });
		accepts({ ...openPool(), lock });
		accepts({ ...openPool(), lock: cancelLock });
		rejects({ ...openPool(), lock: { ...lock, op: 'DELETE' } });
		rejects({ ...openPool(), lock: { ...lock, op_id: 'nope' } });
		rejects({ ...openPool(), items_summary: [] });
		rejects({ ...openPool(), entry_ids: [ENTRY_1] });
		rejects({ ...openPool(), submitted_at: TS });
		rejects({ ...openPool(), submitted_by: 'staff:wh' });
		rejects({ ...openPool(), cancelled_at: TS });
		rejects({ ...openPool(), received_at: TS });
		rejects({ ...openPool(), received_items: [receivedItem] });
		rejects({ ...openPool(), received_storage_point_id: 'sp-2', received_storage_zone: 'B' });
	});

	it('location pair: point id requires zone, zone requires point id, in any status', () => {
		rejects({ ...openPool(), location_storage_zone: undefined });
		rejects({ ...openPool(), location_storage_point_id: undefined });
		accepts({
			...openPool(),
			location_storage_point_id: undefined,
			location_storage_zone: undefined
		});
		rejects({ ...submittedPool(), location_storage_zone: undefined });
		rejects({ ...cancelledPool(), location_storage_point_id: undefined });
	});

	it('SUBMITTED/RECEIVED: requires items_summary, entry_ids, submitted_at and submitted_by', () => {
		accepts(submittedPool());
		accepts(receivedPool());
		for (const make of [submittedPool, receivedPool]) {
			rejects(make({ items_summary: undefined }));
			rejects(make({ entry_ids: undefined }));
			rejects(make({ submitted_at: undefined }));
			rejects(make({ submitted_by: undefined }));
		}
	});

	it('SUBMITTED/RECEIVED: empty items_summary or entry_ids is rejected', () => {
		for (const make of [submittedPool, receivedPool]) {
			rejects(make({ items_summary: [] }));
			rejects(make({ entry_ids: [] }));
		}
	});

	it('SUBMITTED/RECEIVED: lock must be null or absent', () => {
		accepts(submittedPool({ lock: null }));
		rejects(submittedPool({ lock }));
		rejects(receivedPool({ lock }));
	});

	it('items_summary: item_id unique, qty positive whole', () => {
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

	it('entry_ids: unique bulk_return_entry ULID ids', () => {
		accepts(submittedPool({ entry_ids: [ENTRY_1, ENTRY_2] }));
		rejects(submittedPool({ entry_ids: [ENTRY_1, ENTRY_1] }));
		rejects(submittedPool({ entry_ids: ['bulk_return_entry:short'] }));
		rejects(submittedPool({ entry_ids: ['bulk_return_pool:01J00000000000000000000001'] }));
	});

	it('CANCELLED: requires cancel audit; rejects snapshot, submit audit, receive fields and lock', () => {
		accepts(cancelledPool());
		accepts(cancelledPool({ lock: null }));
		rejects(cancelledPool({ cancelled_at: undefined }));
		rejects(cancelledPool({ cancelled_by: undefined }));
		rejects(cancelledPool({ lock: cancelLock }));
		rejects(cancelledPool({ items_summary: [{ item_id: 'item_master:cot', qty: '3' }] }));
		rejects(cancelledPool({ entry_ids: [ENTRY_1] }));
		rejects(cancelledPool({ submitted_at: TS }));
		rejects(cancelledPool({ submitted_by: 'staff:wh' }));
		rejects(cancelledPool({ received_at: TS }));
	});

	it('cancel audit is rejected outside CANCELLED', () => {
		rejects(submittedPool({ cancelled_at: TS, cancelled_by: 'staff:wh' }));
		rejects(receivedPool({ cancelled_by: 'staff:wh' }));
	});

	it('SUBMITTED rejects receive fields; RECEIVED requires received_at, received_by, received_items', () => {
		rejects(submittedPool({ received_at: TS2 }));
		rejects(submittedPool({ received_items: [receivedItem] }));
		rejects(receivedPool({ received_at: undefined }));
		rejects(receivedPool({ received_by: undefined }));
		rejects(receivedPool({ received_items: undefined }));
	});

	it('received storage point is an optional both-or-neither pair', () => {
		accepts(
			receivedPool({ received_storage_point_id: 'sp-2', received_storage_zone: 'Cold room' })
		);
		rejects(receivedPool({ received_storage_point_id: 'sp-2' }));
		rejects(receivedPool({ received_storage_zone: 'Cold room' }));
	});

	it('received_items: exactly one row per items_summary item, expected_qty equals the snapshot', () => {
		const two = {
			items_summary: [
				{ item_id: 'item_master:a', qty: '2' },
				{ item_id: 'item_master:b', qty: '4' }
			]
		};
		const rowA = { item_id: 'item_master:a', expected_qty: '2', received_qty: '2' };
		const rowB = { item_id: 'item_master:b', expected_qty: '4', received_qty: '4' };
		accepts(receivedPool({ ...two, received_items: [rowA, rowB] }));
		rejects(receivedPool({ ...two, received_items: [rowA] }));
		rejects(receivedPool({ ...two, received_items: [rowA, rowA] }));
		rejects(
			receivedPool({
				...two,
				received_items: [rowA, rowB, { ...rowB, item_id: 'item_master:c' }]
			})
		);
		rejects(receivedPool({ ...two, received_items: [rowA, { ...rowB, expected_qty: '5' }] }));
		rejects(receivedPool({ received_items: [{ ...receivedItem, expected_qty: '0' }] }));
	});

	it('received_items: received_qty is a whole number not above expected_qty', () => {
		const short = { ...receivedItem, received_qty: '0', discrepancy_reason: 'missing' };
		accepts(receivedPool({ received_items: [short] }));
		rejects(receivedPool({ received_items: [{ ...receivedItem, received_qty: '4' }] }));
		rejects(receivedPool({ received_items: [{ ...receivedItem, received_qty: '-1' }] }));
		rejects(receivedPool({ received_items: [{ ...receivedItem, received_qty: '1.5' }] }));
	});

	it('received_items: a full receipt carries no discrepancy', () => {
		rejects(receivedPool({ received_items: [{ ...receivedItem, discrepancy_reason: 'damaged' }] }));
		rejects(receivedPool({ received_items: [{ ...receivedItem, discrepancy_note: 'x' }] }));
	});

	it('received_items: a short receipt requires a reason; reason other also requires a note', () => {
		const short = { ...receivedItem, received_qty: '2' };
		rejects(receivedPool({ received_items: [short] }));
		for (const discrepancy_reason of ['damaged', 'missing', 'miscount']) {
			accepts(receivedPool({ received_items: [{ ...short, discrepancy_reason }] }));
			accepts(
				receivedPool({ received_items: [{ ...short, discrepancy_reason, discrepancy_note: 'n' }] })
			);
		}
		rejects(receivedPool({ received_items: [{ ...short, discrepancy_reason: 'other' }] }));
		rejects(
			receivedPool({
				received_items: [{ ...short, discrepancy_reason: 'other', discrepancy_note: '  ' }]
			})
		);
		accepts(
			receivedPool({
				received_items: [{ ...short, discrepancy_reason: 'other', discrepancy_note: 'spilled' }]
			})
		);
		rejects(receivedPool({ received_items: [{ ...short, discrepancy_reason: 'stolen' }] }));
	});

	it('does not carry return_ticket_id (unknown field is simply dropped)', () => {
		const parsed = bulkReturnPoolV3DocSchema.parse({ ...openPool(), return_ticket_id: 'T-1' });
		expect(parsed).not.toHaveProperty('return_ticket_id');
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
		expect(canAppendToPool(receivedPool())).toBe(false);
		expect(canAppendToPool(cancelledPool())).toBe(false);
	});
});

describe('normalizePoolName', () => {
	it('trims, collapses inner whitespace and lower-cases', () => {
		expect(normalizePoolName('  Zone   A \t Drop-off ')).toBe('zone a drop-off');
	});

	it('applies NFC so composed and decomposed forms match', () => {
		expect(normalizePoolName('Café')).toBe(normalizePoolName('Café'));
	});
});

describe('isPoolNameTakenAmongOpen', () => {
	const pools = [
		{ _id: 'bulk_return_pool:A', name: 'Zone A', status: 'OPEN' as const },
		{ _id: 'bulk_return_pool:B', name: 'Zone B', status: 'SUBMITTED' as const },
		{ _id: 'bulk_return_pool:C', name: 'Zone C', status: 'CANCELLED' as const }
	];

	it('is true when another OPEN pool has the same normalized name', () => {
		expect(isPoolNameTakenAmongOpen('  zone   a ', pools)).toBe(true);
	});

	it('ignores non-OPEN pools and unused names', () => {
		expect(isPoolNameTakenAmongOpen('Zone B', pools)).toBe(false);
		expect(isPoolNameTakenAmongOpen('Zone C', pools)).toBe(false);
		expect(isPoolNameTakenAmongOpen('Zone D', pools)).toBe(false);
	});

	it('skips the pool being edited', () => {
		expect(isPoolNameTakenAmongOpen('Zone A', pools, 'bulk_return_pool:A')).toBe(false);
	});
});

describe('assertPoolTransition', () => {
	it('allows OPEN -> SUBMITTED with snapshot, submit audit and cleared lock', () => {
		const prev = { ...openPool(), lock };
		expect(() => assertPoolTransition(prev, submittedPool({ lock: null }))).not.toThrow();
		expect(() => assertPoolTransition(openPool(), submittedPool())).not.toThrow();
	});

	it('rejects OPEN -> SUBMITTED missing snapshot or submit audit, or keeping the lock', () => {
		const prev = { ...openPool(), lock };
		expect(() => assertPoolTransition(prev, submittedPool({ items_summary: undefined }))).toThrow();
		expect(() => assertPoolTransition(prev, submittedPool({ entry_ids: undefined }))).toThrow();
		expect(() => assertPoolTransition(prev, submittedPool({ submitted_at: undefined }))).toThrow();
		expect(() => assertPoolTransition(prev, submittedPool({ submitted_by: undefined }))).toThrow();
		expect(() => assertPoolTransition(prev, submittedPool({ lock }))).toThrow();
	});

	it('allows SUBMITTED -> RECEIVED with the snapshot unchanged', () => {
		expect(() => assertPoolTransition(submittedPool(), receivedPool())).not.toThrow();
	});

	it('rejects SUBMITTED -> RECEIVED that rewrites the snapshot', () => {
		expect(() =>
			assertPoolTransition(
				submittedPool(),
				receivedPool({
					items_summary: [{ item_id: 'item_master:cot', qty: '4' }],
					received_items: [{ ...receivedItem, expected_qty: '4', received_qty: '4' }]
				})
			)
		).toThrow(/immutable/);
	});

	it('allows OPEN -> CANCELLED with or without a CANCEL lock', () => {
		expect(() => assertPoolTransition(openPool(), cancelledPool())).not.toThrow();
		expect(() =>
			assertPoolTransition({ ...openPool(), lock: cancelLock }, cancelledPool({ lock: null }))
		).not.toThrow();
	});

	it('rejects every other transition', () => {
		const cases: [BulkReturnPoolV3, BulkReturnPoolV3][] = [
			[openPool(), receivedPool()],
			[submittedPool(), openPool()],
			[submittedPool(), cancelledPool()],
			[receivedPool(), submittedPool()],
			[receivedPool(), openPool()],
			[receivedPool(), cancelledPool()],
			[cancelledPool(), openPool()],
			[cancelledPool(), submittedPool()],
			[cancelledPool(), receivedPool()]
		];
		for (const [prev, next] of cases) {
			expect(() => assertPoolTransition(prev, next)).toThrow(/Invalid bulk_return_pool transition/);
		}
	});

	it('allows same-status edits while OPEN (name, location, notes, lock)', () => {
		const prev = openPool();
		expect(() =>
			assertPoolTransition(prev, {
				...prev,
				name: 'Renamed',
				location_storage_point_id: undefined,
				location_storage_zone: undefined,
				notes: 'n',
				lock
			})
		).not.toThrow();
	});

	it('freezes name, location, snapshot and submit audit once SUBMITTED', () => {
		const prev = submittedPool();
		expect(() => assertPoolTransition(prev, { ...prev, name: 'Renamed' })).toThrow(/immutable/);
		expect(() => assertPoolTransition(prev, { ...prev, location_storage_zone: 'Gate 2' })).toThrow(
			/immutable/
		);
		expect(() =>
			assertPoolTransition(prev, {
				...prev,
				location_storage_point_id: undefined,
				location_storage_zone: undefined
			})
		).toThrow(/immutable/);
		expect(() =>
			assertPoolTransition(prev, {
				...prev,
				items_summary: [{ item_id: 'item_master:cot', qty: '4' }]
			})
		).toThrow(/immutable/);
		expect(() => assertPoolTransition(prev, { ...prev, entry_ids: [ENTRY_2] })).toThrow(
			/immutable/
		);
		expect(() => assertPoolTransition(prev, { ...prev, submitted_by: 'staff:other' })).toThrow(
			/immutable/
		);
		expect(() => assertPoolTransition(prev, { ...prev, submitted_at: TS2 })).toThrow(/immutable/);
		// notes remain settable.
		expect(() => assertPoolTransition(prev, { ...prev, notes: 'ok' })).not.toThrow();
	});

	it('freezes the receive record once RECEIVED', () => {
		const prev = receivedPool();
		expect(() => assertPoolTransition(prev, { ...prev })).not.toThrow();
		expect(() => assertPoolTransition(prev, { ...prev, received_by: 'staff:other' })).toThrow(
			/immutable/
		);
		expect(() => assertPoolTransition(prev, { ...prev, received_at: TS })).toThrow(/immutable/);
		expect(() =>
			assertPoolTransition(prev, {
				...prev,
				received_items: [{ ...receivedItem, received_qty: '2', discrepancy_reason: 'missing' }]
			})
		).toThrow(/immutable/);
		expect(() =>
			assertPoolTransition(prev, {
				...prev,
				received_storage_point_id: 'sp-9',
				received_storage_zone: 'Z'
			})
		).toThrow(/immutable/);
	});

	it('freezes the cancel audit and the rest of a CANCELLED pool', () => {
		const prev = cancelledPool();
		expect(() => assertPoolTransition(prev, { ...prev })).not.toThrow();
		expect(() => assertPoolTransition(prev, { ...prev, cancelled_by: 'staff:other' })).toThrow(
			/immutable/
		);
		expect(() => assertPoolTransition(prev, { ...prev, name: 'Renamed' })).toThrow(/immutable/);
		expect(() => assertPoolTransition(prev, { ...prev, location_storage_zone: 'Gate 2' })).toThrow(
			/immutable/
		);
	});

	it('rejects a name or location change on the OPEN -> SUBMITTED / CANCELLED transition write', () => {
		for (const next of [submittedPool(), cancelledPool()]) {
			for (const patch of [
				{ name: 'Renamed' },
				{ location_storage_point_id: 'sp-2' },
				{ location_storage_zone: 'Gate 2' },
				{ location_storage_point_id: undefined, location_storage_zone: undefined }
			]) {
				expect(() => assertPoolTransition(openPool(), { ...next, ...patch })).toThrow(/immutable/);
			}
		}
	});

	it('allows a notes edit on the transition write and in every later status', () => {
		expect(() =>
			assertPoolTransition(openPool(), submittedPool({ notes: 'on submit' }))
		).not.toThrow();
		expect(() =>
			assertPoolTransition(openPool(), cancelledPool({ notes: 'on cancel' }))
		).not.toThrow();
		for (const prev of [submittedPool(), receivedPool(), cancelledPool()]) {
			expect(() => assertPoolTransition(prev, { ...prev, notes: 'later' })).not.toThrow();
		}
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

describe('submitBulkReturnPoolV3', () => {
	const input = {
		items_summary: [{ item_id: 'item_master:cot', qty: '3' }],
		entry_ids: [ENTRY_1]
	};

	it('moves an OPEN pool to SUBMITTED, writes the snapshot and audit, and clears the lock', () => {
		const next = submitBulkReturnPoolV3({ ...openPool(), lock }, input, ctx, TS2);
		expect(next).toMatchObject({
			status: 'SUBMITTED',
			lock: null,
			items_summary: input.items_summary,
			entry_ids: [ENTRY_1],
			submitted_at: TS2,
			submitted_by: 'staff:wh',
			updated_at: TS2
		});
		expect(() => assertPoolTransition(openPool(), next)).not.toThrow();
	});

	it('rejects an empty snapshot', () => {
		expect(() =>
			submitBulkReturnPoolV3(openPool(), { ...input, items_summary: [] }, ctx)
		).toThrow();
		expect(() => submitBulkReturnPoolV3(openPool(), { ...input, entry_ids: [] }, ctx)).toThrow();
	});

	it('rejects a non-OPEN pool and a CANCEL lock', () => {
		expect(() => submitBulkReturnPoolV3(submittedPool(), input, ctx)).toThrow(/Cannot submit/);
		expect(() => submitBulkReturnPoolV3(cancelledPool(), input, ctx)).toThrow(/Cannot submit/);
		expect(() => submitBulkReturnPoolV3({ ...openPool(), lock: cancelLock }, input, ctx)).toThrow(
			/locked for CANCEL/
		);
	});
});

describe('cancelBulkReturnPoolV3', () => {
	it('moves an OPEN pool to CANCELLED, writes the cancel audit, and clears the lock', () => {
		const next = cancelBulkReturnPoolV3({ ...openPool(), lock: cancelLock }, ctx, TS2);
		expect(next).toMatchObject({
			status: 'CANCELLED',
			lock: null,
			cancelled_at: TS2,
			cancelled_by: 'staff:wh'
		});
		expect(next).not.toHaveProperty('items_summary');
		expect(() => assertPoolTransition(openPool(), next)).not.toThrow();
	});

	it('works on an unlocked pool', () => {
		expect(cancelBulkReturnPoolV3(openPool(), ctx).status).toBe('CANCELLED');
	});

	it('rejects a non-OPEN pool and a SUBMIT lock', () => {
		expect(() => cancelBulkReturnPoolV3(submittedPool(), ctx)).toThrow(/Cannot cancel/);
		expect(() => cancelBulkReturnPoolV3(cancelledPool(), ctx)).toThrow(/Cannot cancel/);
		expect(() => cancelBulkReturnPoolV3({ ...openPool(), lock }, ctx)).toThrow(/locked for SUBMIT/);
	});
});

describe('receiveBulkReturnPoolV3', () => {
	it('moves a SUBMITTED pool to RECEIVED and writes the receive record', () => {
		const next = receiveBulkReturnPoolV3(
			submittedPool(),
			{
				received_items: [receivedItem],
				received_storage_point_id: 'sp-2',
				received_storage_zone: 'Cold room'
			},
			ctx,
			TS2
		);
		expect(next).toMatchObject({
			status: 'RECEIVED',
			received_at: TS2,
			received_by: 'staff:wh',
			received_storage_point_id: 'sp-2',
			received_storage_zone: 'Cold room',
			items_summary: [{ item_id: 'item_master:cot', qty: '3' }]
		});
	});

	it('works without a storage point', () => {
		const next = receiveBulkReturnPoolV3(submittedPool(), { received_items: [receivedItem] }, ctx);
		expect(next.status).toBe('RECEIVED');
	});

	it('rejects an invalid receive record', () => {
		expect(() =>
			receiveBulkReturnPoolV3(
				submittedPool(),
				{ received_items: [{ ...receivedItem, received_qty: '1' }] },
				ctx
			)
		).toThrow();
		expect(() => receiveBulkReturnPoolV3(submittedPool(), { received_items: [] }, ctx)).toThrow();
	});

	it('rejects a pool that is not SUBMITTED', () => {
		for (const pool of [openPool(), receivedPool(), cancelledPool()]) {
			expect(() => receiveBulkReturnPoolV3(pool, { received_items: [receivedItem] }, ctx)).toThrow(
				/Cannot receive/
			);
		}
	});
});

describe('buildBulkReturnReceivedItems', () => {
	const summary = [
		{ item_id: 'item:a', qty: '3' },
		{ item_id: 'item:b', qty: '5' }
	];
	const full = [
		{ item_id: 'item:b', received_qty: '5' },
		{ item_id: 'item:a', received_qty: '3' }
	];

	it('returns one row per summary item in summary order with expected_qty filled', () => {
		expect(buildBulkReturnReceivedItems(summary, full)).toEqual([
			{ item_id: 'item:a', expected_qty: '3', received_qty: '3' },
			{ item_id: 'item:b', expected_qty: '5', received_qty: '5' }
		]);
	});

	it('records a reason and a trimmed note on a short row and accepts 0', () => {
		const rows = buildBulkReturnReceivedItems(summary, [
			{
				item_id: 'item:a',
				received_qty: '2',
				discrepancy_reason: 'damaged',
				discrepancy_note: '  broken leg '
			},
			{
				item_id: 'item:b',
				received_qty: '0',
				discrepancy_reason: 'missing',
				discrepancy_note: '  '
			}
		]);
		expect(rows[0]).toMatchObject({
			discrepancy_reason: 'damaged',
			discrepancy_note: 'broken leg'
		});
		expect(rows[1].received_qty).toBe('0');
		expect(rows[1].discrepancy_reason).toBe('missing');
		expect(rows[1].discrepancy_note).toBeUndefined();
	});

	it('requires a reason when short and a note for other', () => {
		const short = (extra: object) => [
			{ item_id: 'item:a', received_qty: '2', ...extra },
			{ item_id: 'item:b', received_qty: '5' }
		];
		expect(() => buildBulkReturnReceivedItems(summary, short({}))).toThrow(
			BulkReturnReceiveInputError
		);
		expect(() =>
			buildBulkReturnReceivedItems(summary, short({ discrepancy_reason: 'other' }))
		).toThrow(/requires a note/);
		expect(() =>
			buildBulkReturnReceivedItems(
				summary,
				short({ discrepancy_reason: 'other', discrepancy_note: '   ' })
			)
		).toThrow(/requires a note/);
		expect(
			buildBulkReturnReceivedItems(
				summary,
				short({ discrepancy_reason: 'other', discrepancy_note: 'lost in transit' })
			)[0].discrepancy_note
		).toBe('lost in transit');
	});

	it('rejects a reason or note on a full match', () => {
		const withExtra = (extra: object) => [
			{ item_id: 'item:a', received_qty: '3', ...extra },
			{ item_id: 'item:b', received_qty: '5' }
		];
		expect(() =>
			buildBulkReturnReceivedItems(summary, withExtra({ discrepancy_reason: 'miscount' }))
		).toThrow(/in full/);
		expect(() =>
			buildBulkReturnReceivedItems(summary, withExtra({ discrepancy_note: 'x' }))
		).toThrow(/in full/);
		// A blank note is treated as absent.
		expect(() =>
			buildBulkReturnReceivedItems(summary, withExtra({ discrepancy_note: '  ' }))
		).not.toThrow();
	});

	it('rejects received above expected and non whole numbers', () => {
		for (const bad of ['4', '1.5', '-1', '', 'abc', '1e1']) {
			expect(() =>
				buildBulkReturnReceivedItems(summary, [
					{ item_id: 'item:a', received_qty: bad },
					{ item_id: 'item:b', received_qty: '5' }
				])
			).toThrow(BulkReturnReceiveInputError);
		}
	});

	it('rejects missing, extra and duplicate rows', () => {
		expect(() => buildBulkReturnReceivedItems(summary, [full[1]])).toThrow(/missing/);
		expect(() =>
			buildBulkReturnReceivedItems(summary, [...full, { item_id: 'item:z', received_qty: '1' }])
		).toThrow(/not in the pool/);
		expect(() => buildBulkReturnReceivedItems(summary, [...full, full[0]])).toThrow(
			/more than once/
		);
	});
});
