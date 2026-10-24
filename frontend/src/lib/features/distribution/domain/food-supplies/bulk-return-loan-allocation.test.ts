import { describe, expect, it } from 'vitest';
import {
	allocateBulkReturnToLoans,
	selectOutstandingLoans,
	type AllocatableLoan
} from './bulk-return-loan-allocation';

const EVACUEE = 'evacuee:01J00000000000000000000001';
const OTHER = 'evacuee:01J00000000000000000000002';

function loan(n: number, overrides: Partial<AllocatableLoan> = {}): AllocatableLoan {
	return {
		_id: `distribution_log:01J0000000000000000000000${n}`,
		item_id: 'item:cot',
		qty: '3',
		status: 'active',
		is_returnable: true,
		recipient_id: EVACUEE,
		distributed_at: `2026-10-0${n}T08:00:00.000Z`,
		...overrides
	};
}

describe('selectOutstandingLoans', () => {
	it('keeps only the returner active/partially_returned loans of the item, oldest first', () => {
		const newest = loan(3);
		const oldest = loan(1, { status: 'partially_returned', qty_returned: '1' });
		const loans = [
			newest,
			oldest,
			loan(4, { recipient_id: OTHER }),
			loan(5, { item_id: 'item:fan' }),
			loan(6, { status: 'returned', qty_returned: '3' }),
			loan(7, { status: 'voided' }),
			loan(8, { is_returnable: false, status: 'fulfilled' })
		];
		expect(selectOutstandingLoans(loans, { returnerId: EVACUEE, itemId: 'item:cot' })).toEqual([
			oldest,
			newest
		]);
	});

	it('drops a loan with nothing outstanding', () => {
		const spent = loan(1, { status: 'partially_returned', qty_returned: '3' });
		expect(selectOutstandingLoans([spent], { returnerId: EVACUEE, itemId: 'item:cot' })).toEqual(
			[]
		);
	});

	it('breaks distributed_at ties by _id', () => {
		const a = loan(1, { distributed_at: '2026-10-01T08:00:00.000Z' });
		const b = loan(2, { distributed_at: '2026-10-01T08:00:00.000Z' });
		expect(
			selectOutstandingLoans([b, a], { returnerId: EVACUEE, itemId: 'item:cot' }).map((l) => l._id)
		).toEqual([a._id, b._id]);
	});
});

describe('allocateBulkReturnToLoans', () => {
	it('lend 3, return 2 -> one ref of 2 (1 stays outstanding)', () => {
		const l = loan(1);
		expect(allocateBulkReturnToLoans([l], '2')).toEqual([{ distribution_log_id: l._id, qty: '2' }]);
	});

	it('allocates oldest-first up to each outstanding', () => {
		const first = loan(1, { status: 'partially_returned', qty_returned: '2' });
		const second = loan(2);
		const refs = allocateBulkReturnToLoans([second, first], '3');
		expect(refs).toEqual([
			{ distribution_log_id: first._id, qty: '1' },
			{ distribution_log_id: second._id, qty: '2' }
		]);
	});

	it('does not allocate quantity beyond the total outstanding', () => {
		const l = loan(1);
		expect(allocateBulkReturnToLoans([l], '10')).toEqual([
			{ distribution_log_id: l._id, qty: '3' }
		]);
	});

	it('stops once the quantity is used up', () => {
		const refs = allocateBulkReturnToLoans([loan(1), loan(2)], '3');
		expect(refs).toHaveLength(1);
		expect(refs[0].qty).toBe('3');
	});

	it('skips loans with nothing outstanding and returns [] without loans', () => {
		const spent = loan(1, { status: 'partially_returned', qty_returned: '3' });
		expect(allocateBulkReturnToLoans([spent], '2')).toEqual([]);
		expect(allocateBulkReturnToLoans([], '2')).toEqual([]);
	});
});
