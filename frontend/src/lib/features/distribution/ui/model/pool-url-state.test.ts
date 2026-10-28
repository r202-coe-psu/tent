import { describe, expect, it } from 'vitest';
import {
	bulkReturnPoolHref,
	deskFallbackForBackOfficeParams,
	mergeOnsitePoolParam,
	mergePoolParams,
	onsiteReturnsHref,
	parseOnsiteDistributionParams,
	parsePoolParams,
	ticketHref
} from './pool-url-state';

describe('onsiteReturnsHref', () => {
	it('builds the returns tab link without a pool', () => {
		expect(onsiteReturnsHref(null)).toBe('/onsite/distribution?tab=returns');
	});

	it('appends and encodes the pool id', () => {
		expect(onsiteReturnsHref('01ABC')).toBe('/onsite/distribution?tab=returns&pool=01ABC');
		expect(onsiteReturnsHref('a b&c')).toBe('/onsite/distribution?tab=returns&pool=a%20b%26c');
	});
});

describe('parseOnsiteDistributionParams', () => {
	it('reads a valid tab and pool', () => {
		expect(parseOnsiteDistributionParams(new URLSearchParams('tab=returns&pool=abc'))).toEqual({
			tab: 'returns',
			pool: 'abc'
		});
		expect(parseOnsiteDistributionParams(new URLSearchParams('tab=food'))).toEqual({
			tab: 'food',
			pool: null
		});
	});

	it('returns null for an unknown or missing tab', () => {
		expect(parseOnsiteDistributionParams(new URLSearchParams('tab=nope'))).toEqual({
			tab: null,
			pool: null
		});
		expect(parseOnsiteDistributionParams(new URLSearchParams(''))).toEqual({
			tab: null,
			pool: null
		});
	});

	it('trims the pool and treats blank as null', () => {
		expect(
			parseOnsiteDistributionParams(new URLSearchParams('tab=returns&pool=%20x%20')).pool
		).toBe('x');
		expect(parseOnsiteDistributionParams(new URLSearchParams('tab=returns&pool=%20')).pool).toBe(
			null
		);
	});

	it('a pool without a valid tab implies the returns tab', () => {
		expect(parseOnsiteDistributionParams(new URLSearchParams('pool=abc')).tab).toBe('returns');
		expect(parseOnsiteDistributionParams(new URLSearchParams('tab=nope&pool=abc')).tab).toBe(
			'returns'
		);
	});
});

describe('mergeOnsitePoolParam', () => {
	it('sets tab and pool and keeps other keys', () => {
		const out = mergeOnsitePoolParam(new URLSearchParams('x=1'), 'p 1');
		expect(out.get('x')).toBe('1');
		expect(out.get('tab')).toBe('returns');
		expect(out.get('pool')).toBe('p 1');
	});

	it('removes only pool when closed', () => {
		const out = mergeOnsitePoolParam(new URLSearchParams('tab=returns&pool=x&y=2'), null);
		expect(out.toString()).toBe('tab=returns&y=2');
	});
});

describe('deskFallbackForBackOfficeParams', () => {
	it('maps a pool link to the desk returns tab', () => {
		const expected = '/onsite/distribution?tab=returns&pool=x';
		expect(deskFallbackForBackOfficeParams(new URLSearchParams('view=bulk_pools&pool=x'))).toBe(
			expected
		);
		expect(deskFallbackForBackOfficeParams(new URLSearchParams('pool=x'))).toBe(expected);
	});

	it('maps the pools view without a pool to the returns tab', () => {
		expect(deskFallbackForBackOfficeParams(new URLSearchParams('view=bulk_pools'))).toBe(
			'/onsite/distribution?tab=returns'
		);
	});

	it('is null for other views and empty params', () => {
		expect(deskFallbackForBackOfficeParams(new URLSearchParams('view=tickets'))).toBeNull();
		expect(deskFallbackForBackOfficeParams(new URLSearchParams(''))).toBeNull();
	});
});

describe('ticketHref', () => {
	it('builds the ticket deep link and encodes the id', () => {
		expect(ticketHref('01ABC')).toBe('/back-office/distribution?ticketId=01ABC');
		expect(ticketHref('a b&c')).toBe('/back-office/distribution?ticketId=a%20b%26c');
	});
});

describe('parsePoolParams', () => {
	it('defaults to the tickets view', () => {
		expect(parsePoolParams(new URLSearchParams(''))).toEqual({ view: 'tickets', pool: null });
		expect(parsePoolParams(new URLSearchParams('view=nope'))).toEqual({
			view: 'tickets',
			pool: null
		});
	});

	it('reads the pools view and pool id', () => {
		expect(parsePoolParams(new URLSearchParams('view=bulk_pools&pool=abc'))).toEqual({
			view: 'bulk_pools',
			pool: 'abc'
		});
	});

	it('a pool param alone implies the pools view', () => {
		expect(parsePoolParams(new URLSearchParams('pool=abc'))).toEqual({
			view: 'bulk_pools',
			pool: 'abc'
		});
	});

	it('ignores a blank pool', () => {
		expect(parsePoolParams(new URLSearchParams('view=bulk_pools&pool=%20'))).toEqual({
			view: 'bulk_pools',
			pool: null
		});
	});
});

describe('mergePoolParams', () => {
	it('keeps foreign and ticket keys', () => {
		const base = new URLSearchParams('ticketId=T1&group=pending_ready&view=bulk_pools&pool=x');
		const out = mergePoolParams(base, { view: 'tickets', pool: null });
		expect(out.toString()).toBe('ticketId=T1&group=pending_ready');
	});

	it('writes view and pool', () => {
		const out = mergePoolParams(new URLSearchParams('ticketId=T1'), {
			view: 'bulk_pools',
			pool: 'p 1'
		});
		expect(out.get('ticketId')).toBe('T1');
		expect(out.get('view')).toBe('bulk_pools');
		expect(out.get('pool')).toBe('p 1');
	});

	it('drops pool but keeps view when closed', () => {
		const out = mergePoolParams(new URLSearchParams('view=bulk_pools&pool=x'), {
			view: 'bulk_pools',
			pool: null
		});
		expect(out.toString()).toBe('view=bulk_pools');
	});

	it('never writes pool for the tickets view', () => {
		const out = mergePoolParams(new URLSearchParams(''), { view: 'tickets', pool: 'x' });
		expect(out.toString()).toBe('');
	});
});

describe('bulkReturnPoolHref', () => {
	it('builds the deep link and encodes the id', () => {
		expect(bulkReturnPoolHref('01ABC')).toBe(
			'/back-office/distribution?view=bulk_pools&pool=01ABC'
		);
		expect(bulkReturnPoolHref('a b&c')).toBe(
			'/back-office/distribution?view=bulk_pools&pool=a%20b%26c'
		);
	});
});
