import { describe, expect, it } from 'vitest';
import {
	canCloseM6WithoutGoods,
	closeM6Donation,
	isM6Donation,
	m6ConfirmState,
	m6SourceLabel,
	toM6Summary,
	type M6Summary
} from './m6';

const summary = (over: Partial<M6Summary> = {}): M6Summary => ({
	request_code: 'WD-001',
	source_warehouse_code: 'WH-01',
	source_warehouse_name: 'คลังกลางสมุทรปราการ',
	confirmed_at: null,
	confirm_error: null,
	...over
});

describe('isM6Donation', () => {
	it('is true only for channel m6', () => {
		expect(isM6Donation({ channel: 'm6' })).toBe(true);
		expect(isM6Donation({ channel: 'public' })).toBe(false);
		expect(isM6Donation({ channel: 'walk_in' })).toBe(false);
		expect(isM6Donation({})).toBe(false);
	});
});

describe('toM6Summary', () => {
	const external = {
		system: 'm6',
		request_code: 'WD-001',
		external_ref: 'TENT-X-1',
		source_warehouse_code: 'WH-01',
		source_warehouse_name: 'คลังกลาง A',
		confirmed_at: null,
		confirm_error: null
	};

	it('projects external of an m6 doc and drops internal fields', () => {
		expect(toM6Summary({ channel: 'm6', external })).toEqual({
			request_code: 'WD-001',
			source_warehouse_code: 'WH-01',
			source_warehouse_name: 'คลังกลาง A',
			confirmed_at: null,
			confirm_error: null
		});
	});

	it('is undefined for non-m6 docs, and for an m6 doc without external', () => {
		expect(toM6Summary({ channel: 'public', external })).toBeUndefined();
		expect(toM6Summary({ channel: 'walk_in' })).toBeUndefined();
		expect(toM6Summary({ channel: 'm6' })).toBeUndefined();
		expect(toM6Summary({ channel: 'm6', external: null })).toBeUndefined();
	});

	it('reads a partial external defensively', () => {
		expect(
			toM6Summary({ channel: 'm6', external: { system: 'm6', source_warehouse_name: '  ' } })
		).toEqual({
			request_code: '',
			source_warehouse_code: '',
			source_warehouse_name: null,
			confirmed_at: null,
			confirm_error: null
		});
	});
});

describe('m6SourceLabel', () => {
	it('prefers the warehouse name', () => {
		expect(m6SourceLabel({ m6: summary() })).toBe('คลังกลาง M6 · คลังกลางสมุทรปราการ');
	});

	it('falls back to the warehouse code, then to the bare label', () => {
		expect(m6SourceLabel({ m6: summary({ source_warehouse_name: null }) })).toBe(
			'คลังกลาง M6 · WH-01'
		);
		expect(
			m6SourceLabel({ m6: summary({ source_warehouse_name: null, source_warehouse_code: '' }) })
		).toBe('คลังกลาง M6');
		expect(m6SourceLabel({})).toBe('คลังกลาง M6');
	});
});

describe('m6ConfirmState', () => {
	const received = { channel: 'm6', status: 'received' };

	it('is null for a donation that is not m6', () => {
		expect(m6ConfirmState({ channel: 'public', status: 'received', m6: summary() })).toBeNull();
		expect(m6ConfirmState({ channel: 'walk_in', status: 'received' })).toBeNull();
	});

	it('is null until the donation is received (nothing to confirm yet)', () => {
		expect(m6ConfirmState({ channel: 'm6', status: 'verifying', m6: summary() })).toBeNull();
	});

	it('is null for an m6 row without a summary', () => {
		expect(m6ConfirmState(received)).toBeNull();
	});

	it('waiting: received, no confirmation and no error yet', () => {
		expect(m6ConfirmState({ ...received, m6: summary() })).toBe('waiting');
	});

	it('failed: received and the last attempt left an error', () => {
		expect(m6ConfirmState({ ...received, m6: summary({ confirm_error: 'timeout' }) })).toBe(
			'failed'
		);
	});

	it('confirmed: confirmed_at wins over a stale error', () => {
		expect(
			m6ConfirmState({
				...received,
				m6: summary({ confirmed_at: '2026-11-12T03:00:00Z', confirm_error: 'timeout' })
			})
		).toBe('confirmed');
	});
});

describe('canCloseM6WithoutGoods', () => {
	it('is true for an open m6 donation no point has recorded', () => {
		for (const status of ['declared', 'pending_review', 'verifying']) {
			expect(canCloseM6WithoutGoods({ channel: 'm6', status, point_receipts: [] })).toBe(true);
		}
		expect(canCloseM6WithoutGoods({ channel: 'm6', status: 'verifying' })).toBe(true);
	});

	it('is false once something was recorded (the point-based close applies)', () => {
		expect(
			canCloseM6WithoutGoods({
				channel: 'm6',
				status: 'verifying',
				point_receipts: [{ line_nos: [0] }]
			})
		).toBe(false);
	});

	it('is false for a closed m6 donation and for any other channel', () => {
		for (const status of ['received', 'rejected', 'expired', 'cancelled', 'redirected']) {
			expect(canCloseM6WithoutGoods({ channel: 'm6', status })).toBe(false);
		}
		expect(canCloseM6WithoutGoods({ channel: 'public', status: 'verifying' })).toBe(false);
		expect(canCloseM6WithoutGoods({ channel: 'walk_in', status: 'verifying' })).toBe(false);
	});
});

describe('closeM6Donation', () => {
	const opts = {
		closedBy: 'staff1',
		closedReason: 'staff_close',
		now: '2026-11-12T03:00:00.000Z'
	} as const;
	const items = [
		{ item_id: 'item:water', qty: '24', unit: 'ขวด' },
		{ free_text: 'ยาพารา', qty: '10', unit: 'แผง' }
	];

	it('with no receipt: received, every line a shortfall, nothing_received', () => {
		const closed = closeM6Donation({ items, point_receipts: [] }, opts);
		expect(closed.status).toBe('received');
		expect(closed.received_at).toBe(opts.now);
		expect(closed.received_summary).toMatchObject({
			nothing_received: true,
			total_items: 0,
			closed_by: 'staff1',
			closed_reason: 'staff_close',
			received_at: opts.now
		});
		expect(closed.received_summary.shortfalls.map((s) => [s.declared, s.counted, s.short])).toEqual(
			[
				['24', '0', '24'],
				['10', '0', '10']
			]
		);
		expect(closed.received_summary.items.map((line) => line.qty)).toEqual(['0', '0']);
	});

	it('with something received: received, normal summary, no flag', () => {
		const closed = closeM6Donation(
			{
				items,
				point_receipts: [
					{
						point_id: null,
						line_nos: [0],
						received_at: opts.now,
						received_by: 'staff1',
						audit_id: 'audit:a',
						ledger_ids: [],
						items: [{ line_no: 0, item_id: 'item:water', qty: '20', unit: 'ขวด' }]
					}
				]
			},
			opts
		);
		expect(closed.status).toBe('received');
		expect(closed.received_summary.nothing_received).toBeUndefined();
		expect(closed.received_summary.total_items).toBe(2);
		expect(closed.received_summary.shortfalls.map((s) => s.short)).toEqual(['4', '10']);
	});
});
