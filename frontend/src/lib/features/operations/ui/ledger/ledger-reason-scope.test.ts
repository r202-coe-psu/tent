import { describe, it, expect } from 'vitest';
import { createStockLedger } from '../../domain/operations';
import { parseLedgerParams } from './ledger-url-state';

const ctx = { shelterCode: 'SH001', createdBy: 'staff1' };
const params = (qs: string) => new URLSearchParams(qs);

describe('lreason URL param scope (CR-143 FR-C5)', () => {
	it('is read while the adjust group is selected', () => {
		expect(parseLedgerParams(params('type=adjust&lreason=lost')).reason).toBe('lost');
	});

	it('is ignored for any other type, whose chips are hidden so it could not be cleared', () => {
		expect(parseLedgerParams(params('type=in&lreason=lost')).reason).toBe('all');
		expect(parseLedgerParams(params('lreason=lost')).reason).toBe('all');
	});

	it('an unknown reason falls back to all', () => {
		expect(parseLedgerParams(params('type=adjust&lreason=stolen')).reason).toBe('all');
	});
});

describe('note on non-adjust rows', () => {
	it('a blank note is dropped, real text is still refused', () => {
		const base = {
			item_id: 'item:a',
			qty: '5',
			unit: 'kg',
			reason: 'donation',
			ref_id: 'donation:01J'
		} as const;
		expect(() => createStockLedger({ ...base, note: '   ' }, ctx)).not.toThrow();
		expect(() => createStockLedger({ ...base, note: 'x' }, ctx)).toThrow();
	});
});
