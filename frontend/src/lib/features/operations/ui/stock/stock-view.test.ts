import { describe, expect, it } from 'vitest';
import {
	attachIncoming,
	displayQty,
	formatIncomingDay,
	incomingAvailable,
	incomingCaption,
	incomingRowHref,
	attentionCounts,
	clampPage,
	expiryLabel,
	filterRows,
	hiddenCatalogCount,
	locationOptions,
	MAIN_STORE_LOCATION,
	narrowToSelfPurchased,
	pageSlice,
	sortRows,
	statusBadges,
	sumLotQty,
	type StockFilterState,
	type StockRowBase
} from './stock-view';
import type { StockLotBalance } from '../../domain/operations';
import { formatTimeUntilExpiry } from '../../domain/lot-age';
import type { IncomingItemTotal, IncomingRow } from '../../domain/incoming-stock';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-02T00:00:00.000Z');
const iso = (offsetDays: number) => new Date(NOW + offsetDays * DAY).toISOString();

function row(over: Partial<StockRowBase> & { _id: string }): StockRowBase {
	return {
		name: over._id,
		category: 'food',
		qtyOnHand: '10',
		status: 'normal',
		expiryState: 'none',
		earliestExpiry: null,
		storageKeys: [],
		hasLotExpiry: false,
		neverReceived: false,
		...over
	};
}

const NO_FILTER: StockFilterState = { q: '', cat: 'all', loc: 'all', status: 'all', all: false };

const milk = row({
	_id: 'milk',
	status: 'low',
	expiryState: 'expired',
	earliestExpiry: iso(-1),
	qtyOnHand: '36'
});
const rice = row({ _id: 'rice', status: 'empty', qtyOnHand: '0' });
const bread = row({
	_id: 'bread',
	status: 'low',
	expiryState: 'expiring',
	earliestExpiry: iso(2)
});
const eggs = row({ _id: 'eggs', expiryState: 'expiring', earliestExpiry: iso(6) });
const noodles = row({ _id: 'noodles', expiryState: 'ok', earliestExpiry: iso(200) });
const catalogOnly = row({ _id: 'soap', status: 'empty', qtyOnHand: '0', neverReceived: true });

describe('attentionCounts', () => {
	it('counts each card, letting an expiry state overlap a qty status', () => {
		expect(attentionCounts([milk, rice, bread, eggs, noodles])).toEqual({
			expired: 1,
			empty: 1,
			low: 2,
			expiring: 2
		});
	});

	it('is all zero for an empty list', () => {
		expect(attentionCounts([])).toEqual({ expired: 0, empty: 0, low: 0, expiring: 0 });
	});
});

describe('filterRows', () => {
	const rows = [milk, rice, bread, eggs, noodles, catalogOnly];

	it('finds an item by the name of an item merged into it (CR-143 FR-F5)', () => {
		const merged = row({ _id: 'item:b', name: 'Soy milk 300 ml', aliases: ['Soymilk 300ml'] });
		const found = filterRows([merged, rice], { ...NO_FILTER, q: 'soymilk' });
		expect(found.map((r) => r._id)).toEqual(['item:b']);
		expect(filterRows([merged, rice], { ...NO_FILTER, q: 'nothing' })).toEqual([]);
	});

	it('hides catalog-only items by default so they are not counted as "หมด"', () => {
		expect(filterRows(rows, NO_FILTER).map((r) => r._id)).not.toContain('soap');
		expect(hiddenCatalogCount(rows)).toBe(1);
	});

	it('shows catalog-only items when the whole-catalog switch is on', () => {
		expect(filterRows(rows, { ...NO_FILTER, all: true }).map((r) => r._id)).toContain('soap');
	});

	it('filters by status card', () => {
		expect(filterRows(rows, { ...NO_FILTER, status: 'low' }).map((r) => r._id)).toEqual([
			'milk',
			'bread'
		]);
		expect(filterRows(rows, { ...NO_FILTER, status: 'expired' }).map((r) => r._id)).toEqual([
			'milk'
		]);
	});

	it('searches name and id, case-insensitively', () => {
		expect(filterRows(rows, { ...NO_FILTER, q: ' BREAD ' }).map((r) => r._id)).toEqual(['bread']);
	});

	it('filters by category and by storage key', () => {
		const a = row({ _id: 'a', category: 'water', storageKeys: ['sp:1'] });
		const b = row({ _id: 'b', category: 'food', storageKeys: ['sp:2', 'sp:1'] });
		expect(filterRows([a, b], { ...NO_FILTER, cat: 'water' }).map((r) => r._id)).toEqual(['a']);
		expect(filterRows([a, b], { ...NO_FILTER, loc: 'sp:1' }).map((r) => r._id)).toEqual(['a', 'b']);
	});

	it('"ซื้อเอง" keeps only items with a self-purchased lot on hand', () => {
		const bought = row({ _id: 'bought', hasSelfPurchased: true });
		const donated = row({ _id: 'donated', hasSelfPurchased: false });
		const legacy = row({ _id: 'legacy' });
		const all = [bought, donated, legacy];
		expect(filterRows(all, { ...NO_FILTER, selfPurchased: true }).map((r) => r._id)).toEqual([
			'bought'
		]);
		expect(filterRows(all, { ...NO_FILTER, selfPurchased: false })).toHaveLength(3);
		expect(filterRows(all, NO_FILTER)).toHaveLength(3);
	});

	it('maps the main-store token to unspecified lots', () => {
		const a = row({ _id: 'a', storageKeys: [''] });
		const b = row({ _id: 'b', storageKeys: ['id:1'] });
		expect(
			filterRows([a, b], { ...NO_FILTER, loc: MAIN_STORE_LOCATION }).map((r) => r._id)
		).toEqual(['a']);
	});
});

describe('locationOptions', () => {
	it('offers configured points even before any stock was received', () => {
		expect(locationOptions([{ id: '1', name: 'ห้อง 3' }], [])).toEqual([
			{ value: 'id:1', label: 'ห้อง 3' },
			{ value: MAIN_STORE_LOCATION, label: 'คลังหลัก' }
		]);
	});

	it('adds ledger-only locations after the points, skipping duplicates and unspecified', () => {
		const options = locationOptions(
			[{ id: '1', name: 'ห้อง 3' }],
			[
				{ key: 'id:1', name: 'ชื่อเก่า' },
				{ key: 'name:โกดัง', name: 'โกดัง' },
				{ key: 'id:9', name: 'จุดที่ลบแล้ว' },
				{ key: '', name: null }
			]
		);
		expect(options.map((o) => o.value)).toEqual([
			'id:1',
			'name:โกดัง',
			'id:9',
			MAIN_STORE_LOCATION
		]);
		expect(options[0].label).toBe('ห้อง 3');
	});

	it("adds what a configured point can hold as the option's hint (#647 AC3)", () => {
		const options = locationOptions(
			[{ id: '1', name: 'ห้อง 3', typeLabels: ['อาหารแห้ง', 'น้ำดื่ม'] }],
			[{ key: 'name:โกดัง', name: 'โกดัง' }]
		);
		expect(options).toEqual([
			{ value: 'id:1', label: 'ห้อง 3', hint: 'อาหารแห้ง, น้ำดื่ม' },
			{ value: 'name:โกดัง', label: 'โกดัง' },
			{ value: MAIN_STORE_LOCATION, label: 'คลังหลัก' }
		]);
	});
});

describe('sortRows', () => {
	it('orders by urgency: expired, empty, low, expiring, normal', () => {
		const sorted = sortRows([noodles, eggs, bread, rice, milk], 'urgency').map((r) => r._id);
		expect(sorted).toEqual(['milk', 'rice', 'bread', 'eggs', 'noodles']);
	});

	it('breaks urgency ties by earliest expiry, then name, with no-expiry last', () => {
		const a = row({ _id: 'a', name: 'ก', status: 'low' });
		const b = row({ _id: 'b', name: 'ข', status: 'low', earliestExpiry: iso(30) });
		const c = row({ _id: 'c', name: 'ค', status: 'low', earliestExpiry: iso(10) });
		expect(sortRows([a, b, c], 'urgency').map((r) => r._id)).toEqual(['c', 'b', 'a']);
	});

	it('AC-X9: orders a bare-date expiry after an earlier instant on the same Bangkok day', () => {
		const dateOnly = row({ _id: 'a', name: 'ก', status: 'low', earliestExpiry: '2026-10-23' });
		const noon = row({
			_id: 'b',
			name: 'ข',
			status: 'low',
			earliestExpiry: '2026-10-23T12:00:00+07:00'
		});
		expect(sortRows([dateOnly, noon], 'urgency').map((r) => r._id)).toEqual(['b', 'a']);
		expect(sortRows([noon, dateOnly], 'urgency').map((r) => r._id)).toEqual(['b', 'a']);
	});

	it('sorts by name in Thai order and by least stock first', () => {
		const a = row({ _id: 'a', name: 'ข', qtyOnHand: '5' });
		const b = row({ _id: 'b', name: 'ก', qtyOnHand: '50' });
		expect(sortRows([a, b], 'name').map((r) => r._id)).toEqual(['b', 'a']);
		expect(sortRows([b, a], 'qty').map((r) => r._id)).toEqual(['a', 'b']);
	});

	it('does not mutate its input', () => {
		const input = [noodles, milk];
		sortRows(input, 'urgency');
		expect(input).toEqual([noodles, milk]);
	});
});

describe('paging', () => {
	const rows = Array.from({ length: 60 }, (_, i) => i);

	it('slices the requested page', () => {
		expect(pageSlice(rows, 2, 25)).toEqual(rows.slice(25, 50));
	});

	it('clamps out-of-range and invalid pages', () => {
		expect(clampPage(99, 60, 25)).toBe(3);
		expect(clampPage(0, 60, 25)).toBe(1);
		expect(clampPage(Number.NaN, 60, 25)).toBe(1);
		expect(clampPage(5, 0, 25)).toBe(1);
	});
});

describe('statusBadges', () => {
	it('shows both an expiry and a qty badge when both apply', () => {
		expect(statusBadges(milk).map((b) => b.label)).toEqual(['หมดอายุ', 'ใกล้หมด']);
	});

	it('shows a single badge otherwise, "ปกติ" when nothing is wrong', () => {
		expect(statusBadges(rice).map((b) => b.label)).toEqual(['หมด']);
		expect(statusBadges(noodles)).toEqual([{ label: 'ปกติ', tone: 'ok' }]);
	});
});

describe('filterRows has_expiry', () => {
	it('keeps only items with a remaining lot that carries lot.expiry', () => {
		const withExpiry = row({ _id: 'a', hasLotExpiry: true });
		const without = row({ _id: 'b', hasLotExpiry: false });
		expect(
			filterRows([withExpiry, without], { ...NO_FILTER, status: 'has_expiry' }).map((r) => r._id)
		).toEqual(['a']);
	});
});

describe('expiryLabel', () => {
	it('shows a dash when no lot has an expiry', () => {
		expect(expiryLabel(null, 'none', NOW)).toEqual({ text: '—', relative: null, tone: 'muted' });
	});

	it('flags an expired lot as critical with how long ago', () => {
		const label = expiryLabel(iso(-1), 'expired', NOW);
		expect(label.tone).toBe('critical');
		expect(label.relative).toMatch(/^หมดแล้ว /);
	});

	it('flags an expiring lot as warning with the time left', () => {
		const label = expiryLabel(iso(2), 'expiring', NOW);
		expect(label.tone).toBe('warning');
		expect(label.relative).toBe('อีก 2 วัน');
	});

	it('shows the time left in grey for a lot that is not near expiry', () => {
		const label = expiryLabel(iso(200), 'ok', NOW);
		expect(label.tone).toBe('muted');
		expect(label.relative).toMatch(/^อีก .+/);
		expect(label.relative).toBe(`อีก ${formatTimeUntilExpiry(iso(200), NOW)}`);
	});
});

describe('incoming stock (#1153)', () => {
	const incRow = (over: Partial<IncomingRow> = {}): IncomingRow => ({
		source: 'donation',
		ref: 'BK-1',
		doc_id: 'donation:BK-1',
		item_id: 'rice',
		qty: '30',
		date: '2026-11-12',
		overdue: false,
		shelter_code: 'SH001',
		...over
	});
	const total = (item_id: string, qty: string, date: string | null): IncomingItemTotal => ({
		item_id,
		qty,
		earliest_date: date,
		rows: [incRow({ item_id, qty, date })]
	});

	it('attaches totals by item without touching in-stock fields', () => {
		const out = attachIncoming([rice, milk], [total('rice', '100', '2026-11-12')]);
		expect(out[0].incoming).toEqual({
			qty: '100',
			earliestDate: '2026-11-12',
			rows: [incRow({ item_id: 'rice', qty: '100' })]
		});
		expect(out[0].qtyOnHand).toBe('0');
		expect(out[0].status).toBe('empty');
		expect(out[1]).toBe(milk);
	});

	it('returns the rows unchanged when nothing is incoming', () => {
		expect(attachIncoming([rice, milk], [])).toEqual([rice, milk]);
		expect(attachIncoming([rice], [total('rice', '0', null)])[0].incoming).toBeUndefined();
	});

	it('shows a never-received item that has incoming even without "all" (AC-6)', () => {
		const rows = attachIncoming([noodles, catalogOnly], [total('soap', '5', null)]);
		const shown = filterRows(rows, NO_FILTER).map((r) => r._id);
		expect(shown).toEqual(['noodles', 'soap']);
		expect(hiddenCatalogCount(rows)).toBe(0);
	});

	it('still hides never-received items with nothing incoming', () => {
		const rows = attachIncoming([noodles, catalogOnly], [total('rice', '5', null)]);
		expect(filterRows(rows, NO_FILTER).map((r) => r._id)).toEqual(['noodles']);
		expect(hiddenCatalogCount(rows)).toBe(1);
	});

	it('keeps attention counts, order and status identical with or without incoming (AC-9)', () => {
		const base = [milk, rice, bread, eggs, noodles, catalogOnly];
		const withInc = attachIncoming(base, [
			total('rice', '100', '2026-11-12'),
			total('soap', '9', null),
			total('milk', '500', null)
		]);
		// in-stock fields are what counts, badges and sorting read — attaching leaves them alone
		const key = (r: StockRowBase) => [r._id, r.qtyOnHand, r.status, r.expiryState];
		expect(withInc.map(key)).toEqual(base.map(key));
		for (const sort of ['urgency', 'name', 'qty'] as const) {
			const plain = sortRows(filterRows(base, NO_FILTER), sort).map((r) => r._id);
			const merged = sortRows(
				filterRows(withInc, NO_FILTER).filter((r) => r._id !== 'soap'),
				sort
			).map((r) => r._id);
			expect(merged).toEqual(plain);
		}
		expect(withInc.map((r) => statusBadges(r))).toEqual([...base.map((r) => statusBadges(r))]);
	});

	it('displays in-stock + incoming, decimal-safe', () => {
		expect(displayQty(milk)).toBe('36');
		const [r] = attachIncoming([row({ _id: 'a', qtyOnHand: '0.1' })], [total('a', '0.2', null)]);
		expect(displayQty(r)).toBe('0.3');
	});

	it('words the caption with the earliest date, or without it', () => {
		const [r] = attachIncoming(
			[row({ _id: 'a', qtyOnHand: '20' })],
			[total('a', '30', '2026-11-12')]
		);
		expect(incomingCaption(r)).toBe(
			`ในคลัง 20 · กำลังมา 30 (เร็วสุด ${formatIncomingDay('2026-11-12')})`
		);
		const [u] = attachIncoming([row({ _id: 'a', qtyOnHand: '20' })], [total('a', '30', null)]);
		expect(incomingCaption(u)).toBe('ในคลัง 20 · กำลังมา 30');
		expect(incomingCaption(milk)).toBeNull();
	});

	it('formats a day as d + Thai short month', () => {
		expect(formatIncomingDay('2026-11-12')).toBe('12 พ.ย.');
		expect(formatIncomingDay('2026-01-05')).toBe('5 ม.ค.');
	});

	it('is unavailable while a storage point is filtered (AC-7)', () => {
		expect(incomingAvailable('all')).toBe(true);
		expect(incomingAvailable('id:sp1')).toBe(false);
		expect(incomingAvailable(MAIN_STORE_LOCATION)).toBe(false);
	});

	it('is unavailable in the "ซื้อเอง" view, whose qty has no incoming part', () => {
		expect(incomingAvailable('all', true)).toBe(false);
		expect(incomingAvailable('all', false)).toBe(true);
	});

	it('links a row only when the user may open its page (FR-16)', () => {
		const donation = incRow();
		const transfer = incRow({ source: 'transfer', ref: 'T1', doc_id: 'stock_transfer:T1' });
		expect(incomingRowHref(donation, ['system_admin'])).toBe('/back-office/stock-donations');
		expect(incomingRowHref(transfer, ['system_admin'])).toBe('/back-office/supply?tab=transfer');
		// donation_staff may open donations but not transfers
		expect(incomingRowHref(donation, ['shelter:SH001', 'SH001:donation_staff'])).toBe(
			'/back-office/stock-donations'
		);
		expect(incomingRowHref(transfer, ['shelter:SH001', 'SH001:donation_staff'])).toBeNull();
		expect(incomingRowHref(donation, ['shelter:SH002', 'SH002:donation_staff'])).toBeNull();
		expect(incomingRowHref(transfer, ['shelter:SH001', 'SH001:warehouse_staff'])).toBe(
			'/back-office/supply?tab=transfer'
		);
		expect(incomingRowHref(donation, [])).toBeNull();
	});
});

describe('narrowToSelfPurchased / sumLotQty', () => {
	const lot = (lot_ref: string, item_id: string, qty: string): StockLotBalance => ({
		lot_ref,
		item_id,
		unit: 'kg',
		qty,
		received_at: iso(-1)
	});
	const byItem = new Map([
		['veg', [lot('L1', 'veg', '200'), lot('L2', 'veg', '10'), lot('L3', 'veg', '5')]],
		['rice', [lot('L4', 'rice', '50')]]
	]);

	it('keeps only the lots whose ref is self-purchased', () => {
		const narrowed = narrowToSelfPurchased(byItem, new Set(['L2', 'L3']));
		expect(narrowed.get('veg')?.map((l) => l.lot_ref)).toEqual(['L2', 'L3']);
		expect(sumLotQty(narrowed.get('veg') ?? [])).toBe('15');
	});

	it('gives an item with no self-purchased lot an empty list, not the full stock', () => {
		const narrowed = narrowToSelfPurchased(byItem, new Set(['L2']));
		expect(narrowed.get('rice')).toEqual([]);
		expect(sumLotQty(narrowed.get('rice') ?? [])).toBe('0');
	});

	it('does not touch the input map', () => {
		narrowToSelfPurchased(byItem, new Set());
		expect(byItem.get('veg')).toHaveLength(3);
	});

	it('subtracts an overdrawn lot', () => {
		expect(sumLotQty([lot('A', 'x', '10'), lot('B', 'x', '-3')])).toBe('7');
	});
});
