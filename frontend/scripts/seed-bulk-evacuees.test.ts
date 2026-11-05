import { describe, expect, it } from 'vitest';
import { parseBulkArgs, validateCount } from './seed-bulk-evacuees';

describe('parseBulkArgs', () => {
	it('requires --shelter', () => {
		expect(() => parseBulkArgs(['--count=10'], false)).toThrow('--shelter=<code> is required');
		expect(() => parseBulkArgs(['--shelter=', '--count=10'], true)).toThrow('--shelter');
	});

	it('upper-cases the shelter code and parses --count', () => {
		expect(parseBulkArgs(['--shelter=sh004', '--count=300'], false)).toEqual({
			shelter: 'SH004',
			count: 300
		});
	});

	it('needs --count when there is no terminal to ask in', () => {
		expect(() => parseBulkArgs(['--shelter=SH004'], false)).toThrow('--count');
	});

	it('leaves the count to be asked for in an interactive terminal', () => {
		expect(parseBulkArgs(['--shelter=SH004'], true)).toEqual({ shelter: 'SH004', count: null });
	});
});

describe('validateCount', () => {
	it('accepts positive integers up to 999,999', () => {
		expect(validateCount('1')).toBe(1);
		expect(validateCount('999999')).toBe(999_999);
	});

	it.each(['0', '-5', '1.5', 'abc', '', '1000000'])('rejects %j', (raw) => {
		expect(() => validateCount(raw)).toThrow('positive integer up to 999999');
	});
});
