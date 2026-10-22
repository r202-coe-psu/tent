import { z } from 'zod';
import { type AuthorContext, type BaseDoc, makeDoc, now } from '$lib/db/model';
import { parseQty, qtyLte } from '$lib/utils/qty';
import { bulkReturnEntryIdSchema } from './bulk-return-entry';
import {
	bulkReturnPoolIdSchema,
	foodSuppliesBaseDocShape,
	nonNegativeWholeQtySchema,
	positiveWholeQtySchema,
	ULID_PATTERN
} from './shared';

/**
 * #658 — bulk return pool, schema_v 3.
 *
 * The pool is a small mutable header. What was dropped into it lives in append-only
 * `bulk_return_entry` / `bulk_return_entry_move` / `bulk_return_entry_void` docs (see
 * ./bulk-return-entry*.ts); the `items_summary` + `entry_ids` snapshot is written once, at submit.
 * Lifecycle is forward-only: OPEN -> SUBMITTED -> RECEIVED, or OPEN -> CANCELLED. Pools are never
 * deleted. Legacy v1/v2 pools (./bulk-return-pool.ts) are frozen and handled elsewhere.
 */

export const BULK_RETURN_POOL_V3_SCHEMA_V = 3;

export const bulkReturnPoolV3StatusSchema = z.enum(['OPEN', 'SUBMITTED', 'RECEIVED', 'CANCELLED']);
export type BulkReturnPoolV3Status = z.infer<typeof bulkReturnPoolV3StatusSchema>;

export const bulkReturnPoolLockOpSchema = z.enum(['SUBMIT', 'CANCEL']);

/**
 * Fence on the pool header. Only meaningful while OPEN; must be null/absent in every other state.
 * A SUBMIT lock precedes OPEN -> SUBMITTED, a CANCEL lock precedes OPEN -> CANCELLED.
 */
export const bulkReturnPoolLockSchema = z.object({
	op: bulkReturnPoolLockOpSchema,
	op_id: z.string().regex(new RegExp(`^${ULID_PATTERN}$`)),
	locked_at: z.string().datetime(),
	locked_by: z.string().min(1)
});
export type BulkReturnPoolLock = z.infer<typeof bulkReturnPoolLockSchema>;

export const bulkReturnPoolItemSummaryRowSchema = z.object({
	item_id: z.string().min(1),
	qty: positiveWholeQtySchema
});
export type BulkReturnPoolItemSummaryRow = z.infer<typeof bulkReturnPoolItemSummaryRowSchema>;

export const bulkReturnPoolDiscrepancyReasonSchema = z.enum([
	'damaged',
	'missing',
	'miscount',
	'other'
]);
export type BulkReturnPoolDiscrepancyReason = z.infer<typeof bulkReturnPoolDiscrepancyReasonSchema>;

/** One row of the receive record: exactly one per `items_summary` item_id. */
export const bulkReturnPoolReceivedItemSchema = z.object({
	item_id: z.string().min(1),
	expected_qty: positiveWholeQtySchema,
	received_qty: nonNegativeWholeQtySchema,
	discrepancy_reason: bulkReturnPoolDiscrepancyReasonSchema.optional(),
	discrepancy_note: z.string().trim().min(1).optional()
});
export type BulkReturnPoolReceivedItem = z.infer<typeof bulkReturnPoolReceivedItemSchema>;

const storagePointIdSchema = z.string().trim().min(1);
const storageZoneSchema = z.string().trim().min(1).max(100);

const bulkReturnPoolV3Fields = {
	name: z.string().trim().min(1).max(80),
	// Shelter common_areas.sub_storage[].id (CR-139) + the point name snapshot at write time,
	// mirroring stock_ledger.lot v5. Both present or both absent; no free-text location.
	location_storage_point_id: storagePointIdSchema.optional(),
	location_storage_zone: storageZoneSchema.optional(),
	status: bulkReturnPoolV3StatusSchema,
	lock: bulkReturnPoolLockSchema.nullable().optional(),
	// Submit snapshot: written once at OPEN -> SUBMITTED, required in SUBMITTED/RECEIVED, absent in
	// OPEN/CANCELLED, immutable once written.
	items_summary: z.array(bulkReturnPoolItemSummaryRowSchema).optional(),
	entry_ids: z.array(bulkReturnEntryIdSchema).optional(),
	submitted_at: z.string().datetime().optional(),
	submitted_by: z.string().min(1).optional(),
	// Cancel audit: OPEN -> CANCELLED only.
	cancelled_at: z.string().datetime().optional(),
	cancelled_by: z.string().min(1).optional(),
	// Receive record: SUBMITTED -> RECEIVED only, immutable once written.
	received_at: z.string().datetime().optional(),
	received_by: z.string().min(1).optional(),
	received_storage_point_id: storagePointIdSchema.optional(),
	received_storage_zone: storageZoneSchema.optional(),
	received_items: z.array(bulkReturnPoolReceivedItemSchema).optional(),
	notes: z.string().trim().min(1).optional()
};

type PoolV3Fields = z.infer<z.ZodObject<typeof bulkReturnPoolV3Fields>>;

type IssueFn = (path: string, message: string) => void;

/** Point id and zone snapshot are both-or-neither (a zone without an id would be free text). */
function checkStoragePair(
	pointId: string | undefined,
	zone: string | undefined,
	pointPath: string,
	zonePath: string,
	issue: IssueFn
): void {
	if (pointId !== undefined && zone === undefined) {
		issue(zonePath, `${pointPath} requires ${zonePath} (the point name at write time)`);
	}
	if (zone !== undefined && pointId === undefined) {
		issue(pointPath, `${zonePath} requires ${pointPath}; free-text storage is not allowed`);
	}
}

function checkReceivedItems(pool: PoolV3Fields, issue: IssueFn): void {
	const received = pool.received_items;
	const summary = pool.items_summary;
	if (!received || !summary) return;

	const expectedByItem = new Map(summary.map((row) => [row.item_id, row.qty]));
	const seen = new Set<string>();
	for (const row of received) {
		if (seen.has(row.item_id)) {
			issue('received_items', `received_items must not contain duplicate item_id ${row.item_id}`);
			return;
		}
		seen.add(row.item_id);
		const expected = expectedByItem.get(row.item_id);
		if (expected === undefined) {
			issue('received_items', `received_items has item_id ${row.item_id} not in items_summary`);
			return;
		}
		if (!parseQty(row.expected_qty).eq(expected)) {
			issue('received_items', `expected_qty of ${row.item_id} must equal its items_summary qty`);
		}
		if (!qtyLte(row.received_qty, row.expected_qty)) {
			issue('received_items', `received_qty of ${row.item_id} must not exceed expected_qty`);
		}
		if (parseQty(row.received_qty).eq(row.expected_qty)) {
			if (row.discrepancy_reason !== undefined || row.discrepancy_note !== undefined) {
				issue('received_items', `${row.item_id} received in full must not carry a discrepancy`);
			}
		} else {
			if (row.discrepancy_reason === undefined) {
				issue('received_items', `${row.item_id} received short requires discrepancy_reason`);
			} else if (row.discrepancy_reason === 'other' && row.discrepancy_note === undefined) {
				issue(
					'received_items',
					`${row.item_id} discrepancy_reason 'other' requires discrepancy_note`
				);
			}
		}
	}
	if (seen.size !== expectedByItem.size) {
		issue('received_items', 'received_items must have exactly one row per items_summary item');
	}
}

const SUBMIT_FIELDS = ['items_summary', 'entry_ids', 'submitted_at', 'submitted_by'] as const;
const CANCEL_FIELDS = ['cancelled_at', 'cancelled_by'] as const;
const RECEIVE_ONLY_FIELDS = ['received_at', 'received_by', 'received_items'] as const;
const RECEIVE_FIELDS = [
	...RECEIVE_ONLY_FIELDS,
	'received_storage_point_id',
	'received_storage_zone'
] as const;

function validateBulkReturnPoolV3(pool: PoolV3Fields, ctx: z.RefinementCtx): void {
	const issue: IssueFn = (path, message) => ctx.addIssue({ code: 'custom', path: [path], message });
	const forbid = (fields: readonly (keyof PoolV3Fields)[]) => {
		for (const field of fields) {
			if (pool[field] !== undefined) issue(field, `${pool.status} pool must not have ${field}`);
		}
	};
	const need = (fields: readonly (keyof PoolV3Fields)[]) => {
		for (const field of fields) {
			if (pool[field] === undefined) issue(field, `${pool.status} pool requires ${field}`);
		}
	};

	checkStoragePair(
		pool.location_storage_point_id,
		pool.location_storage_zone,
		'location_storage_point_id',
		'location_storage_zone',
		issue
	);
	checkStoragePair(
		pool.received_storage_point_id,
		pool.received_storage_zone,
		'received_storage_point_id',
		'received_storage_zone',
		issue
	);

	if (pool.items_summary) {
		const seen = new Set<string>();
		for (const row of pool.items_summary) {
			if (seen.has(row.item_id)) {
				issue('items_summary', `items_summary must not contain duplicate item_id ${row.item_id}`);
				break;
			}
			seen.add(row.item_id);
		}
	}
	if (pool.entry_ids && new Set(pool.entry_ids).size !== pool.entry_ids.length) {
		issue('entry_ids', 'entry_ids must not contain duplicates');
	}

	switch (pool.status) {
		case 'OPEN':
			forbid([...SUBMIT_FIELDS, ...CANCEL_FIELDS, ...RECEIVE_FIELDS]);
			return;
		case 'CANCELLED':
			need(CANCEL_FIELDS);
			forbid([...SUBMIT_FIELDS, ...RECEIVE_FIELDS]);
			break;
		case 'SUBMITTED':
			need(SUBMIT_FIELDS);
			forbid([...CANCEL_FIELDS, ...RECEIVE_FIELDS]);
			break;
		case 'RECEIVED':
			need([...SUBMIT_FIELDS, ...RECEIVE_ONLY_FIELDS]);
			forbid(CANCEL_FIELDS);
			break;
	}

	if (pool.status === 'SUBMITTED' || pool.status === 'RECEIVED') {
		// A pool with nothing in it cannot be submitted.
		if (pool.items_summary?.length === 0) issue('items_summary', 'items_summary must not be empty');
		if (pool.entry_ids?.length === 0) issue('entry_ids', 'entry_ids must not be empty');
	}
	if (pool.status === 'RECEIVED') checkReceivedItems(pool, issue);

	if (pool.lock != null) {
		issue('lock', 'lock is only allowed while the pool is OPEN');
	}
}

export const bulkReturnPoolV3DocSchema = z
	.object({
		_id: bulkReturnPoolIdSchema,
		type: z.literal('bulk_return_pool'),
		...foodSuppliesBaseDocShape,
		schema_v: z.literal(BULK_RETURN_POOL_V3_SCHEMA_V),
		...bulkReturnPoolV3Fields
	})
	.superRefine(validateBulkReturnPoolV3);
export type BulkReturnPoolV3 = BaseDoc & z.infer<typeof bulkReturnPoolV3DocSchema>;

export const bulkReturnPoolV3InputSchema = z
	.object({
		name: bulkReturnPoolV3Fields.name,
		location_storage_point_id: bulkReturnPoolV3Fields.location_storage_point_id,
		location_storage_zone: bulkReturnPoolV3Fields.location_storage_zone,
		notes: bulkReturnPoolV3Fields.notes
	})
	.superRefine((input, ctx) =>
		checkStoragePair(
			input.location_storage_point_id,
			input.location_storage_zone,
			'location_storage_point_id',
			'location_storage_zone',
			(path, message) => ctx.addIssue({ code: 'custom', path: [path], message })
		)
	);
export type BulkReturnPoolV3Input = z.input<typeof bulkReturnPoolV3InputSchema>;

/** Creates an OPEN pool: no lock, no snapshot, no audit fields, no quantities. */
export function createBulkReturnPoolV3(
	input: BulkReturnPoolV3Input,
	ctx: AuthorContext,
	id?: string
): BulkReturnPoolV3 {
	const parsed = bulkReturnPoolV3InputSchema.parse(input);
	return bulkReturnPoolV3DocSchema.parse(
		makeDoc(
			'bulk_return_pool',
			BULK_RETURN_POOL_V3_SCHEMA_V,
			{ ...parsed, status: 'OPEN' as const },
			ctx,
			id
		)
	) as BulkReturnPoolV3;
}

/**
 * Advisory fence predicate for adding an entry to / moving an entry into / voiding an entry of a
 * pool. Authoritative enforcement cannot live in validate_doc_update (it cannot see other docs).
 * Entries or moves that still land after the fence are detected by the fold (`findLateEntries`).
 */
export function canAppendToPool(pool: Pick<BulkReturnPoolV3, 'status' | 'lock'>): boolean {
	return pool.status === 'OPEN' && !pool.lock;
}

/** NFC, trim, collapse inner whitespace to a single space, lower-case. */
export function normalizePoolName(name: string): string {
	return name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Advisory only (no DB enforcement): true when another OPEN pool already uses the same normalized
 * name. `excludePoolId` skips the pool being edited.
 */
export function isPoolNameTakenAmongOpen(
	name: string,
	pools: readonly Pick<BulkReturnPoolV3, '_id' | 'name' | 'status'>[],
	excludePoolId?: string
): boolean {
	const target = normalizePoolName(name);
	return pools.some(
		(pool) =>
			pool.status === 'OPEN' &&
			pool._id !== excludePoolId &&
			normalizePoolName(pool.name) === target
	);
}

const IMMUTABLE_POOL_FIELDS = [
	'_id',
	'type',
	'schema_v',
	'shelter_code',
	'created_at',
	'created_by'
] as const;

// Written at or after the freeze (SUBMITTED / RECEIVED / CANCELLED): never rewritten once the pool
// has left OPEN.
const FROZEN_FROM_SUBMIT_FIELDS = [
	'name',
	'location_storage_point_id',
	'location_storage_zone',
	'items_summary',
	'entry_ids',
	'submitted_at',
	'submitted_by',
	'cancelled_at',
	'cancelled_by'
] as const;

// Frozen on the transition write itself (OPEN -> SUBMITTED / CANCELLED) and in every later write.
const FROZEN_ON_LEAVING_OPEN_FIELDS = [
	'name',
	'location_storage_point_id',
	'location_storage_zone'
] as const;

function sameJson(a: unknown, b: unknown): boolean {
	return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Validates an update of a v3 pool header. Allowed status transitions (forward-only):
 * OPEN -> SUBMITTED, SUBMITTED -> RECEIVED, OPEN -> CANCELLED. Same-status updates: OPEN may edit
 * name/location/notes/lock; once the pool has left OPEN everything written at or after the freeze
 * is immutable (only `notes` stays settable). Role / actor checks live in validate_doc_update.
 */
export function assertPoolTransition(prev: BulkReturnPoolV3, next: BulkReturnPoolV3): void {
	for (const field of IMMUTABLE_POOL_FIELDS) {
		if (prev[field] !== next[field]) {
			throw new Error(`bulk_return_pool.${field} is immutable`);
		}
	}
	if (prev.status !== next.status) {
		const allowed =
			(prev.status === 'OPEN' && next.status === 'SUBMITTED') ||
			(prev.status === 'SUBMITTED' && next.status === 'RECEIVED') ||
			(prev.status === 'OPEN' && next.status === 'CANCELLED');
		if (!allowed) {
			throw new Error(`Invalid bulk_return_pool transition ${prev.status} -> ${next.status}`);
		}
	}
	bulkReturnPoolV3DocSchema.parse(next);

	if (prev.status !== next.status) {
		// name / location are frozen from the moment the pool leaves OPEN, including the transition write.
		for (const field of FROZEN_ON_LEAVING_OPEN_FIELDS) {
			if (!sameJson(prev[field], next[field])) {
				throw new Error(`bulk_return_pool.${field} is immutable once the pool has left OPEN`);
			}
		}
	}
	if (prev.status !== 'OPEN') {
		for (const field of FROZEN_FROM_SUBMIT_FIELDS) {
			if (!sameJson(prev[field], next[field])) {
				throw new Error(`bulk_return_pool.${field} is immutable once the pool has left OPEN`);
			}
		}
	}
	if (prev.status === 'RECEIVED') {
		for (const field of RECEIVE_FIELDS) {
			if (!sameJson(prev[field], next[field])) {
				throw new Error(`bulk_return_pool.${field} is immutable once RECEIVED`);
			}
		}
	}
}

export interface SubmitBulkReturnPoolV3Input {
	items_summary: BulkReturnPoolItemSummaryRow[];
	entry_ids: string[];
}

/**
 * Pure OPEN -> SUBMITTED transform: writes the snapshot + submit audit and clears the lock. The
 * snapshot must be non-empty. A CANCEL lock blocks submit.
 */
export function submitBulkReturnPoolV3(
	pool: BulkReturnPoolV3,
	input: SubmitBulkReturnPoolV3Input,
	ctx: AuthorContext,
	at: string = now()
): BulkReturnPoolV3 {
	if (pool.status !== 'OPEN') throw new Error(`Cannot submit a ${pool.status} bulk_return_pool`);
	if (pool.lock && pool.lock.op !== 'SUBMIT') {
		throw new Error('Cannot submit a bulk_return_pool locked for CANCEL');
	}
	const next = bulkReturnPoolV3DocSchema.parse({
		...pool,
		status: 'SUBMITTED',
		lock: null,
		items_summary: input.items_summary,
		entry_ids: input.entry_ids,
		submitted_at: at,
		submitted_by: ctx.createdBy,
		updated_at: at
	}) as BulkReturnPoolV3;
	assertPoolTransition(pool, next);
	return next;
}

/**
 * Pure OPEN -> CANCELLED transform: clears the lock and writes the cancel audit. Whether the pool is
 * really empty is advisory (`isPoolEmpty` fold + the CANCEL lock): validate_doc_update cannot count
 * entry docs.
 */
export function cancelBulkReturnPoolV3(
	pool: BulkReturnPoolV3,
	ctx: AuthorContext,
	at: string = now()
): BulkReturnPoolV3 {
	if (pool.status !== 'OPEN') throw new Error(`Cannot cancel a ${pool.status} bulk_return_pool`);
	if (pool.lock && pool.lock.op !== 'CANCEL') {
		throw new Error('Cannot cancel a bulk_return_pool locked for SUBMIT');
	}
	const next = bulkReturnPoolV3DocSchema.parse({
		...pool,
		status: 'CANCELLED',
		lock: null,
		cancelled_at: at,
		cancelled_by: ctx.createdBy,
		updated_at: at
	}) as BulkReturnPoolV3;
	assertPoolTransition(pool, next);
	return next;
}

/** One counted row typed in at receive: the expected qty is taken from the pool snapshot. */
export interface BulkReturnReceivedRowInput {
	item_id: string;
	received_qty: string;
	discrepancy_reason?: BulkReturnPoolDiscrepancyReason;
	discrepancy_note?: string;
}

/** The receive rows do not match the pool snapshot / discrepancy rules. */
export class BulkReturnReceiveInputError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BulkReturnReceiveInputError';
	}
}

/**
 * Pure validation + normalization of the receive rows against the submit snapshot. Returns one
 * `received_items` row per `items_summary` item (in snapshot order, `expected_qty` filled in).
 * Rules: exactly one row per item (no missing / extra / duplicate); `received_qty` a whole number
 * 0..expected; received == expected carries no reason/note; received < expected needs a reason, and
 * `other` also needs a non-empty note. Notes are trimmed; a blank note counts as absent.
 * Throws {@link BulkReturnReceiveInputError}.
 */
export function buildBulkReturnReceivedItems(
	itemsSummary: readonly BulkReturnPoolItemSummaryRow[],
	rows: readonly BulkReturnReceivedRowInput[]
): BulkReturnPoolReceivedItem[] {
	const fail = (message: string): never => {
		throw new BulkReturnReceiveInputError(message);
	};
	const expectedByItem = new Map(itemsSummary.map((row) => [row.item_id, row.qty]));
	const rowByItem = new Map<string, BulkReturnReceivedRowInput>();
	for (const row of rows) {
		if (!expectedByItem.has(row.item_id)) {
			fail(`Item ${row.item_id} is not in the pool`);
		}
		if (rowByItem.has(row.item_id)) fail(`Item ${row.item_id} appears more than once`);
		rowByItem.set(row.item_id, row);
	}

	return itemsSummary.map(({ item_id, qty: expected }) => {
		const row = rowByItem.get(item_id);
		if (!row) return fail(`Item ${item_id} is missing: every pool item needs a received row`);

		const parsedQty = nonNegativeWholeQtySchema.safeParse(row.received_qty);
		if (!parsedQty.success) {
			return fail(`Received qty of ${item_id} must be a whole number of 0 or more`);
		}
		const received = parsedQty.data;
		if (!qtyLte(received, expected)) {
			return fail(
				`Received qty of ${item_id} (${received}) must not exceed expected (${expected})`
			);
		}

		const reason = row.discrepancy_reason;
		const note = row.discrepancy_note?.trim() || undefined;
		const base = { item_id, expected_qty: expected, received_qty: received };

		if (parseQty(received).eq(expected)) {
			if (reason !== undefined || note !== undefined) {
				return fail(`Item ${item_id} was received in full and must not carry a discrepancy`);
			}
			return base;
		}
		if (reason === undefined) {
			return fail(`Item ${item_id} was received short: a discrepancy reason is required`);
		}
		if (!bulkReturnPoolDiscrepancyReasonSchema.safeParse(reason).success) {
			return fail(`Item ${item_id} has an unknown discrepancy reason`);
		}
		if (reason === 'other' && note === undefined) {
			return fail(`Item ${item_id}: reason 'other' requires a note`);
		}
		return {
			...base,
			discrepancy_reason: reason,
			...(note !== undefined ? { discrepancy_note: note } : {})
		};
	});
}

export interface ReceiveBulkReturnPoolV3Input {
	received_items: z.input<typeof bulkReturnPoolReceivedItemSchema>[];
	received_storage_point_id?: string;
	received_storage_zone?: string;
}

/** Pure SUBMITTED -> RECEIVED transform: writes the receive record (validated against the snapshot). */
export function receiveBulkReturnPoolV3(
	pool: BulkReturnPoolV3,
	input: ReceiveBulkReturnPoolV3Input,
	ctx: AuthorContext,
	at: string = now()
): BulkReturnPoolV3 {
	if (pool.status !== 'SUBMITTED')
		throw new Error(`Cannot receive a ${pool.status} bulk_return_pool`);
	const next = bulkReturnPoolV3DocSchema.parse({
		...pool,
		status: 'RECEIVED',
		received_at: at,
		received_by: ctx.createdBy,
		received_items: input.received_items,
		received_storage_point_id: input.received_storage_point_id,
		received_storage_zone: input.received_storage_zone,
		updated_at: at
	}) as BulkReturnPoolV3;
	assertPoolTransition(pool, next);
	return next;
}
