import { describe, expect, it } from 'vitest';
import type { BulkReturnPoolOverviewRow, BulkReturnPoolV3 } from '../../domain/food-supplies';
import {
	DISCREPANCY_REASON_LABELS,
	DISCREPANCY_REASON_OPTIONS,
	SUBMIT_EMPTY_REASON,
	SUBMIT_NOT_OPEN_REASON,
	buildReceiveInput,
	canSubmitPool,
	countMismatchedLines,
	getSubmitBlockedReason,
	initReceiveLines,
	isLineMismatched,
	liveSummaryRows,
	receiveRecordRows,
	receiveTotals,
	receivedStorageLabel,
	submittedSummaryRows,
	validateReceiveLines,
	type ReceiveLine
} from './bulk-return-lifecycle';
import { POOL_LOCKED_REASON } from './bulk-return-pool-v3';

function makePool(overrides: Partial<BulkReturnPoolV3> = {}): BulkReturnPoolV3 {
	return {
		_id: 'bulk_return_pool:a',
		type: 'bulk_return_pool',
		schema_v: 3,
		shelter_code: 'SH001',
		created_at: '2026-09-24T08:00:00.000Z',
		updated_at: '2026-09-24T08:00:00.000Z',
		created_by: 'staff',
		name: 'Pool a',
		status: 'OPEN',
		...overrides
	} as BulkReturnPoolV3;
}

function makeRow(
	pool: BulkReturnPoolV3,
	opts: { empty?: boolean } = {}
): BulkReturnPoolOverviewRow {
	const empty = opts.empty ?? false;
	return {
		pool,
		entry_count: empty ? 0 : 1,
		items: empty ? [] : [{ item_id: 'item_master:fan', qty: '3' }],
		entries: [],
		late_entries: [],
		unresolved_refs: [],
		closed_loan_refs: [],
		is_empty: empty
	} as BulkReturnPoolOverviewRow;
}

const catalog = [{ _id: 'item_master:fan', name: 'พัดลม', base_unit: 'ตัว' }];
const points = [
	{ id: 'sp-1', name: 'โกดัง A' },
	{ id: 'sp-2', name: 'โกดัง B' }
];

function line(overrides: Partial<ReceiveLine> = {}): ReceiveLine {
	return {
		item_id: 'item_master:fan',
		expected_qty: '5',
		received_qty: '5',
		reason: '',
		note: '',
		...overrides
	};
}

describe('discrepancy reasons', () => {
	it('labels every reason in Thai', () => {
		expect(DISCREPANCY_REASON_LABELS).toEqual({
			damaged: 'ชำรุด',
			missing: 'สูญหาย',
			miscount: 'นับผิด',
			other: 'อื่น ๆ'
		});
	});

	it('lists options in a stable order', () => {
		expect(DISCREPANCY_REASON_OPTIONS.map((o) => o.value)).toEqual([
			'damaged',
			'missing',
			'miscount',
			'other'
		]);
		expect(DISCREPANCY_REASON_OPTIONS[3].label).toBe('อื่น ๆ');
	});
});

describe('submit capability', () => {
	it('allows a non-empty OPEN unlocked pool', () => {
		const row = makeRow(makePool());
		expect(canSubmitPool(row)).toBe(true);
		expect(getSubmitBlockedReason(row)).toBeNull();
	});

	it('blocks an empty pool with the cancel hint', () => {
		const row = makeRow(makePool(), { empty: true });
		expect(canSubmitPool(row)).toBe(false);
		expect(getSubmitBlockedReason(row)).toBe(SUBMIT_EMPTY_REASON);
	});

	it('blocks a locked pool with the in-progress copy', () => {
		const lock = {
			op: 'SUBMIT',
			op_id: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
			locked_at: '2026-09-24T08:00:00.000Z',
			locked_by: 'staff'
		} as const;
		const row = makeRow(makePool({ lock }));
		expect(canSubmitPool(row)).toBe(false);
		expect(getSubmitBlockedReason(row)).toBe(POOL_LOCKED_REASON);
	});

	it('blocks a non-OPEN pool', () => {
		const row = makeRow(makePool({ status: 'SUBMITTED' }));
		expect(canSubmitPool(row)).toBe(false);
		expect(getSubmitBlockedReason(row)).toBe(SUBMIT_NOT_OPEN_REASON);
	});
});

describe('summary rows', () => {
	it('resolves live rows with catalog names', () => {
		expect(liveSummaryRows(makeRow(makePool()), catalog)).toEqual([
			{ item_id: 'item_master:fan', qty: '3', name: 'พัดลม', unit: 'ตัว' }
		]);
	});

	it('uses the submit snapshot and falls back to the id when uncatalogued', () => {
		const pool = makePool({
			status: 'SUBMITTED',
			items_summary: [{ item_id: 'item_master:lamp', qty: '2' }]
		});
		expect(submittedSummaryRows(pool, catalog)).toEqual([
			{ item_id: 'item_master:lamp', qty: '2', name: 'lamp', unit: '' }
		]);
		expect(submittedSummaryRows(makePool(), catalog)).toEqual([]);
	});
});

describe('initReceiveLines', () => {
	it('prefills received with expected, no reason or note', () => {
		expect(
			initReceiveLines([
				{ item_id: 'a', qty: '4' },
				{ item_id: 'b', qty: '1' }
			])
		).toEqual([
			{ item_id: 'a', expected_qty: '4', received_qty: '4', reason: '', note: '' },
			{ item_id: 'b', expected_qty: '1', received_qty: '1', reason: '', note: '' }
		]);
	});
});

describe('isLineMismatched', () => {
	it('is false when matched or when the qty is not a valid integer', () => {
		expect(isLineMismatched(line())).toBe(false);
		expect(isLineMismatched(line({ received_qty: '' }))).toBe(false);
		expect(isLineMismatched(line({ received_qty: 'abc' }))).toBe(false);
		expect(isLineMismatched(line({ received_qty: '2.5' }))).toBe(false);
	});

	it('is true for a valid different integer (incl. leading zeros and 0)', () => {
		expect(isLineMismatched(line({ received_qty: '3' }))).toBe(true);
		expect(isLineMismatched(line({ received_qty: '0' }))).toBe(true);
		expect(isLineMismatched(line({ received_qty: '05' }))).toBe(false);
	});

	it('counts mismatched lines', () => {
		expect(countMismatchedLines([line(), line({ received_qty: '1' })])).toBe(1);
	});
});

describe('validateReceiveLines', () => {
	const noStorage = { storagePointId: '', points: [] };

	it('is valid when every line matches and no points exist', () => {
		expect(validateReceiveLines([line()], noStorage)).toEqual({ isValid: true, lineErrors: {} });
	});

	it('rejects non-integer, negative, empty and over-expected qty', () => {
		for (const received_qty of ['', 'x', '-1', '1.5', '6']) {
			const result = validateReceiveLines([line({ received_qty })], noStorage);
			expect(result.isValid).toBe(false);
			expect(result.lineErrors['item_master:fan'].received_qty).toBe(
				'กรอกจำนวนเต็มตั้งแต่ 0 ถึง 5'
			);
		}
	});

	it('requires a reason on mismatch', () => {
		const result = validateReceiveLines([line({ received_qty: '3' })], noStorage);
		expect(result.lineErrors['item_master:fan']).toEqual({ reason: 'เลือกเหตุผลของส่วนต่าง' });
	});

	it('requires a note for other, treating whitespace as blank', () => {
		const result = validateReceiveLines(
			[line({ received_qty: '3', reason: 'other', note: '  ' })],
			noStorage
		);
		expect(result.lineErrors['item_master:fan']).toEqual({
			note: 'ระบุรายละเอียดเมื่อเลือก "อื่น ๆ"'
		});
		expect(
			validateReceiveLines([line({ received_qty: '3', reason: 'other', note: 'ขาด' })], noStorage)
				.isValid
		).toBe(true);
		expect(
			validateReceiveLines([line({ received_qty: '0', reason: 'damaged' })], noStorage).isValid
		).toBe(true);
	});

	it('requires a storage point only when points exist', () => {
		const missing = validateReceiveLines([line()], { storagePointId: '', points });
		expect(missing.isValid).toBe(false);
		expect(missing.storage).toBe('เลือกจุดเก็บของ');
		expect(validateReceiveLines([line()], { storagePointId: 'sp-gone', points }).storage).toBe(
			'เลือกจุดเก็บของ'
		);
		expect(validateReceiveLines([line()], { storagePointId: 'sp-2', points })).toEqual({
			isValid: true,
			lineErrors: {}
		});
	});

	it('reports errors per item', () => {
		const lines = [
			line({ item_id: 'a', received_qty: '9' }),
			line({ item_id: 'b' }),
			line({ item_id: 'c', received_qty: '1' })
		];
		const result = validateReceiveLines(lines, noStorage);
		expect(Object.keys(result.lineErrors)).toEqual(['a', 'c']);
	});
});

describe('buildReceiveInput', () => {
	it('drops reason and note on matched lines', () => {
		const input = buildReceiveInput([line({ reason: 'damaged', note: 'x' })], null);
		expect(input).toEqual({
			items: [{ item_id: 'item_master:fan', received_qty: '5' }],
			storagePoint: null
		});
	});

	it('keeps reason and trims note on mismatched lines; blank note is undefined', () => {
		const input = buildReceiveInput(
			[
				line({ item_id: 'a', received_qty: '2', reason: 'other', note: '  แตก  ' }),
				line({ item_id: 'b', received_qty: '0', reason: 'missing', note: '   ' })
			],
			{ id: 'sp-1', name: 'โกดัง A' }
		);
		expect(input.items).toEqual([
			{
				item_id: 'a',
				received_qty: '2',
				discrepancy_reason: 'other',
				discrepancy_note: 'แตก'
			},
			{
				item_id: 'b',
				received_qty: '0',
				discrepancy_reason: 'missing',
				discrepancy_note: undefined
			}
		]);
		expect(input.storagePoint).toEqual({ id: 'sp-1', name: 'โกดัง A' });
	});

	it('normalizes the typed qty', () => {
		const input = buildReceiveInput([line({ received_qty: ' 05 ' })], null);
		expect(input.items[0].received_qty).toBe('5');
	});
});

describe('receiveTotals', () => {
	it('sums expected and valid received qty', () => {
		const lines = [
			line(),
			line({ expected_qty: '2', received_qty: '1' }),
			line({ received_qty: 'x' })
		];
		expect(receiveTotals(lines)).toEqual({ expected: 12, received: 6 });
	});
});

describe('receive record', () => {
	const pool = makePool({
		status: 'RECEIVED',
		received_items: [
			{ item_id: 'item_master:fan', expected_qty: '5', received_qty: '5' },
			{
				item_id: 'item_master:lamp',
				expected_qty: '4',
				received_qty: '1',
				discrepancy_reason: 'other',
				discrepancy_note: 'แตก'
			}
		]
	});

	it('maps rows with diff, reason label and note', () => {
		expect(receiveRecordRows(pool, catalog)).toEqual([
			{
				item_id: 'item_master:fan',
				name: 'พัดลม',
				unit: 'ตัว',
				expected: '5',
				received: '5',
				diff: 0,
				reasonLabel: null,
				note: null,
				mismatched: false
			},
			{
				item_id: 'item_master:lamp',
				name: 'lamp',
				unit: '',
				expected: '4',
				received: '1',
				diff: 3,
				reasonLabel: 'อื่น ๆ',
				note: 'แตก',
				mismatched: true
			}
		]);
		expect(receiveRecordRows(makePool(), catalog)).toEqual([]);
	});

	it('labels the received storage with the main-store fallback', () => {
		expect(receivedStorageLabel({ received_storage_zone: 'โกดัง A' })).toBe('โกดัง A');
		expect(receivedStorageLabel({})).toBe('คลังหลัก');
		expect(receivedStorageLabel({ received_storage_zone: '  ' })).toBe('คลังหลัก');
	});
});
