import { describe, expect, it } from 'vitest';
import type { AuthorContext } from '$lib/db/model';
import { createBulkReturnEntry } from './bulk-return-entry';
import {
	bulkReturnLoanReopenDocSchema,
	canReopenEntryLoans,
	createBulkReturnLoanReopen,
	deriveLoanReopenId
} from './bulk-return-loan-reopen';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'staff:sm' };
const OP = '01J00000000000000000000001';
const P1 = 'bulk_return_pool:01J00000000000000000000011';
const L1 = 'distribution_log:01J00000000000000000000021';
const L2 = 'distribution_log:01J00000000000000000000022';

const entry = createBulkReturnEntry(
	{ pool_id: P1, item_id: 'item_master:cot', qty: '5', returner_type: 'unspecified' },
	ctx,
	OP
);

const make = (patch: Partial<Parameters<typeof createBulkReturnLoanReopen>[0]> = {}) =>
	createBulkReturnLoanReopen(
		{ entry, pool_id: P1, reason: 'wrong returner', loan_ids: [L1], ...patch },
		ctx
	);

describe('deriveLoanReopenId', () => {
	it('is deterministic from the entry ULID', () => {
		expect(deriveLoanReopenId(entry._id)).toBe(`bulk_return_loan_reopen:${OP}`);
	});

	it('rejects a malformed entry id', () => {
		expect(() => deriveLoanReopenId('bulk_return_entry:x')).toThrow();
		expect(() => deriveLoanReopenId(`bulk_return_pool:${OP}`)).toThrow();
	});
});

describe('createBulkReturnLoanReopen', () => {
	it('builds the doc with a deterministic id and a trimmed reason', () => {
		const doc = make({ reason: '  wrong returner  ', loan_ids: [L1, L2] });
		expect(doc).toMatchObject({
			_id: `bulk_return_loan_reopen:${OP}`,
			type: 'bulk_return_loan_reopen',
			schema_v: 1,
			entry_id: entry._id,
			pool_id: P1,
			reason: 'wrong returner',
			loan_ids: [L1, L2],
			created_by: 'staff:sm'
		});
	});

	it('rejects a missing, blank or too long reason', () => {
		expect(() => make({ reason: undefined as unknown as string })).toThrow();
		expect(() => make({ reason: '   ' })).toThrow();
		expect(() => make({ reason: 'x'.repeat(501) })).toThrow();
		expect(make({ reason: 'x'.repeat(500) }).reason).toHaveLength(500);
	});

	it('rejects empty, duplicate and malformed loan_ids', () => {
		expect(() => make({ loan_ids: [] })).toThrow();
		expect(() => make({ loan_ids: [L1, L1] })).toThrow();
		expect(() => make({ loan_ids: ['distribution_log:x'] })).toThrow();
	});

	it('rejects a malformed pool id', () => {
		expect(() => make({ pool_id: 'bulk_return_pool:x' })).toThrow();
	});
});

describe('bulkReturnLoanReopenDocSchema', () => {
	const doc = make();

	it('accepts a created doc', () => {
		expect(bulkReturnLoanReopenDocSchema.safeParse(doc).success).toBe(true);
	});

	it('requires entry_id to match the entry ULID in _id', () => {
		expect(
			bulkReturnLoanReopenDocSchema.safeParse({
				...doc,
				entry_id: 'bulk_return_entry:01J00000000000000000000099'
			}).success
		).toBe(false);
	});

	it('rejects a bad _id, schema_v, reason and loan_ids', () => {
		for (const patch of [
			{ _id: 'bulk_return_loan_reopen:x' },
			{ _id: `bulk_return_entry_void:${OP}` },
			{ schema_v: 2 },
			{ reason: '' },
			{ reason: '  ' },
			{ reason: 'x'.repeat(501) },
			{ loan_ids: [] },
			{ loan_ids: [L1, L1] },
			{ entry_id: 'bulk_return_entry:x' }
		]) {
			expect(bulkReturnLoanReopenDocSchema.safeParse({ ...doc, ...patch }).success).toBe(false);
		}
	});
});

describe('canReopenEntryLoans', () => {
	const other = 'bulk_return_entry:01J00000000000000000000099';

	it('is true only for a SUBMITTED / RECEIVED pool whose snapshot holds the entry', () => {
		expect(canReopenEntryLoans({ status: 'SUBMITTED', entry_ids: [entry._id] }, entry._id)).toBe(
			true
		);
		expect(canReopenEntryLoans({ status: 'RECEIVED', entry_ids: [entry._id] }, entry._id)).toBe(
			true
		);
		expect(canReopenEntryLoans({ status: 'OPEN', entry_ids: [entry._id] }, entry._id)).toBe(false);
		expect(canReopenEntryLoans({ status: 'CANCELLED', entry_ids: [entry._id] }, entry._id)).toBe(
			false
		);
	});

	it('is false when the entry is not in the snapshot (or there is none)', () => {
		expect(canReopenEntryLoans({ status: 'SUBMITTED', entry_ids: [other] }, entry._id)).toBe(false);
		expect(canReopenEntryLoans({ status: 'RECEIVED', entry_ids: [] }, entry._id)).toBe(false);
		expect(canReopenEntryLoans({ status: 'SUBMITTED' }, entry._id)).toBe(false);
	});
});
