import { describe, expect, expectTypeOf, it } from 'vitest';
import type { DeskFallbackHref } from '$lib/guards/auth';
import {
	bulkReturnPoolHref,
	deskFallbackForBackOfficeParams,
	mergePoolParams,
	onsiteDeskHref,
	onsiteReturnsHref,
	parseOnsiteDistributionParams,
	parsePoolParams,
	ticketHref,
	type OnsiteDistributionHref
} from './pool-url-state';

const parse = (qs: string) => parseOnsiteDistributionParams(new URLSearchParams(qs));

describe('desk href type', () => {
	it('keeps the desk href type in sync with the warehouse guard', () => {
		// Compile-time only (checked by `pnpm check`): fails on drift between the two copies.
		expectTypeOf<OnsiteDistributionHref>().toEqualTypeOf<DeskFallbackHref>();
	});
});

describe('onsiteDeskHref', () => {
	it('writes mode and tab without a pool', () => {
		expect(onsiteDeskHref({ mode: 'food', tab: 'food' })).toBe(
			'/onsite/distribution?mode=food&tab=food'
		);
		expect(onsiteDeskHref({ mode: 'supplies', tab: 'receive', pool: null })).toBe(
			'/onsite/distribution?mode=supplies&tab=receive'
		);
	});

	it('appends and encodes the pool on the returns tab', () => {
		expect(onsiteDeskHref({ mode: 'supplies', tab: 'returns', pool: '01ABC' })).toBe(
			'/onsite/distribution?mode=supplies&tab=returns&pool=01ABC'
		);
		expect(onsiteDeskHref({ mode: 'supplies', tab: 'returns', pool: 'a b&c' })).toBe(
			'/onsite/distribution?mode=supplies&tab=returns&pool=a%20b%26c'
		);
	});

	it('never writes a pool outside the returns tab', () => {
		expect(onsiteDeskHref({ mode: 'supplies', tab: 'supplies', pool: 'x' })).toBe(
			'/onsite/distribution?mode=supplies&tab=supplies'
		);
	});
});

describe('onsiteReturnsHref', () => {
	it('builds the supplies-mode returns link without a pool', () => {
		expect(onsiteReturnsHref(null)).toBe('/onsite/distribution?mode=supplies&tab=returns');
	});

	it('appends and encodes the pool id', () => {
		expect(onsiteReturnsHref('01ABC')).toBe(
			'/onsite/distribution?mode=supplies&tab=returns&pool=01ABC'
		);
		expect(onsiteReturnsHref('a b&c')).toBe(
			'/onsite/distribution?mode=supplies&tab=returns&pool=a%20b%26c'
		);
	});
});

describe('parseOnsiteDistributionParams', () => {
	it('reads a valid mode, tab and pool', () => {
		expect(parse('mode=supplies&tab=returns&pool=abc')).toEqual({
			mode: 'supplies',
			tab: 'returns',
			pool: 'abc'
		});
		expect(parse('mode=food&tab=receive')).toEqual({ mode: 'food', tab: 'receive', pool: null });
	});

	it('returns null for unknown or missing values', () => {
		expect(parse('tab=nope&mode=nope')).toEqual({ mode: null, tab: null, pool: null });
		expect(parse('')).toEqual({ mode: null, tab: null, pool: null });
	});

	it('keeps a valid mode when there is no tab', () => {
		expect(parse('mode=supplies')).toEqual({ mode: 'supplies', tab: null, pool: null });
	});

	it('trims the pool and treats blank as null', () => {
		expect(parse('tab=returns&pool=%20x%20').pool).toBe('x');
		expect(parse('tab=returns&pool=%20').pool).toBe(null);
	});

	it('a pool forces the returns tab and the supplies mode', () => {
		expect(parse('pool=abc')).toEqual({ mode: 'supplies', tab: 'returns', pool: 'abc' });
		expect(parse('tab=nope&pool=abc').tab).toBe('returns');
		expect(parse('mode=food&tab=food&pool=x')).toEqual({
			mode: 'supplies',
			tab: 'returns',
			pool: 'x'
		});
	});

	it('a one-mode tab forces its mode over ?mode=', () => {
		expect(parse('mode=food&tab=returns').mode).toBe('supplies');
		expect(parse('mode=food&tab=supplies').mode).toBe('supplies');
		expect(parse('mode=supplies&tab=food').mode).toBe('food');
		expect(parse('tab=food').mode).toBe('food');
	});

	it('a tab both modes have leaves the mode to ?mode=', () => {
		expect(parse('mode=food&tab=reconciliation').mode).toBe('food');
		expect(parse('mode=supplies&tab=receive').mode).toBe('supplies');
		expect(parse('tab=receive').mode).toBeNull();
	});
});

describe('deskFallbackForBackOfficeParams', () => {
	it('maps a pool link to the desk returns step in supplies mode', () => {
		const expected = '/onsite/distribution?mode=supplies&tab=returns&pool=x';
		expect(deskFallbackForBackOfficeParams(new URLSearchParams('view=bulk_pools&pool=x'))).toBe(
			expected
		);
		expect(deskFallbackForBackOfficeParams(new URLSearchParams('pool=x'))).toBe(expected);
	});

	it('maps the pools view without a pool to the returns step', () => {
		expect(deskFallbackForBackOfficeParams(new URLSearchParams('view=bulk_pools'))).toBe(
			'/onsite/distribution?mode=supplies&tab=returns'
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
