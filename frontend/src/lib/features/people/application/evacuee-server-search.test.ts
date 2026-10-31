import { describe, expect, it } from 'vitest';
import { getNextEvacueeSearchPageParam, isEvacueeSearchEnabled } from './evacuee-server-search';

describe('getNextEvacueeSearchPageParam', () => {
	it('continues with the cursor while any clause is open', () => {
		expect(getNextEvacueeSearchPageParam({ items: [], nextCursor: { first_name: 'bm' } })).toEqual({
			first_name: 'bm'
		});
	});

	it('stops when the search is exhausted', () => {
		expect(getNextEvacueeSearchPageParam({ items: [], nextCursor: null })).toBeNull();
	});
});

describe('isEvacueeSearchEnabled', () => {
	it.each(['', '   ', '\n'])('is off for blank input %j', (q) => {
		expect(isEvacueeSearchEnabled(q)).toBe(false);
	});

	it.each(['Som', '0812', '1103700123456', '01J8Z3K4M5N6P7Q8R9S0T1V2W3'])('is on for %j', (q) => {
		expect(isEvacueeSearchEnabled(q)).toBe(true);
	});
});
