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
	summarizeAddResult,
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

	it('returns nothing for no rows', () => {
		expect(linesFromOutstandingLoans([], new Set(['item_master:a']), makeFrom())).toEqual({
			lines: [],
			skippedItemIds: []
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
		} = {}
	) {
		return {
			entry: {
				_id: `bulk_return_entry:${ulid}`,
				item_id: `item_master:${ulid}`,
				returner_id: opts.returner === undefined ? 'evacuee:1' : opts.returner,
				loan_refs: (opts.refs ?? []).map((qty) => ({ distribution_log_id: 'l', qty }))
			},
			late: opts.late ?? false,
			replayed: opts.replayed ?? false,
			loansApplied: [],
			loansSkipped: [],
			unallocated_qty: opts.unallocated ?? '0',
			...(opts.relocated ? { relocated: opts.relocated } : {})
		};
	}
	const wrap = (
		results: ReturnType<typeof res>[],
		no_outstanding_loan = false
	): AddBulkReturnEntriesResult =>
		({
			results,
			returner_had_outstanding_loans: true,
			no_outstanding_loan
		}) as unknown as AddBulkReturnEntriesResult;

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
