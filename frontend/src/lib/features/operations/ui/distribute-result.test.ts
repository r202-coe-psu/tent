import { describe, expect, it } from 'vitest';
import { emptyDistributeLine, type DistributeLineDraft } from '../domain/distribute-batch';
import { describeBatchResult, describeLineStatus } from './distribute-result';

const labels = {
	itemName: (id: string) => ({ 'item:rice': 'ข้าวสาร', 'item:water': 'น้ำดื่ม' })[id] ?? id,
	baseUnitLabel: (id: string) => (id === 'item:water' ? 'ขวด' : 'กก.')
};

const done = (key: string, itemId: string, qty: string): DistributeLineDraft => ({
	...emptyDistributeLine(key),
	item_id: itemId,
	qty,
	status: { kind: 'done', distributedQty: qty }
});
const failed = (
	key: string,
	itemId: string,
	qty: string,
	landed: string,
	message: string
): DistributeLineDraft => ({
	...emptyDistributeLine(key),
	item_id: itemId,
	qty,
	status: { kind: 'failed', message, distributedQty: landed }
});
const pending = (key: string, itemId: string): DistributeLineDraft => ({
	...emptyDistributeLine(key),
	item_id: itemId,
	qty: '1'
});

describe('describeBatchResult (#837, FR-A9)', () => {
	it('a one-line success stays the short message', () => {
		const r = describeBatchResult([done('a', 'item:rice', '5')], labels);
		expect(r.kind).toBe('success');
		expect(r.message).toBe('เบิกแล้ว');
	});

	it('a multi-line success says how many lines and how much of each item', () => {
		const r = describeBatchResult(
			[done('a', 'item:rice', '30'), done('b', 'item:water', '24')],
			labels
		);
		expect(r.kind).toBe('success');
		expect(r.message).toBe('เบิกแล้ว 2 รายการ');
		expect(r.items.map((i) => [i.name, i.qty, i.unitLabel])).toEqual([
			['ข้าวสาร', '30', 'กก.'],
			['น้ำดื่ม', '24', 'ขวด']
		]);
		expect(r.detail).toBe('ข้าวสาร 30 กก. · น้ำดื่ม 24 ขวด');
	});

	it('partial: lines cut, lines left, the failing item and the cause', () => {
		const r = describeBatchResult(
			[
				done('a', 'item:rice', '30'),
				failed('b', 'item:water', '12', '12', 'Insufficient stock'),
				pending('c', 'item:salt')
			],
			labels
		);
		expect(r.kind).toBe('partial');
		expect(r.message).toContain('1 จาก 3 รายการ');
		expect(r.message).toContain('อีก 2 รายการ');
		expect(r.message).toContain('น้ำดื่ม');
		expect(r.message).toContain('Insufficient stock');
		expect(r.items.map((i) => [i.name, i.qty])).toEqual([
			['ข้าวสาร', '30'],
			['น้ำดื่ม', '12']
		]);
	});

	it('nothing cut: a plain failure', () => {
		const r = describeBatchResult([failed('a', 'item:rice', '10', '0', 'offline')], labels);
		expect(r.kind).toBe('failed');
		expect(r.message).toContain('offline');
		expect(r.items).toEqual([]);
	});
});

describe('describeLineStatus', () => {
	it('is silent for an untouched line and reports a landed one', () => {
		expect(describeLineStatus(pending('a', 'item:rice'), labels)).toBeNull();
		expect(describeLineStatus(done('a', 'item:rice', '30'), labels)).toBe('เบิกแล้ว 30 กก.');
	});

	it('a partly cut line shows what landed and what is left', () => {
		const text = describeLineStatus(failed('a', 'item:rice', '24', '6', 'offline'), labels);
		expect(text).toContain('ตัดแล้ว 6 กก.');
		expect(text).toContain('อีก 24 กก.');
		expect(text).toContain('offline');
	});

	it('a line that cut nothing shows only the cause', () => {
		expect(describeLineStatus(failed('a', 'item:rice', '24', '0', 'offline'), labels)).toBe(
			'offline'
		);
	});
});
