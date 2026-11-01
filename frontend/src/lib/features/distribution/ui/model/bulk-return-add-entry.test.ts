import { describe, expect, it } from 'vitest';
import type { DistributionLog } from '../../domain/food-supplies';
import type { AddBulkReturnEntriesResult } from '../../application/food-supplies/bulk-return-pool-v3-add-entry';
import {
	addLine,
	buildAddEntriesInput,
	dropWrittenLines,
	filterEligibleItems,
	hasNoOutstandingLoanWarning,
	identifiedReturnerId,
	linesFromOutstandingLoans,
	outstandingLoanRows,
	type OutstandingLoanRow,
	removeLine,
	resolveDefaultPoolId,
	resolveReturner,
	loanPendingWarning,
	remainingLinesMessage,
	summarizeAddResult,
	type ReturnerChoice,
	wroteIntoPool,
	ulidsNeedingWrittenLookup,
	validateAddEntryLines,
	type AddEntryLine
} from './bulk-return-add-entry';

function counter() {
	let n = 0;
	return () => `ULID${++n}`;
}

function line(id: string, item_id: string, qty: string): AddEntryLine {
	return { lineId: id, item_id, qty, operationUlid: id };
}

describe('linesFromOutstandingLoans', () => {
	function loanRow(logId: string, item_id: string, outstanding: string): OutstandingLoanRow {
		return { logId, item_id, itemName: item_id, unit: '', outstanding, distributed_at: '' };
	}
	const makeFrom = () => {
		const next = counter();
		return (preset: { item_id: string; qty: string }) =>
			addLine([], next, preset)[0] as AddEntryLine;
	};

	it('sums outstanding of several loans of the same item into one line', () => {
		const result = linesFromOutstandingLoans(
			[
				loanRow('l1', 'item_master:a', '2'),
				loanRow('l2', 'item_master:b', '1'),
				loanRow('l3', 'item_master:a', '3')
			],
			new Set(['item_master:a', 'item_master:b']),
			makeFrom()
		);
		expect(result.lines.map((l) => [l.item_id, l.qty])).toEqual([
			['item_master:a', '5'],
			['item_master:b', '1']
		]);
		expect(result.skippedItemIds).toEqual([]);
		expect(new Set(result.lines.map((l) => l.operationUlid)).size).toBe(2);
	});

	it('skips and reports items outside the eligible set', () => {
		const result = linesFromOutstandingLoans(
			[loanRow('l1', 'item_master:a', '2'), loanRow('l2', 'item_master:x', '4')],
			new Set(['item_master:a']),
			makeFrom()
		);
		expect(result.lines.map((l) => l.item_id)).toEqual(['item_master:a']);
		expect(result.skippedItemIds).toEqual(['item_master:x']);
	});

	it('re-fill keeps the line (same ulid) when the qty is unchanged', () => {
		const current: AddEntryLine[] = [
			{ lineId: 'L1', item_id: 'item_master:a', qty: '5', operationUlid: 'OP1' }
		];
		const result = linesFromOutstandingLoans(
			[loanRow('l1', 'item_master:a', '2'), loanRow('l2', 'item_master:a', '3')],
			new Set(['item_master:a']),
			makeFrom(),
			current
		);
		expect(result.lines).toEqual(current);
		expect(result.keptAtWrittenQtyItemIds).toEqual([]);
	});

	it('re-fill gives a new ulid when the qty changed and nothing was written', () => {
		const current: AddEntryLine[] = [
			{ lineId: 'L1', item_id: 'item_master:a', qty: '1', operationUlid: 'OP1' }
		];
		const result = linesFromOutstandingLoans(
			[loanRow('l1', 'item_master:a', '2'), loanRow('l2', 'item_master:a', '3')],
			new Set(['item_master:a']),
			makeFrom(),
			current,
			new Map()
		);
		expect(result.lines.map((l) => [l.item_id, l.qty, l.operationUlid])).toEqual([
			['item_master:a', '5', 'ULID1']
		]);
		expect(result.keptAtWrittenQtyItemIds).toEqual([]);
	});

	it('re-fill keeps the written qty and ulid when the qty changed but the entry was written', () => {
		const current: AddEntryLine[] = [
			{ lineId: 'L1', item_id: 'item_master:a', qty: '2', operationUlid: 'OP1' },
			{ lineId: 'L2', item_id: 'item_master:b', qty: '1', operationUlid: 'OP2' }
		];
		const result = linesFromOutstandingLoans(
			[loanRow('l1', 'item_master:a', '3'), loanRow('l2', 'item_master:b', '1')],
			new Set(['item_master:a', 'item_master:b']),
			makeFrom(),
			current,
			new Map([['OP1', { qty: '2' }]])
		);
		expect(result.lines).toEqual(current);
		expect(result.keptAtWrittenQtyItemIds).toEqual(['item_master:a']);
	});

	it('re-fill restores the written qty of an edited line without reporting an equal total', () => {
		const current: AddEntryLine[] = [
			{ lineId: 'L1', item_id: 'item_master:a', qty: '3', operationUlid: 'OP1' }
		];
		const result = linesFromOutstandingLoans(
			[loanRow('l1', 'item_master:a', '3')],
			new Set(['item_master:a']),
			makeFrom(),
			current,
			new Map([['OP1', { qty: '3' }]])
		);
		expect(result.lines).toEqual(current);
		expect(result.keptAtWrittenQtyItemIds).toEqual([]);
	});

	it('gives a new item a fresh ulid and drops lines of items no longer outstanding', () => {
		const current: AddEntryLine[] = [
			{ lineId: 'L1', item_id: 'item_master:a', qty: '2', operationUlid: 'OP1' },
			{ lineId: 'L2', item_id: 'item_master:gone', qty: '1', operationUlid: 'OP2' }
		];
		const result = linesFromOutstandingLoans(
			[loanRow('l1', 'item_master:a', '2'), loanRow('l2', 'item_master:b', '1')],
			new Set(['item_master:a', 'item_master:b']),
			makeFrom(),
			current
		);
		expect(result.lines.map((l) => [l.item_id, l.operationUlid])).toEqual([
			['item_master:a', 'OP1'],
			['item_master:b', 'ULID1']
		]);
	});

	it('lists only sent lines whose qty would change for the written-entries lookup', () => {
		const current: AddEntryLine[] = [
			{ lineId: 'L1', item_id: 'item_master:a', qty: '2', operationUlid: 'OP1' },
			{ lineId: 'L2', item_id: 'item_master:b', qty: '1', operationUlid: 'OP2' },
			{ lineId: 'L3', item_id: 'item_master:c', qty: '1', operationUlid: 'OP3' }
		];
		const rows = [
			loanRow('l1', 'item_master:a', '3'),
			loanRow('l2', 'item_master:b', '1'),
			loanRow('l3', 'item_master:c', '4')
		];
		const eligible = new Set(['item_master:a', 'item_master:b', 'item_master:c']);
		// a: sent + changed; b: sent but unchanged; c: changed but never sent
		expect(ulidsNeedingWrittenLookup(rows, eligible, current, new Set(['OP1', 'OP2']))).toEqual([
			'OP1'
		]);
		expect(ulidsNeedingWrittenLookup(rows, eligible, current, new Set())).toEqual([]);
	});

	it('preserves relocated lines and does not reuse them for the same item', () => {
		const current: AddEntryLine[] = [
			{ lineId: 'L1', item_id: 'item_master:a', qty: '2', operationUlid: 'OP1', relocated: 'moved' }
		];
		const result = linesFromOutstandingLoans(
			[loanRow('l1', 'item_master:a', '2')],
			new Set(['item_master:a']),
			makeFrom(),
			current
		);
		expect(result.lines).toHaveLength(2);
		expect(result.lines[0]).toMatchObject({ item_id: 'item_master:a', operationUlid: 'ULID1' });
		expect(result.lines[0].relocated).toBeUndefined();
		expect(result.lines[1]).toEqual(current[0]);
	});

	it('is stable when called twice in a row', () => {
		const rows = [loanRow('l1', 'item_master:a', '2'), loanRow('l2', 'item_master:b', '1')];
		const eligible = new Set(['item_master:a', 'item_master:b']);
		const make = makeFrom();
		const first = linesFromOutstandingLoans(rows, eligible, make, []);
		const second = linesFromOutstandingLoans(rows, eligible, make, first.lines);
		expect(second.lines).toEqual(first.lines);
	});

	it('returns nothing for no rows', () => {
		expect(linesFromOutstandingLoans([], new Set(['item_master:a']), makeFrom())).toEqual({
			lines: [],
			skippedItemIds: [],
			keptAtWrittenQtyItemIds: []
		});
	});
});

describe('lines', () => {
	it('creates one id per line and keeps it when other lines change', () => {
		const next = counter();
		let lines = addLine([], next);
		lines = addLine(lines, next, { item_id: 'item_master:a', qty: '2' });
		expect(lines.map((l) => l.operationUlid)).toEqual(['ULID1', 'ULID2']);
		expect(lines[1]).toMatchObject({ item_id: 'item_master:a', qty: '2' });
		lines = removeLine(lines, 'ULID1');
		expect(lines.map((l) => l.operationUlid)).toEqual(['ULID2']);
	});
});

describe('resolveDefaultPoolId', () => {
	const two = [{ _id: 'pool:a' }, { _id: 'pool:b' }];

	it('prefers the picked pool over the remembered one', () => {
		expect(resolveDefaultPoolId({ picked: 'pool:a', remembered: 'pool:b', openPools: two })).toBe(
			'pool:a'
		);
	});

	it('uses the remembered pool when nothing is picked', () => {
		expect(resolveDefaultPoolId({ picked: '', remembered: 'pool:b', openPools: two })).toBe(
			'pool:b'
		);
	});

	it('ignores a stale remembered id that no longer exists', () => {
		expect(resolveDefaultPoolId({ picked: '', remembered: 'pool:gone', openPools: two })).toBe('');
	});

	it('ignores a remembered pool that is not open', () => {
		expect(
			resolveDefaultPoolId({
				picked: '',
				remembered: 'pool:closed',
				openPools: [{ _id: 'pool:a' }]
			})
		).toBe('pool:a');
	});

	it('ignores a picked pool that is not open and falls back to remembered', () => {
		expect(resolveDefaultPoolId({ picked: 'pool:x', remembered: 'pool:b', openPools: two })).toBe(
			'pool:b'
		);
	});

	it('falls back to the only open pool', () => {
		expect(
			resolveDefaultPoolId({ picked: '', remembered: null, openPools: [{ _id: 'pool:a' }] })
		).toBe('pool:a');
	});

	it('returns empty when several pools are open and nothing applies', () => {
		expect(resolveDefaultPoolId({ picked: '', remembered: null, openPools: two })).toBe('');
		expect(resolveDefaultPoolId({ picked: '', remembered: null, openPools: [] })).toBe('');
	});
});

describe('validateAddEntryLines', () => {
	it('requires at least one line', () => {
		const result = validateAddEntryLines([]);
		expect(result.isValid).toBe(false);
		expect(result.formError).toBeTruthy();
	});

	it('requires an item and a positive whole qty', () => {
		const result = validateAddEntryLines([
			line('1', '', '2'),
			line('2', 'item_master:a', '0'),
			line('3', 'item_master:b', '1.5'),
			line('4', 'item_master:c', '3')
		]);
		expect(result.isValid).toBe(false);
		expect(Object.keys(result.lineErrors).sort()).toEqual(['1', '2', '3']);
	});

	it('blocks a duplicate item with an error on the later line', () => {
		const result = validateAddEntryLines([
			line('1', 'item_master:a', '2'),
			line('2', 'item_master:a', '3')
		]);
		expect(result.isValid).toBe(false);
		expect(result.lineErrors['1']).toBeUndefined();
		expect(result.lineErrors['2']).toContain('อยู่ในรายการแล้ว');
	});

	it('accepts valid distinct lines', () => {
		expect(
			validateAddEntryLines([line('1', 'item_master:a', '2'), line('2', 'item_master:b', '3')])
				.isValid
		).toBe(true);
	});
});

describe('resolveReturner', () => {
	it('maps evacuee and volunteer selections', () => {
		expect(
			resolveReturner({ recipientType: 'evacuee', recipientId: 'evacuee:1', label: 'A' }).returner
		).toEqual({ type: 'evacuee', id: 'evacuee:1' });
		expect(
			resolveReturner({ recipientType: 'volunteer', recipientId: 'volunteer:1', label: 'V' })
				.returner
		).toEqual({ type: 'volunteer', id: 'volunteer:1' });
	});

	it('maps unspecified, and rejects null and outside', () => {
		expect(resolveReturner('unspecified').returner).toEqual({ type: 'unspecified' });
		expect(resolveReturner(null).error).toBeTruthy();
		expect(
			resolveReturner({ recipientType: 'outside', recipientId: null, label: 'x' }).error
		).toBeTruthy();
	});

	it('rejects a staff recipient as a returner because staff only receive consumables', () => {
		const staff: ReturnerChoice = {
			recipientType: 'staff',
			recipientId: 'user:somchai',
			label: 'Somchai'
		};
		const resolved = resolveReturner(staff);
		expect(resolved.error).toBeTruthy();
		expect(resolved.returner).toBeUndefined();
		expect(identifiedReturnerId(staff)).toBeNull();
	});

	it('exposes the id only for identified returners', () => {
		expect(identifiedReturnerId('unspecified')).toBeNull();
		expect(identifiedReturnerId(null)).toBeNull();
		expect(
			identifiedReturnerId({ recipientType: 'evacuee', recipientId: 'evacuee:1', label: 'A' })
		).toBe('evacuee:1');
	});
});

describe('buildAddEntriesInput', () => {
	it('canonicalises qty, trims notes and keeps the line operationUlids', () => {
		const input = buildAddEntriesInput({
			poolId: 'bulk_return_pool:p',
			returner: { type: 'unspecified' },
			lines: [line('U1', 'item_master:a', '050')],
			notes: '  ok  '
		});
		expect(input).toEqual({
			pool_id: 'bulk_return_pool:p',
			returner: { type: 'unspecified' },
			items: [{ item_id: 'item_master:a', qty: '50', operationUlid: 'U1' }],
			notes: 'ok'
		});
	});

	it('omits empty notes and returns null for invalid lines', () => {
		const ok = buildAddEntriesInput({
			poolId: 'p',
			returner: { type: 'unspecified' },
			lines: [line('U1', 'item_master:a', '1')],
			notes: '  '
		});
		expect(ok).not.toHaveProperty('notes');
		expect(
			buildAddEntriesInput({
				poolId: 'p',
				returner: { type: 'unspecified' },
				lines: [line('U1', '', '1')]
			})
		).toBeNull();
	});
});

describe('filterEligibleItems', () => {
	it('keeps every returnable item, including deactivated ones, and drops non-returnable', () => {
		const result = filterEligibleItems([
			{ _id: 'a', name: 'พัดลม', returnable: true },
			{ _id: 'b', name: 'ผ้าห่ม', returnable: false },
			{ _id: 'c', name: 'เต็นท์', returnable: true, deactivated: true },
			{ _id: 'd', name: 'เก้าอี้', returnable: true, merged_into: 'a' },
			{ _id: 'e', name: 'กะละมัง', returnable: true, base_unit: 'ใบ' }
		]);
		expect(result.map((i) => i._id).sort()).toEqual(['a', 'c', 'd', 'e']);
	});

	it('marks deactivated items in the label only', () => {
		const result = filterEligibleItems([
			{ _id: 'a', name: 'พัดลม', returnable: true },
			{ _id: 'c', name: 'เต็นท์', returnable: true, deactivated: true }
		]);
		expect(result.find((i) => i._id === 'c')?.name).toBe('เต็นท์ (เลิกใช้)');
		expect(result.find((i) => i._id === 'a')?.name).toBe('พัดลม');
	});
});

describe('outstandingLoanRows', () => {
	const loan = (id: string, qty: string, qty_returned?: string): DistributionLog =>
		({
			_id: id,
			item_id: 'item_master:fan',
			qty,
			qty_returned,
			distributed_at: '2026-09-24T08:00:00.000Z'
		}) as DistributionLog;

	it('computes outstanding qty and skips fully returned loans', () => {
		const rows = outstandingLoanRows(
			[loan('l1', '5', '2'), loan('l2', '3', '3'), loan('l3', '1')],
			[{ _id: 'item_master:fan', name: 'พัดลม', base_unit: 'เครื่อง' }]
		);
		expect(rows.map((r) => [r.logId, r.outstanding])).toEqual([
			['l1', '3'],
			['l3', '1']
		]);
		expect(rows[0]).toMatchObject({ itemName: 'พัดลม', unit: 'เครื่อง' });
	});

	it('falls back to a cleaned item id', () => {
		expect(outstandingLoanRows([loan('l1', '1')], [])[0].itemName).toBe('fan');
	});
});

describe('hasNoOutstandingLoanWarning', () => {
	const evacuee = { type: 'evacuee', id: 'evacuee:1' } as const;
	it('warns only for an identified returner with a settled empty result', () => {
		expect(hasNoOutstandingLoanWarning(evacuee, [], false)).toBe(true);
		expect(hasNoOutstandingLoanWarning(evacuee, [], true)).toBe(false);
		expect(hasNoOutstandingLoanWarning(evacuee, [{}], false)).toBe(false);
		expect(hasNoOutstandingLoanWarning({ type: 'unspecified' }, [], false)).toBe(false);
		expect(hasNoOutstandingLoanWarning(null, [], false)).toBe(false);
	});
});

describe('summarizeAddResult / dropWrittenLines', () => {
	function res(
		ulid: string,
		opts: {
			late?: boolean;
			replayed?: boolean;
			refs?: string[];
			unallocated?: string;
			returner?: string | null;
			relocated?: 'moved' | 'pending_sync';
			loanPending?: boolean;
			voided?: boolean;
			reopened?: boolean;
			poolId?: string;
		} = {}
	) {
		return {
			entry: {
				_id: `bulk_return_entry:${ulid}`,
				pool_id: opts.poolId ?? 'bulk_return_pool:p',
				item_id: `item_master:${ulid}`,
				returner_id: opts.returner === undefined ? 'evacuee:1' : opts.returner,
				loan_refs: (opts.refs ?? []).map((qty) => ({ distribution_log_id: 'l', qty }))
			},
			late: opts.late ?? false,
			replayed: opts.replayed ?? false,
			loansApplied: [],
			loansSkipped: [],
			unallocated_qty: opts.unallocated ?? '0',
			...(opts.relocated ? { relocated: opts.relocated } : {}),
			...(opts.loanPending ? { loan_pending: true } : {}),
			...(opts.voided ? { voided: true } : {}),
			...(opts.reopened ? { loans_reopened: true } : {})
		};
	}
	const wrap = (
		results: ReturnType<typeof res>[],
		no_outstanding_loan = false,
		blocked?: { pool_id: string; reason: 'closed' | 'locked' }
	): AddBulkReturnEntriesResult =>
		({
			results,
			...(blocked ? { blocked } : {}),
			returner_had_outstanding_loans: true,
			no_outstanding_loan
		}) as unknown as AddBulkReturnEntriesResult;

	it('reports loan-pending items, which cut no loan yet', () => {
		const summary = summarizeAddResult(
			wrap([
				res('A', { refs: ['2'] }),
				res('B', { refs: ['4'], loanPending: true, unallocated: '1' })
			])
		);
		expect(summary.savedCount).toBe(2);
		expect(summary.loanPendingItemIds).toEqual(['item_master:B']);
		expect(summary.loanAppliedQty).toBe('2');
		expect(summary.unallocated).toEqual([]);
	});

	it('does not count a reopened replay as applied or unallocated, but still as replayed', () => {
		const summary = summarizeAddResult(
			wrap([res('A', { replayed: true, refs: ['3'], unallocated: '2', reopened: true })])
		);
		expect(summary.replayedCount).toBe(1);
		expect(summary.savedCount).toBe(0);
		expect(summary.loanAppliedQty).toBeUndefined();
		expect(summary.unallocated).toEqual([]);
	});

	it('applies only the normal cut line when mixed with a reopened line', () => {
		const summary = summarizeAddResult(
			wrap([
				res('A', { refs: ['2'], unallocated: '1' }),
				res('B', { replayed: true, refs: ['5'], unallocated: '4', reopened: true })
			])
		);
		expect(summary.savedCount).toBe(1);
		expect(summary.replayedCount).toBe(1);
		expect(summary.loanAppliedQty).toBe('2');
		expect(summary.unallocated).toEqual([{ item_id: 'item_master:A', qty: '1' }]);
	});

	it('counts on-time reopened lines in loansReopenedCount, not late, relocated or voided ones', () => {
		const summary = summarizeAddResult(
			wrap([
				res('A', { reopened: true }),
				res('B', { replayed: true, reopened: true }),
				res('C', { refs: ['2'] }),
				res('D', { late: true, reopened: true }),
				res('E', { relocated: 'moved', reopened: true }),
				res('F', { voided: true, reopened: true })
			])
		);
		expect(summary.loansReopenedCount).toBe(2);
		expect(summary.savedCount).toBe(2);
		expect(summary.replayedCount).toBe(1);
		expect(summarizeAddResult(wrap([res('A')])).loansReopenedCount).toBe(0);
	});

	it('wroteIntoPool: a new line or a replay in the submitted pool counts', () => {
		const pool = 'bulk_return_pool:p';
		expect(wroteIntoPool(wrap([res('A')]), pool)).toBe(true);
		expect(wroteIntoPool(wrap([res('A', { replayed: true })]), pool)).toBe(true);
		// A new line is written into the submitted pool whatever its entry says.
		expect(wroteIntoPool(wrap([res('A', { poolId: 'bulk_return_pool:other' })]), pool)).toBe(true);
	});

	it('wroteIntoPool: replays into another pool, late, relocated, voided or none do not count', () => {
		const pool = 'bulk_return_pool:p';
		const other = 'bulk_return_pool:other';
		expect(wroteIntoPool(wrap([res('A', { replayed: true, poolId: other })]), pool)).toBe(false);
		expect(wroteIntoPool(wrap([res('A', { late: true })]), pool)).toBe(false);
		expect(wroteIntoPool(wrap([res('A', { relocated: 'moved' })]), pool)).toBe(false);
		expect(wroteIntoPool(wrap([res('A', { voided: true })]), pool)).toBe(false);
		expect(wroteIntoPool(wrap([]), pool)).toBe(false);
		expect(wroteIntoPool(wrap([res('A', { replayed: true, poolId: other }), res('B')]), pool)).toBe(
			true
		);
	});

	it('counts voided entries apart from saved ones', () => {
		const summary = summarizeAddResult(
			wrap([res('A', { refs: ['2'] }), res('B', { voided: true })])
		);
		expect(summary.savedCount).toBe(1);
		expect(summary.voidedCount).toBe(1);
		expect(summary.loanAppliedQty).toBe('2');
	});

	it('passes the blocked pool through and omits it otherwise', () => {
		const blocked = { pool_id: 'bulk_return_pool:p', reason: 'closed' as const };
		expect(summarizeAddResult(wrap([res('A')], false, blocked)).blocked).toEqual(blocked);
		const plain = summarizeAddResult(wrap([res('A')]));
		expect(plain).not.toHaveProperty('blocked');
		expect(plain.loanPendingItemIds).toEqual([]);
		expect(plain.voidedCount).toBe(0);
	});

	it('explains why lines remain: blocked, loan-pending stop, or a late entry', () => {
		const pool_id = 'bulk_return_pool:p';
		const message = (result: AddBulkReturnEntriesResult) =>
			remainingLinesMessage(summarizeAddResult(result), result, pool_id);
		const closed = message(wrap([], false, { pool_id, reason: 'closed' }));
		expect(closed).toContain('เลือกกองอื่นที่เปิดรับ');
		const locked = message(wrap([], false, { pool_id, reason: 'locked' }));
		expect(locked).toContain('รอสักครู่');
		const pending = message(wrap([res('A', { loanPending: true })]));
		expect(pending).toContain('รอสักครู่');
		expect(pending).not.toBe(locked);
		const late = message(wrap([res('A', { late: true })]));
		expect(late).toContain('เลือกกองอื่นที่เปิดรับ');
	});

	it('only a loan-pending line in the submitted pool is a loan-pending stop', () => {
		const pool_id = 'bulk_return_pool:p';
		const other = 'bulk_return_pool:other';
		const message = (result: AddBulkReturnEntriesResult) =>
			remainingLinesMessage(summarizeAddResult(result), result, pool_id);
		const inPool = message(wrap([res('A', { loanPending: true })]));
		const otherPoolReplayThenLate = message(
			wrap([
				res('A', { loanPending: true, replayed: true, poolId: other }),
				res('B', { late: true })
			])
		);
		expect(otherPoolReplayThenLate).toContain('เลือกกองอื่นที่เปิดรับ');
		expect(otherPoolReplayThenLate).not.toBe(inPool);
		expect(inPool).toContain('รอสักครู่');
	});

	it('names the items of a loan-pending warning and where to repair them', () => {
		const text = loanPendingWarning(['พัดลม', 'ผ้าห่ม']);
		expect(text).toContain('ยอดยืมของรายการนี้ยังไม่ถูกตัด');
		expect(text).toContain('พัดลม, ผ้าห่ม');
		expect(text).toContain('ตัดยอดยืมที่ค้าง');
	});

	it('counts saved, replayed and late and totals applied loan qty', () => {
		const summary = summarizeAddResult(
			wrap([
				res('A', { refs: ['2', '1'], unallocated: '1' }),
				res('B', { replayed: true }),
				res('C', { late: true })
			])
		);
		expect(summary.savedCount).toBe(1);
		expect(summary.replayedCount).toBe(1);
		expect(summary.lateEntries).toHaveLength(1);
		expect(summary.loanAppliedQty).toBe('3');
		expect(summary.unallocated).toEqual([{ item_id: 'item_master:A', qty: '1' }]);
	});

	it('does not report unallocated qty for an unspecified returner and passes the warning flag', () => {
		const summary = summarizeAddResult(
			wrap([res('A', { returner: null, unallocated: '4' })], true)
		);
		expect(summary.unallocated).toEqual([]);
		expect(summary.noOutstandingLoan).toBe(true);
		expect(summary.loanAppliedQty).toBeUndefined();
	});

	it('drops written lines (late included) and keeps unwritten ones', () => {
		const lines = [line('A', 'item_master:A', '1'), line('B', 'item_master:B', '1')];
		const remaining = dropWrittenLines(lines, wrap([res('A', { late: true })]));
		expect(remaining.map((l) => l.lineId)).toEqual(['B']);
		expect(dropWrittenLines(lines, wrap([res('A'), res('B')]))).toEqual([]);
	});

	it('counts relocated lines separately, not as saved or late', () => {
		const summary = summarizeAddResult(
			wrap([
				res('A', { refs: ['2'] }),
				res('B', { relocated: 'moved' }),
				res('C', { relocated: 'pending_sync' })
			])
		);
		expect(summary.savedCount).toBe(1);
		expect(summary.replayedCount).toBe(0);
		expect(summary.lateEntries).toHaveLength(0);
		expect(summary.loanAppliedQty).toBe('2');
		expect(summary.relocated).toEqual([
			{ item_id: 'item_master:B', kind: 'moved' },
			{ item_id: 'item_master:C', kind: 'pending_sync' }
		]);
	});

	it('keeps a relocated line flagged done and never resubmits it', () => {
		const lines = [line('A', 'item_master:A', '1'), line('B', 'item_master:B', '2')];
		const remaining = dropWrittenLines(lines, wrap([res('A', { relocated: 'moved' }), res('B')]));
		expect(remaining).toEqual([{ ...lines[0], relocated: 'moved' }]);

		const input = buildAddEntriesInput({
			poolId: 'p',
			returner: { type: 'unspecified' },
			lines: [...remaining, line('C', 'item_master:C', '3')]
		});
		expect(input?.items.map((i) => i.operationUlid)).toEqual(['C']);
		// A later call does not touch the flag; relocated lines are not validated.
		expect(dropWrittenLines(remaining, wrap([])).map((l) => l.relocated)).toEqual(['moved']);
		expect(validateAddEntryLines(remaining).isValid).toBe(false);
		expect(validateAddEntryLines([...remaining, line('D', 'item_master:A', '1')]).isValid).toBe(
			true
		);
	});
});
