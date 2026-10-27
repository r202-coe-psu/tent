import { describe, expect, it } from 'vitest';
import type { AuthorContext } from '$lib/db/model';
import { createBulkReturnEntry } from './bulk-return-entry';
import {
	bulkReturnEntryVoidDocSchema,
	canVoidEntry,
	createBulkReturnEntryVoid,
	deriveEntryVoidId
} from './bulk-return-entry-void';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'staff:dst' };
const OP = '01J00000000000000000000001';
const P1 = 'bulk_return_pool:01J00000000000000000000011';
const lock = {
	op: 'SUBMIT',
	op_id: '01J00000000000000000000009',
	locked_at: '2026-10-01T00:00:00.000Z',
	locked_by: 'staff:wh'
} as const;

const entry = createBulkReturnEntry(
	{ pool_id: P1, item_id: 'item_master:cot', qty: '5', returner_type: 'unspecified' },
	ctx,
	OP
);

describe('deriveEntryVoidId', () => {
	it('is deterministic from the entry ULID', () => {
		expect(deriveEntryVoidId(entry._id)).toBe(`bulk_return_entry_void:${OP}`);
		expect(deriveEntryVoidId(entry._id)).toBe(deriveEntryVoidId(entry._id));
	});

	it('rejects a malformed entry id', () => {
		expect(() => deriveEntryVoidId('bulk_return_entry:x')).toThrow();
		expect(() => deriveEntryVoidId(`bulk_return_pool:${OP}`)).toThrow();
	});
});

describe('createBulkReturnEntryVoid', () => {
	it('copies item_id/qty from the entry and derives a deterministic id', () => {
		const v = createBulkReturnEntryVoid({ entry, pool_id: P1 }, ctx);
		expect(v).toMatchObject({
			_id: `bulk_return_entry_void:${OP}`,
			type: 'bulk_return_entry_void',
			schema_v: 1,
			entry_id: entry._id,
			pool_id: P1,
			item_id: 'item_master:cot',
			qty: '5',
			created_by: 'staff:dst'
		});
		expect(v).not.toHaveProperty('notes');
	});

	it('keeps trimmed notes and rejects blank notes', () => {
		expect(createBulkReturnEntryVoid({ entry, pool_id: P1, notes: ' typo ' }, ctx).notes).toBe(
			'typo'
		);
		expect(() => createBulkReturnEntryVoid({ entry, pool_id: P1, notes: '  ' }, ctx)).toThrow();
	});

	it('rejects a malformed pool id', () => {
		expect(() =>
			createBulkReturnEntryVoid({ entry, pool_id: 'bulk_return_pool:x' }, ctx)
		).toThrow();
	});
});

describe('bulkReturnEntryVoidDocSchema', () => {
	const v = createBulkReturnEntryVoid({ entry, pool_id: P1 }, ctx);

	it('accepts a created void', () => {
		expect(bulkReturnEntryVoidDocSchema.safeParse(v).success).toBe(true);
	});

	it('requires entry_id to match the entry ULID in _id', () => {
		expect(
			bulkReturnEntryVoidDocSchema.safeParse({
				...v,
				entry_id: 'bulk_return_entry:01J00000000000000000000099'
			}).success
		).toBe(false);
	});

	it('rejects a bad _id, schema_v, qty and entry_id', () => {
		for (const patch of [
			{ _id: 'bulk_return_entry_void:x' },
			{ _id: `bulk_return_entry:${OP}` },
			{ schema_v: 2 },
			{ qty: '0' },
			{ qty: '1.5' },
			{ entry_id: 'bulk_return_entry:x' },
			{ item_id: '' }
		]) {
			expect(bulkReturnEntryVoidDocSchema.safeParse({ ...v, ...patch }).success).toBe(false);
		}
	});
});

describe('canVoidEntry', () => {
	it('is true only for an OPEN, unlocked pool', () => {
		expect(canVoidEntry({ status: 'OPEN' })).toBe(true);
		expect(canVoidEntry({ status: 'OPEN', lock: null })).toBe(true);
		expect(canVoidEntry({ status: 'OPEN', lock })).toBe(false);
		expect(canVoidEntry({ status: 'SUBMITTED' })).toBe(false);
		expect(canVoidEntry({ status: 'RECEIVED' })).toBe(false);
		expect(canVoidEntry({ status: 'CANCELLED' })).toBe(false);
	});
});
