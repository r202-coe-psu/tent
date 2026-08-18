import { describe, expect, it } from 'vitest';
import {
	assertBulkWriteResults,
	inspectDateWindow,
	prefixRangeEnd
} from '../../../../../scripts/t31-seed-support';

describe('T-31 seed support', () => {
	it('rejects daily_calc conflicts instead of reporting a stale seed as successful', () => {
		expect(() =>
			assertBulkWriteResults(
				'shelter_sh001',
				[{ id: 'daily_calc:2026-07-08', error: 'conflict', reason: 'Document update conflict.' }],
				{ allowConflicts: false }
			)
		).toThrow(/conflict/);
	});

	it('retains idempotent conflict handling for seed sections that explicitly allow it', () => {
		expect(() =>
			assertBulkWriteResults('catalog', [{ id: 'sop_profile:master', error: 'conflict' }])
		).not.toThrow();
	});

	it('uses the next ASCII character as the CouchDB prefix upper bound', () => {
		expect(prefixRangeEnd('daily_calc:')).toBe('daily_calc;');
		expect(prefixRangeEnd('stock_ledger:')).toBe('stock_ledger;');
		expect(() => prefixRangeEnd('daily_calc')).toThrow(/must end with ':'/);
	});

	it('accepts historical extras but identifies a missing date inside D-13..D', () => {
		const expected = ['2026-07-07', '2026-07-08'];
		expect(inspectDateWindow(['2026-07-06', ...expected], expected)).toEqual({
			missingDates: [],
			extraDates: ['2026-07-06']
		});
		expect(inspectDateWindow(['2026-07-06', '2026-07-08'], expected)).toEqual({
			missingDates: ['2026-07-07'],
			extraDates: ['2026-07-06']
		});
	});
});
