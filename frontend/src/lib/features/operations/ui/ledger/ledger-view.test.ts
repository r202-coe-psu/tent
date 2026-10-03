import { describe, expect, it } from 'vitest';
import type { StockLedger } from '../../domain/operations';
import {
	buildLedgerRows,
	dayHeading,
	filterLedger,
	groupByDay,
	ledgerToCsv,
	LEDGER_CSV_HEADER,
	summarizeRows,
	toLedgerRow,
	type LedgerLookup
} from './ledger-view';

const lookup: LedgerLookup = {
	itemName: (id) => ({ water: 'น้ำดื่ม', milk: 'นม UHT' })[id] ?? 'ไม่ระบุชื่อสิ่งของ',
	unitLabel: (u) => u,
	points: [{ id: 'sp1', name: 'A1' }]
};

// Built from local components so the day keys do not depend on the runner's timezone.
const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m).toISOString();

let seq = 0;
function entry(over: Partial<StockLedger> & Pick<StockLedger, 'reason' | 'qty'>): StockLedger {
	seq += 1;
	return {
		_id: `stock_ledger:${String(seq).padStart(3, '0')}`,
		type: 'stock_ledger',
		item_id: 'water',
		unit: 'pack',
		ref_id: null,
		occurred_at: at(2, 10),
		created_by: 'somchai',
		...over
	} as StockLedger;
}

const receive = entry({
	reason: 'donation',
	qty: '20',
	ref_id: 'donation:DN-0031',
	occurred_at: at(2, 10, 42),
	lot: { lot_no: 'L-261002-001', storage_point_id: 'sp1', storage_zone: 'A1' }
});
const kitchen = entry({
	reason: 'requisition',
	qty: '-20',
	ref_id: 'requisition_ticket:direct-1',
	occurred_at: at(2, 8, 12),
	lot: { note: 'ครัวกลาง' }
});
const adjustOut = entry({
	reason: 'adjust',
	qty: '-12',
	item_id: 'milk',
	occurred_at: at(2, 9, 30)
});
const sent = entry({
	reason: 'transfer_out',
	qty: '-40',
	ref_id: 'stock_transfer:TR-0007',
	occurred_at: at(2, 9, 5)
});
const yesterday = entry({ reason: 'receive', qty: '5', occurred_at: at(1, 23, 50) });
const all = [receive, kitchen, adjustOut, sent, yesterday];

describe('toLedgerRow', () => {
	it('keeps a distribute destination out of the storage column', () => {
		const row = toLedgerRow(kitchen, lookup);
		expect(row.detail).toBe('ครัวกลาง');
		expect(row.storage).toBe('');
		expect(row.group).toBe('out');
	});

	it('resolves lot number, storage point and reference for a receipt', () => {
		const row = toLedgerRow(receive, lookup);
		expect(row.lotNo).toBe('L-261002-001');
		expect(row.storage).toBe('A1');
		expect(row.detail).toBe('donation:DN-0031');
		expect(row.dayKey).toBe('2026-10-02');
		expect(row.time).toBe('10:42');
	});

	it('does not throw on an unparseable timestamp', () => {
		const row = toLedgerRow(entry({ reason: 'adjust', qty: '1', occurred_at: 'bad' }), lookup);
		expect(row.dayKey).toBe('');
	});
});

describe('buildLedgerRows', () => {
	it('sorts newest first', () => {
		expect(buildLedgerRows(all, lookup).map((r) => r.time)).toEqual([
			'10:42',
			'09:30',
			'09:05',
			'08:12',
			'23:50'
		]);
	});
});

describe('filterLedger', () => {
	const rows = buildLedgerRows(all, lookup);
	const open = { from: null, to: null };

	it('filters by inclusive day range', () => {
		const today = filterLedger(rows, {
			range: { from: '2026-10-02', to: '2026-10-02' },
			type: 'all',
			q: ''
		});
		expect(today).toHaveLength(4);
		expect(today.every((r) => r.dayKey === '2026-10-02')).toBe(true);
	});

	it('filters by group', () => {
		expect(filterLedger(rows, { range: open, type: 'transfer', q: '' })).toHaveLength(1);
		expect(filterLedger(rows, { range: open, type: 'in', q: '' })).toHaveLength(2);
	});

	it('searches item, reference, destination and author, case-insensitively', () => {
		const q = (s: string) => filterLedger(rows, { range: open, type: 'all', q: s }).length;
		expect(q('นม')).toBe(1);
		expect(q('dn-0031')).toBe(1);
		expect(q('ครัวกลาง')).toBe(1);
		expect(q('SOMCHAI')).toBe(5);
		expect(q('ไม่มีแน่นอน')).toBe(0);
	});
});

describe('groupByDay', () => {
	it('splits at local midnight and keeps order', () => {
		const groups = groupByDay(buildLedgerRows(all, lookup));
		expect(groups.map((g) => [g.dayKey, g.rows.length])).toEqual([
			['2026-10-02', 4],
			['2026-10-01', 1]
		]);
	});

	it('returns nothing for no rows', () => {
		expect(groupByDay([])).toEqual([]);
	});
});

describe('summarizeRows', () => {
	it('counts the four cards from the ledger alone', () => {
		const cards = summarizeRows(buildLedgerRows(all, lookup));
		expect(cards.map((c) => [c.group, c.count])).toEqual([
			['in', 2],
			['out', 1],
			['adjust', 1],
			['transfer', 1]
		]);
		expect(cards[0].hint).toBe('รายการ · จาก 1 ใบบริจาค');
		expect(cards[1].hint).toBe('รายการ · ครัวกลาง 1');
		expect(cards[3].hint).toBe('ส่งออก 1 · รับเข้า 0');
	});

	it('counts distinct donation documents once', () => {
		const second = entry({ reason: 'donation', qty: '8', ref_id: 'donation:DN-0031' });
		const rows = buildLedgerRows([receive, second], lookup);
		expect(summarizeRows(rows)[0].hint).toBe('รายการ · จาก 1 ใบบริจาค');
	});

	it('is all zeros for no rows', () => {
		expect(summarizeRows([]).map((c) => c.count)).toEqual([0, 0, 0, 0]);
	});
});

describe('ledgerToCsv', () => {
	it('writes the header and one CRLF-separated line per row', () => {
		const csv = ledgerToCsv(buildLedgerRows([receive], lookup));
		const lines = csv.split('\r\n');
		expect(lines).toHaveLength(2);
		expect(lines[0]).toBe(LEDGER_CSV_HEADER.map((h) => `"${h}"`).join(','));
		expect(lines[1]).toBe(
			'"2026-10-02","10:42","รับบริจาค","น้ำดื่ม","20","pack","donation:DN-0031","L-261002-001","A1","somchai","donation:DN-0031"'
		);
	});

	it('is just the header for no rows', () => {
		expect(ledgerToCsv([])).toBe(LEDGER_CSV_HEADER.map((h) => `"${h}"`).join(','));
	});

	it('escapes quotes and keeps commas and newlines inside the cell', () => {
		const row = {
			...toLedgerRow(kitchen, lookup),
			detail: 'ครัว "กลาง", ชั้น 2\nประตูหลัง'
		};
		const line = ledgerToCsv([row]).split('\r\n').slice(1).join('\r\n');
		expect(line).toContain('"ครัว ""กลาง"", ชั้น 2\nประตูหลัง"');
	});

	it('keeps signed quantities numeric but neutralises text that starts like a formula', () => {
		const row = { ...toLedgerRow(kitchen, lookup), itemName: '=HYPERLINK("x")' };
		const csv = ledgerToCsv([row]);
		expect(csv).toContain('"-20"');
		expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
	});
});

describe('dayHeading', () => {
	const now = new Date(2026, 9, 2, 12, 0);

	it('prefixes today and yesterday', () => {
		expect(dayHeading('2026-10-02', now)).toMatch(/^วันนี้ · /);
		expect(dayHeading('2026-10-01', now)).toMatch(/^เมื่อวาน · /);
	});

	it('is the plain date otherwise, and safe on a bad key', () => {
		expect(dayHeading('2026-09-20', now)).not.toMatch(/ · /);
		expect(dayHeading('', now)).toBe('ไม่ทราบวันที่');
	});
});
