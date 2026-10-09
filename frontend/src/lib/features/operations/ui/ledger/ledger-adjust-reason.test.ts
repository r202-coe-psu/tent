import { describe, expect, it } from 'vitest';
import type { StockLedger } from '../../domain/operations';
import {
	ADJUST_REASON_LABELS,
	buildLedgerRows,
	filterLedger,
	ledgerToCsv,
	toLedgerRow,
	type LedgerLookup
} from './ledger-view';
import { LEDGER_URL_DEFAULTS, parseLedgerParams, serializeLedgerParams } from './ledger-url-state';

// CR-143 §C FR-C4 / FR-C5 — the movements view shows (and filters by) the adjust reason.
const lookup: LedgerLookup = {
	itemName: () => 'น้ำดื่ม',
	unitLabel: (u) => u,
	points: []
};

const at = (day: number, h: number) => new Date(2026, 9, day, h, 0).toISOString();

let seq = 0;
function entry(over: Partial<StockLedger> & Pick<StockLedger, 'reason' | 'qty'>): StockLedger {
	seq += 1;
	return {
		_id: `stock_ledger:${String(seq).padStart(3, '0')}`,
		type: 'stock_ledger',
		schema_v: 6,
		item_id: 'water',
		unit: 'pack',
		ref_id: null,
		occurred_at: at(2, 10),
		created_by: 'somchai',
		...over
	} as StockLedger;
}

const expired = entry({
	reason: 'adjust',
	qty: '-4',
	adjust_reason: 'expired',
	note: 'หมดอายุ 1 ตุลาคม',
	occurred_at: at(2, 11)
});
const lost = entry({ reason: 'adjust', qty: '-1', adjust_reason: 'lost', occurred_at: at(2, 10) });
const legacy = entry({
	reason: 'adjust',
	qty: '-2',
	schema_v: 5 as StockLedger['schema_v'],
	occurred_at: at(2, 9)
});
const received = entry({
	reason: 'donation',
	qty: '10',
	ref_id: 'donation:DN-1',
	occurred_at: at(2, 8)
});

describe('toLedgerRow adjust reason', () => {
	it('exposes the reason, its label and the note', () => {
		const row = toLedgerRow(expired, lookup);
		expect(row.adjustReason).toBe('expired');
		expect(row.adjustReasonLabel).toBe(ADJUST_REASON_LABELS.expired);
		expect(row.detail).toBe(`${ADJUST_REASON_LABELS.expired} · หมดอายุ 1 ตุลาคม`);
	});

	it('shows the label alone when there is no note', () => {
		expect(toLedgerRow(lost, lookup).detail).toBe(ADJUST_REASON_LABELS.lost);
	});

	it('reads a schema_v 5 adjust row (no adjust_reason) as other (FR-C4)', () => {
		const row = toLedgerRow(legacy, lookup);
		expect(row.adjustReason).toBe('other');
		expect(row.detail).toBe(ADJUST_REASON_LABELS.other);
	});

	it('leaves non-adjust rows without a reason', () => {
		const row = toLedgerRow(received, lookup);
		expect(row.adjustReason).toBeNull();
		expect(row.adjustReasonLabel).toBe('');
		expect(row.detail).toBe('donation:DN-1');
	});

	it('labels every persisted reason', () => {
		for (const key of ['expired', 'damaged', 'count_mismatch', 'lost', 'found', 'merge', 'other']) {
			expect(ADJUST_REASON_LABELS[key as keyof typeof ADJUST_REASON_LABELS]).toBeTruthy();
		}
	});

	it('exports the reason in the CSV reason/destination column', () => {
		const csv = ledgerToCsv(buildLedgerRows([expired], lookup));
		expect(csv).toContain(ADJUST_REASON_LABELS.expired);
		expect(csv).toContain('หมดอายุ 1 ตุลาคม');
	});
});

describe('filterLedger by adjust reason (FR-C5)', () => {
	const rows = buildLedgerRows([expired, lost, legacy, received], lookup);
	const open = { from: null, to: null };

	it('keeps only rows with the chosen reason', () => {
		const out = filterLedger(rows, { range: open, type: 'all', q: '', reason: 'expired' });
		expect(out.map((r) => r.id)).toEqual([expired._id]);
	});

	it('treats a legacy adjust row as other', () => {
		const out = filterLedger(rows, { range: open, type: 'all', q: '', reason: 'other' });
		expect(out.map((r) => r.id)).toEqual([legacy._id]);
	});

	it('`all` and an omitted reason leave every row', () => {
		expect(filterLedger(rows, { range: open, type: 'all', q: '', reason: 'all' })).toHaveLength(4);
		expect(filterLedger(rows, { range: open, type: 'all', q: '' })).toHaveLength(4);
	});

	it('searches the note text', () => {
		const out = filterLedger(rows, { range: open, type: 'all', q: '1 ตุลาคม' });
		expect(out.map((r) => r.id)).toEqual([expired._id]);
	});
});

describe('movements URL state', () => {
	it('defaults reason to all and omits it from the URL', () => {
		expect(LEDGER_URL_DEFAULTS.reason).toBe('all');
		expect(serializeLedgerParams(LEDGER_URL_DEFAULTS).toString()).toBe('');
	});

	it('round-trips lreason and ignores unknown values', () => {
		const state = { ...LEDGER_URL_DEFAULTS, type: 'adjust' as const, reason: 'damaged' as const };
		expect(serializeLedgerParams(state).get('lreason')).toBe('damaged');
		expect(parseLedgerParams(serializeLedgerParams(state))).toEqual(state);
		expect(parseLedgerParams(new URLSearchParams('lreason=stolen')).reason).toBe('all');
	});
});
