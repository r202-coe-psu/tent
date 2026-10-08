import { describe, expect, it } from 'vitest';
import type { DistributeAcrossLotsResult } from '../application/distribute-across-lots';
import { describeDistributeResult } from './distribute-result';

const base = { ref_id: 'requisition_ticket:direct-1' };
const row = (lot_ref: string, qty: string) =>
	({ lot_ref, qty, entry: {} as never }) as DistributeAcrossLotsResult['distributed'][number];

describe('describeDistributeResult (FR-A9)', () => {
	it('a one-lot success stays the short message', () => {
		const r = describeDistributeResult(
			{
				...base,
				distributed: [row('a', '5')],
				distributedQty: '5',
				remainingQty: '0',
				complete: true
			},
			'ชิ้น'
		);
		expect(r).toEqual({ kind: 'success', message: 'เบิกแล้ว' });
	});

	it('a multi-lot success says how many lots and how much', () => {
		const r = describeDistributeResult(
			{
				...base,
				distributed: [row('a', '6'), row('b', '20'), row('c', '4')],
				distributedQty: '30',
				remainingQty: '0',
				complete: true
			},
			'ชิ้น'
		);
		expect(r.kind).toBe('success');
		expect(r.message).toContain('30 ชิ้น');
		expect(r.message).toContain('3 ล็อต');
	});

	it('partial: reports lots cut, quantity cut, quantity left and the cause', () => {
		const r = describeDistributeResult(
			{
				...base,
				distributed: [row('a', '6')],
				distributedQty: '6',
				remainingQty: '24',
				failure: { lot_ref: 'b', qty: '20', message: 'Insufficient stock' },
				complete: false
			},
			'ชิ้น'
		);
		expect(r.kind).toBe('partial');
		expect(r.message).toContain('1 ล็อต');
		expect(r.message).toContain('6 ชิ้น');
		expect(r.message).toContain('24 ชิ้น');
		expect(r.message).toContain('Insufficient stock');
	});

	it('nothing cut: a plain failure', () => {
		const r = describeDistributeResult(
			{
				...base,
				distributed: [],
				distributedQty: '0',
				remainingQty: '10',
				failure: { lot_ref: 'a', qty: '10', message: 'offline' },
				complete: false
			},
			'ชิ้น'
		);
		expect(r.kind).toBe('failed');
		expect(r.message).toContain('offline');
	});
});
