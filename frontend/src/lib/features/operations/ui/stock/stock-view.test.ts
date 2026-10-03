import { describe, expect, it } from 'vitest';
import {
	attentionCounts,
	clampPage,
	expiryLabel,
	filterRows,
	hiddenCatalogCount,
	pageSlice,
	sortRows,
	statusBadges,
	type StockFilterState,
	type StockRowBase
} from './stock-view';

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

	it('shows only the date for a lot that is not near expiry', () => {
		const label = expiryLabel(iso(200), 'ok', NOW);
		expect(label.tone).toBe('default');
		expect(label.relative).toBeNull();
	});
});
