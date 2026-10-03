import { describe, expect, it } from 'vitest';
import {
	LEDGER_URL_DEFAULTS,
	mergeLedgerParams,
	parseLedgerParams,
	resolveDayRange,
	serializeLedgerParams
} from './ledger-url-state';

const params = (qs: string) => new URLSearchParams(qs);

describe('parseLedgerParams', () => {
	it('returns the defaults for an empty query', () => {
		expect(parseLedgerParams(params(''))).toEqual(LEDGER_URL_DEFAULTS);
	});

	it('reads every key', () => {
		expect(
			parseLedgerParams(
				params(
					'range=custom&from=2026-09-01&to=2026-09-30&type=out&lq=%E0%B8%99%E0%B9%89%E0%B8%B3&lpage=3'
				)
			)
		).toEqual({
			range: 'custom',
			from: '2026-09-01',
			to: '2026-09-30',
			type: 'out',
			q: 'น้ำ',
			page: 3
		});
	});

	it('falls back on unknown or malformed values', () => {
		const out = parseLedgerParams(params('range=year&type=bogus&lpage=-2&from=nope'));
		expect(out).toEqual(LEDGER_URL_DEFAULTS);
	});

	it('treats a bare from/to as a custom range', () => {
		expect(parseLedgerParams(params('from=2026-09-01')).range).toBe('custom');
	});
});

describe('serializeLedgerParams', () => {
	it('emits nothing for the defaults', () => {
		expect(serializeLedgerParams(LEDGER_URL_DEFAULTS).toString()).toBe('');
	});

	it('drops from/to unless the range is custom', () => {
		const out = serializeLedgerParams({
			...LEDGER_URL_DEFAULTS,
			range: '7d',
			from: '2026-09-01',
			to: '2026-09-02'
		});
		expect(out.toString()).toBe('range=7d');
	});

	it('round-trips', () => {
		const state = {
			range: 'custom' as const,
			from: '2026-09-01',
			to: '2026-09-30',
			type: 'adjust' as const,
			q: 'นม',
			page: 2
		};
		expect(parseLedgerParams(serializeLedgerParams(state))).toEqual(state);
	});
});

describe('mergeLedgerParams', () => {
	it('replaces only the movements keys', () => {
		const out = mergeLedgerParams(params('tab=movements&type=in&lq=x&status=low'), {
			...LEDGER_URL_DEFAULTS,
			type: 'out'
		});
		expect(out.get('tab')).toBe('movements');
		expect(out.get('status')).toBe('low');
		expect(out.get('type')).toBe('out');
		expect(out.has('lq')).toBe(false);
	});

	it('leaves just the tab when the state is default', () => {
		const out = mergeLedgerParams(params('tab=movements&range=7d&lpage=2'), LEDGER_URL_DEFAULTS);
		expect(out.toString()).toBe('tab=movements');
	});
});

describe('resolveDayRange', () => {
	const now = new Date(2026, 9, 2, 12, 0);

	it('today = one local day', () => {
		expect(resolveDayRange(LEDGER_URL_DEFAULTS, now)).toEqual({
			from: '2026-10-02',
			to: '2026-10-02'
		});
	});

	it('7d and 30d include today', () => {
		expect(resolveDayRange({ ...LEDGER_URL_DEFAULTS, range: '7d' }, now)).toEqual({
			from: '2026-09-26',
			to: '2026-10-02'
		});
		expect(resolveDayRange({ ...LEDGER_URL_DEFAULTS, range: '30d' }, now).from).toBe('2026-09-03');
	});

	it('all is open on both sides', () => {
		expect(resolveDayRange({ ...LEDGER_URL_DEFAULTS, range: 'all' }, now)).toEqual({
			from: null,
			to: null
		});
	});

	it('swaps a reversed custom range and allows an open end', () => {
		expect(
			resolveDayRange(
				{ ...LEDGER_URL_DEFAULTS, range: 'custom', from: '2026-09-30', to: '2026-09-01' },
				now
			)
		).toEqual({ from: '2026-09-01', to: '2026-09-30' });
		expect(
			resolveDayRange({ ...LEDGER_URL_DEFAULTS, range: 'custom', from: '2026-09-01' }, now)
		).toEqual({ from: '2026-09-01', to: null });
	});
});
