import { describe, expect, it } from 'vitest';
import { fileStamp, headingTimestamp } from './export-time';

describe('export-time (Asia/Bangkok +07)', () => {
	it('formats a plain instant', () => {
		const at = new Date('2026-11-06T03:04:00Z');
		expect(fileStamp(at)).toBe('20261106-1004');
		expect(headingTimestamp(at)).toBe('2026-11-06 10:04');
	});

	it('crosses midnight into the next Bangkok day', () => {
		const at = new Date('2026-11-06T17:30:00Z');
		expect(fileStamp(at)).toBe('20261107-0030');
		expect(headingTimestamp(at)).toBe('2026-11-07 00:30');
	});

	it('crosses a year boundary', () => {
		const at = new Date('2026-12-31T18:00:00Z');
		expect(fileStamp(at)).toBe('20270101-0100');
		expect(headingTimestamp(at)).toBe('2027-01-01 01:00');
	});

	it('zero-pads month, day, hour and minute', () => {
		const at = new Date('2026-01-02T17:05:00Z');
		expect(fileStamp(at)).toBe('20260103-0005');
		expect(headingTimestamp(at)).toBe('2026-01-03 00:05');
	});
});
