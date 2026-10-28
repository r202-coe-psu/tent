import { describe, expect, it } from 'vitest';
import { bulkReturnPoolHref, mergePoolParams, parsePoolParams, ticketHref } from './pool-url-state';

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
