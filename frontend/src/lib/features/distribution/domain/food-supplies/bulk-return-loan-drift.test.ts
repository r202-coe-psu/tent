import { describe, expect, it } from 'vitest';
import {
	assessBulkReturnRefOnLoan,
	findAppliedBulkReturnLoanRefs,
	findClosedBulkReturnLoanRefs,
	findMissedLoanRefs,
	isBulkReturnRefRevertable,
	type BulkReturnRefLoan
} from './bulk-return-loan-drift';

const ENTRY = 'bulk_return_entry:01J00000000000000000000001';
const OTHER_ENTRY = 'bulk_return_entry:01J00000000000000000000002';

function loan(over: Partial<BulkReturnRefLoan> = {}): BulkReturnRefLoan {
	return {
		_id: 'distribution_log:01J00000000000000000000010',
		is_returnable: true,
		status: 'active',
		qty: '3',
		...over
	};
}

describe('assessBulkReturnRefOnLoan', () => {
	it('is applicable for an active loan with enough outstanding', () => {
		expect(assessBulkReturnRefOnLoan(loan(), { qty: '3' }, ENTRY)).toEqual({
			status: 'applicable'
		});
		expect(
			assessBulkReturnRefOnLoan(
				loan({ status: 'partially_returned', qty_returned: '1' }),
				{ qty: '2' },
				ENTRY
			)
		).toEqual({ status: 'applicable' });
	});

	it('reports a missing loan', () => {
		expect(assessBulkReturnRefOnLoan(null, { qty: '1' }, ENTRY)).toEqual({
			status: 'skip',
			reason: 'missing'
		});
		expect(assessBulkReturnRefOnLoan(undefined, { qty: '1' }, ENTRY)).toEqual({
			status: 'skip',
			reason: 'missing'
		});
	});

	it.each(['lost', 'waived', 'returned', 'voided'] as const)('reports a %s loan as closed', (s) => {
		expect(assessBulkReturnRefOnLoan(loan({ status: s }), { qty: '1' }, ENTRY)).toMatchObject({
			status: 'skip',
			reason: 'closed'
		});
	});

	it('reports a non-returnable loan as closed', () => {
		expect(
			assessBulkReturnRefOnLoan(loan({ is_returnable: false }), { qty: '1' }, ENTRY)
		).toMatchObject({ status: 'skip', reason: 'closed' });
	});

	it('reports insufficient outstanding without partial apply', () => {
		expect(
			assessBulkReturnRefOnLoan(
				loan({ status: 'partially_returned', qty_returned: '2' }),
				{ qty: '2' },
				ENTRY
			)
		).toEqual({ status: 'skip', reason: 'insufficient', outstanding: '1' });
	});

	it('treats an already applied entry as applied before the closed / insufficient checks', () => {
		const applied = loan({
			status: 'returned',
			qty_returned: '3',
			applied_bulk_entry_ids: [ENTRY]
		});
		expect(assessBulkReturnRefOnLoan(applied, { qty: '3' }, ENTRY)).toEqual({
			status: 'already_applied'
		});
		expect(assessBulkReturnRefOnLoan(applied, { qty: '1' }, OTHER_ENTRY)).toMatchObject({
			status: 'skip',
			reason: 'closed'
		});
	});
});

describe('findClosedBulkReturnLoanRefs', () => {
	const A = 'distribution_log:01J0000000000000000000000A';
	const B = 'distribution_log:01J0000000000000000000000B';
	const C = 'distribution_log:01J0000000000000000000000C';

	it('lists only refs that are not applied and cannot be applied', () => {
		const entries = [
			{
				_id: ENTRY,
				loan_refs: [
					{ distribution_log_id: A, qty: '2' },
					{ distribution_log_id: B, qty: '2' },
					{ distribution_log_id: C, qty: '1' }
				]
			},
			{ _id: OTHER_ENTRY, loan_refs: [{ distribution_log_id: A, qty: '1' }] }
		];
		const loans = new Map<string, BulkReturnRefLoan | null>([
			[A, loan({ _id: A, status: 'lost' })],
			[B, loan({ _id: B, status: 'partially_returned', qty: '3', qty_returned: '2' })],
			[C, null]
		]);
		expect(findClosedBulkReturnLoanRefs(entries, loans)).toEqual([
			{ entry_id: ENTRY, distribution_log_id: A, qty: '2', reason: 'closed', outstanding: '3' },
			{
				entry_id: ENTRY,
				distribution_log_id: B,
				qty: '2',
				reason: 'insufficient',
				outstanding: '1'
			},
			{ entry_id: ENTRY, distribution_log_id: C, qty: '1', reason: 'missing' },
			{
				entry_id: OTHER_ENTRY,
				distribution_log_id: A,
				qty: '1',
				reason: 'closed',
				outstanding: '3'
			}
		]);
	});

	it('does not warn for applied refs, applicable refs or entries without refs', () => {
		const entries = [
			{ _id: ENTRY, loan_refs: [{ distribution_log_id: A, qty: '3' }] },
			{ _id: OTHER_ENTRY, loan_refs: [{ distribution_log_id: B, qty: '1' }] },
			{ _id: 'bulk_return_entry:01J00000000000000000000003', loan_refs: [] }
		];
		const loans = new Map<string, BulkReturnRefLoan | null>([
			[A, loan({ _id: A, status: 'returned', qty_returned: '3', applied_bulk_entry_ids: [ENTRY] })],
			[B, loan({ _id: B })]
		]);
		expect(findClosedBulkReturnLoanRefs(entries, loans)).toEqual([]);
	});

	it('carries the loan ticket_id when the loan exists, none when missing', () => {
		const loans = new Map<string, BulkReturnRefLoan | null>([
			[A, loan({ _id: A, status: 'lost', ticket_id: 'ticket:T1' })],
			[B, loan({ _id: B, status: 'lost' })],
			[C, null]
		]);
		const out = findClosedBulkReturnLoanRefs(
			[
				{
					_id: ENTRY,
					loan_refs: [
						{ distribution_log_id: A, qty: '1' },
						{ distribution_log_id: B, qty: '1' },
						{ distribution_log_id: C, qty: '1' }
					]
				}
			],
			loans
		);
		expect(out[0].ticket_id).toBe('ticket:T1');
		expect(out[1]).not.toHaveProperty('ticket_id');
		expect(out[2]).not.toHaveProperty('ticket_id');
	});

	it('treats a loan absent from the map as missing', () => {
		expect(
			findClosedBulkReturnLoanRefs(
				[{ _id: ENTRY, loan_refs: [{ distribution_log_id: A, qty: '1' }] }],
				new Map()
			)
		).toEqual([{ entry_id: ENTRY, distribution_log_id: A, qty: '1', reason: 'missing' }]);
	});
});

describe('findMissedLoanRefs', () => {
	const A = 'distribution_log:01J0000000000000000000000A';
	const B = 'distribution_log:01J0000000000000000000000B';
	const C = 'distribution_log:01J0000000000000000000000C';
	const D = 'distribution_log:01J0000000000000000000000D';

	it('lists only applicable refs the loan does not yet list, in entry then ref order', () => {
		const entries = [
			{
				_id: ENTRY,
				loan_refs: [
					{ distribution_log_id: A, qty: '2' },
					{ distribution_log_id: B, qty: '1' },
					{ distribution_log_id: C, qty: '1' },
					{ distribution_log_id: D, qty: '1' }
				]
			},
			{ _id: OTHER_ENTRY, loan_refs: [{ distribution_log_id: A, qty: '1' }] }
		];
		const loans = new Map<string, BulkReturnRefLoan | null>([
			[A, loan({ _id: A })], // applicable
			[B, loan({ _id: B, applied_bulk_entry_ids: [ENTRY] })], // already applied
			[C, loan({ _id: C, status: 'lost' })], // closed ref, not missed
			[D, null] // missing loan, not missed
		]);
		expect(findMissedLoanRefs(entries, loans)).toEqual([
			{ entry_id: ENTRY, distribution_log_id: A, qty: '2' },
			{ entry_id: OTHER_ENTRY, distribution_log_id: A, qty: '1' }
		]);
	});

	it('does not list a ref the loan cannot take whole (insufficient)', () => {
		const loans = new Map<string, BulkReturnRefLoan | null>([
			[A, loan({ _id: A, status: 'partially_returned', qty_returned: '2' })]
		]);
		expect(
			findMissedLoanRefs([{ _id: ENTRY, loan_refs: [{ distribution_log_id: A, qty: '2' }] }], loans)
		).toEqual([]);
	});

	it('returns nothing for entries without refs or an absent loan', () => {
		expect(
			findMissedLoanRefs(
				[
					{ _id: ENTRY, loan_refs: [] },
					{ _id: OTHER_ENTRY, loan_refs: [{ distribution_log_id: A, qty: '1' }] }
				],
				new Map()
			)
		).toEqual([]);
	});
});

describe('isBulkReturnRefRevertable', () => {
	it.each(['returned', 'partially_returned'] as const)('accepts a %s loan holding enough', (s) => {
		expect(isBulkReturnRefRevertable({ status: s, qty_returned: '2' }, { qty: '2' })).toBe(true);
	});

	it.each(['lost', 'waived', 'active'] as const)('rejects a %s loan', (s) => {
		expect(isBulkReturnRefRevertable({ status: s, qty_returned: '5' }, { qty: '1' })).toBe(false);
	});

	it('rejects a ref larger than qty_returned (or no qty_returned)', () => {
		expect(
			isBulkReturnRefRevertable({ status: 'partially_returned', qty_returned: '1' }, { qty: '2' })
		).toBe(false);
		expect(isBulkReturnRefRevertable({ status: 'returned' }, { qty: '1' })).toBe(false);
	});
});

describe('findAppliedBulkReturnLoanRefs', () => {
	const A = 'distribution_log:01J0000000000000000000000A';
	const B = 'distribution_log:01J0000000000000000000000B';
	const C = 'distribution_log:01J0000000000000000000000C';

	it('lists only refs whose entry id is in the loan applied ids, in entry then ref order', () => {
		const entries = [
			{
				_id: ENTRY,
				loan_refs: [
					{ distribution_log_id: A, qty: '2' },
					{ distribution_log_id: B, qty: '1' },
					{ distribution_log_id: C, qty: '1' }
				]
			},
			{ _id: OTHER_ENTRY, loan_refs: [{ distribution_log_id: A, qty: '1' }] }
		];
		const loans = new Map<string, BulkReturnRefLoan | null>([
			[A, loan({ _id: A, applied_bulk_entry_ids: [ENTRY, OTHER_ENTRY] })],
			[B, loan({ _id: B })],
			[C, null]
		]);
		expect(findAppliedBulkReturnLoanRefs(entries, loans)).toEqual([
			{
				entry_id: ENTRY,
				distribution_log_id: A,
				qty: '2',
				loan_status: 'active',
				revertable: false
			},
			{
				entry_id: OTHER_ENTRY,
				distribution_log_id: A,
				qty: '1',
				loan_status: 'active',
				revertable: false
			}
		]);
	});

	it('carries the loan status and whether the ref is revertable', () => {
		const entries = [
			{
				_id: ENTRY,
				loan_refs: [
					{ distribution_log_id: A, qty: '2' },
					{ distribution_log_id: B, qty: '1' }
				]
			}
		];
		const loans = new Map<string, BulkReturnRefLoan | null>([
			[A, loan({ _id: A, status: 'returned', qty_returned: '3', applied_bulk_entry_ids: [ENTRY] })],
			[B, loan({ _id: B, status: 'lost', qty_returned: '1', applied_bulk_entry_ids: [ENTRY] })]
		]);
		expect(findAppliedBulkReturnLoanRefs(entries, loans)).toEqual([
			{
				entry_id: ENTRY,
				distribution_log_id: A,
				qty: '2',
				loan_status: 'returned',
				revertable: true
			},
			{ entry_id: ENTRY, distribution_log_id: B, qty: '1', loan_status: 'lost', revertable: false }
		]);
	});

	it('returns nothing for an absent loan', () => {
		expect(
			findAppliedBulkReturnLoanRefs(
				[{ _id: ENTRY, loan_refs: [{ distribution_log_id: A, qty: '1' }] }],
				new Map()
			)
		).toEqual([]);
	});
});
