import { describe, expect, it } from 'vitest';
import {
	mergeStockParams,
	parseStockParams,
	serializeStockParams,
	STOCK_URL_DEFAULTS,
	type StockUrlState
} from './stock-url-state';

const params = (qs: string) => new URLSearchParams(qs);

describe('parseStockParams', () => {
	it('returns the defaults for an empty query', () => {
		expect(parseStockParams(params(''))).toEqual(STOCK_URL_DEFAULTS);
	});

	it('reads every key', () => {
		expect(
			parseStockParams(params('q=นม&cat=food&loc=sp:1&status=low&sort=name&page=3&all=1'))
		).toEqual({
			q: 'นม',
			cat: 'food',
			loc: 'sp:1',
			status: 'low',
			sort: 'name',
			page: 3,
			all: true
		});
	});

	it('falls back to defaults for invalid values', () => {
		const s = parseStockParams(params('status=bogus&sort=zzz&page=-4&all=yes'));
		expect(s.status).toBe('all');
		expect(s.sort).toBe('urgency');
		expect(s.page).toBe(1);
		expect(s.all).toBe(false);
		expect(parseStockParams(params('page=2.5')).page).toBe(1);
		expect(parseStockParams(params('page=abc')).page).toBe(1);
	});

	it('ignores the old "normal" status, which no card maps to', () => {
		expect(parseStockParams(params('status=normal')).status).toBe('all');
	});
});

describe('serializeStockParams', () => {
	it('omits everything that is at its default', () => {
		expect(serializeStockParams(STOCK_URL_DEFAULTS).toString()).toBe('');
	});

	it('round-trips a non-default state', () => {
		const state: StockUrlState = {
			q: 'น้ำ',
			cat: 'water',
			loc: 'all',
			status: 'expiring',
			sort: 'qty',
			page: 2,
			all: true
		};
		expect(parseStockParams(serializeStockParams(state))).toEqual(state);
	});

	it('trims the search text and drops page 1', () => {
		const out = serializeStockParams({ ...STOCK_URL_DEFAULTS, q: '  ข้าว ', page: 1 });
		expect(out.get('q')).toBe('ข้าว');
		expect(out.has('page')).toBe(false);
	});
});

describe('mergeStockParams', () => {
	it('keeps keys the table does not own', () => {
		const out = mergeStockParams(params('tab=inventory&action=create'), {
			...STOCK_URL_DEFAULTS,
			status: 'low'
		});
		expect(out.get('tab')).toBe('inventory');
		expect(out.get('action')).toBe('create');
		expect(out.get('status')).toBe('low');
	});

	it('clears stock keys that return to their default', () => {
		const out = mergeStockParams(params('tab=inventory&status=low&page=3&q=x'), STOCK_URL_DEFAULTS);
		expect(out.toString()).toBe('tab=inventory');
	});
});
