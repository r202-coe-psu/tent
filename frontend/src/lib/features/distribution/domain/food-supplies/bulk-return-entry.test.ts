import { describe, expect, it } from 'vitest';
import type { AuthorContext } from '$lib/db/model';
import {
	bulkReturnEntryDocSchema,
	createBulkReturnEntry,
	isBulkReturnEligibleItem
} from './bulk-return-entry';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'staff:dst' };
const OP = '01J00000000000000000000001';
const POOL = 'bulk_return_pool:01J00000000000000000000002';
const LOG_A = 'distribution_log:01J0000000000000000000000A';
const LOG_B = 'distribution_log:01J0000000000000000000000B';

const input = (over: Record<string, unknown> = {}) => ({
	pool_id: POOL,
	item_id: 'item_master:cot',
	qty: '5',
	...over
});

describe('createBulkReturnEntry', () => {
	it('creates a schema_v 1 entry with a deterministic id from the operation ULID', () => {
		const entry = createBulkReturnEntry(input(), ctx, OP);
		expect(entry).toMatchObject({
			_id: `bulk_return_entry:${OP}`,
			type: 'bulk_return_entry',
			schema_v: 1,
			pool_id: POOL,
			item_id: 'item_master:cot',
			qty: '5',
			loan_refs: [],
			created_by: 'staff:dst'
		});
		expect(createBulkReturnEntry(input(), ctx, OP)._id).toBe(entry._id);
	});

	it('rejects a malformed operation ULID, pool id, item id and non-positive qty', () => {
		expect(() => createBulkReturnEntry(input(), ctx, 'not-a-ulid')).toThrow();
		expect(() =>
			createBulkReturnEntry(input({ pool_id: 'bulk_return_pool:x' }), ctx, OP)
		).toThrow();
		expect(() => createBulkReturnEntry(input({ item_id: '' }), ctx, OP)).toThrow();
		for (const qty of ['0', '-1', '1.5', 'abc', 0]) {
			expect(() => createBulkReturnEntry(input({ qty }), ctx, OP)).toThrow();
		}
	});

	it('accepts a numeric qty at the input boundary and persists a string', () => {
		expect(createBulkReturnEntry(input({ qty: 3 }), ctx, OP).qty).toBe('3');
	});

	it('accepts an absent, null, evacuee: or volunteer: returner and rejects any other prefix', () => {
		expect(createBulkReturnEntry(input(), ctx, OP)).not.toHaveProperty('returner_id');
		expect(createBulkReturnEntry(input({ returner_id: null }), ctx, OP).returner_id).toBeNull();
		expect(createBulkReturnEntry(input({ returner_id: 'evacuee:01J' }), ctx, OP).returner_id).toBe(
			'evacuee:01J'
		);
		expect(
			createBulkReturnEntry(input({ returner_id: 'volunteer:01J' }), ctx, OP).returner_id
		).toBe('volunteer:01J');
		for (const returner_id of ['staff:01J', 'outside:x', 'evacuee', '']) {
			expect(() => createBulkReturnEntry(input({ returner_id }), ctx, OP)).toThrow();
		}
	});

	it('accepts empty loan_refs and refs whose qty sums to at most the entry qty', () => {
		expect(createBulkReturnEntry(input({ loan_refs: [] }), ctx, OP).loan_refs).toEqual([]);
		expect(() =>
			createBulkReturnEntry(
				input({
					loan_refs: [
						{ distribution_log_id: LOG_A, qty: '2' },
						{ distribution_log_id: LOG_B, qty: '3' }
					]
				}),
				ctx,
				OP
			)
		).not.toThrow();
		expect(() =>
			createBulkReturnEntry(
				input({ loan_refs: [{ distribution_log_id: LOG_A, qty: '4' }] }),
				ctx,
				OP
			)
		).not.toThrow();
	});

	it('rejects loan_refs summing above the entry qty', () => {
		expect(() =>
			createBulkReturnEntry(
				input({
					loan_refs: [
						{ distribution_log_id: LOG_A, qty: '3' },
						{ distribution_log_id: LOG_B, qty: '3' }
					]
				}),
				ctx,
				OP
			)
		).toThrow(/exceed/);
	});

	it('rejects duplicate distribution_log_id in loan_refs', () => {
		expect(() =>
			createBulkReturnEntry(
				input({
					loan_refs: [
						{ distribution_log_id: LOG_A, qty: '1' },
						{ distribution_log_id: LOG_A, qty: '1' }
					]
				}),
				ctx,
				OP
			)
		).toThrow(/duplicate/);
	});

	it('rejects malformed loan refs (bad id, non-positive qty)', () => {
		for (const ref of [
			{ distribution_log_id: 'distribution_log:x', qty: '1' },
			{ distribution_log_id: LOG_A, qty: '0' },
			{ distribution_log_id: LOG_A, qty: '1.5' }
		]) {
			expect(() => createBulkReturnEntry(input({ loan_refs: [ref] }), ctx, OP)).toThrow();
		}
	});
});

describe('bulkReturnEntryDocSchema', () => {
	it('rejects schema_v other than 1 and a non-entry id', () => {
		const entry = createBulkReturnEntry(input(), ctx, OP);
		expect(bulkReturnEntryDocSchema.safeParse(entry).success).toBe(true);
		expect(bulkReturnEntryDocSchema.safeParse({ ...entry, schema_v: 2 }).success).toBe(false);
		expect(
			bulkReturnEntryDocSchema.safeParse({ ...entry, _id: `bulk_return_pool:${OP}` }).success
		).toBe(false);
	});
});

describe('isBulkReturnEligibleItem', () => {
	it('accepts an item the catalog marks returnable', () => {
		expect(isBulkReturnEligibleItem({ returnable: true })).toBe(true);
	});

	it('rejects a non-returnable item or one with no returnable flag', () => {
		expect(isBulkReturnEligibleItem({ returnable: false })).toBe(false);
		expect(isBulkReturnEligibleItem({})).toBe(false);
	});

	it('decides on returnable alone, ignoring type_class', () => {
		const returnableConsumable = { returnable: true, type_class: 'CONSUMABLE' };
		const nonReturnableDurable = { returnable: false, type_class: 'DURABLE' };
		expect(isBulkReturnEligibleItem(returnableConsumable)).toBe(true);
		expect(isBulkReturnEligibleItem(nonReturnableDurable)).toBe(false);
	});

	it('keeps a deactivated returnable item eligible so outstanding loans can still be returned', () => {
		const deactivated = { returnable: true, deactivated: true };
		expect(isBulkReturnEligibleItem(deactivated)).toBe(true);
	});
});
