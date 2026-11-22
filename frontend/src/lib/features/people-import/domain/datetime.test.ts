import { describe, expect, it } from 'vitest';
import { formatThaiDateTime, formatWallClock, parseImportDateTime } from './datetime';

describe('parseImportDateTime', () => {
	it('reads a BE year, Thai wall-clock cell as the matching UTC instant (UTC+7)', () => {
		expect(parseImportDateTime('10/11/2569 14:00')?.toISOString()).toBe('2026-11-10T07:00:00.000Z');
	});

	it('crosses midnight correctly: 00:30 Bangkok is the previous UTC day', () => {
		expect(parseImportDateTime('01/01/2569 00:30')?.toISOString()).toBe('2025-12-31T17:30:00.000Z');
	});

	it('also accepts a Gregorian year typed by habit', () => {
		expect(parseImportDateTime('10/11/2026 14:00')?.toISOString()).toBe('2026-11-10T07:00:00.000Z');
	});

	it('accepts single-digit day/month/hour and optional seconds', () => {
		expect(parseImportDateTime('5/1/2569 9:05')?.toISOString()).toBe('2026-01-05T02:05:00.000Z');
		expect(parseImportDateTime('5/1/2569 9:05:30')?.toISOString()).toBe('2026-01-05T02:05:30.000Z');
	});

	it.each([
		'',
		'เมื่อวาน',
		'10/11/2569',
		'2569-11-10 14:00',
		'31/02/2569 10:00',
		'10/13/2569 10:00'
	])('rejects %j', (text) => {
		expect(parseImportDateTime(text)).toBeNull();
	});

	it('rejects an hour or minute that does not exist instead of rolling over', () => {
		expect(parseImportDateTime('10/11/2569 25:00')).toBeNull();
		expect(parseImportDateTime('10/11/2569 14:75')).toBeNull();
	});
});

describe('formatWallClock / formatThaiDateTime', () => {
	it('re-renders an Excel date cell (UTC fields = what was typed) in the file format', () => {
		expect(formatWallClock(new Date(Date.UTC(2026, 10, 10, 14, 0)))).toBe('10/11/2569 14:00');
	});

	it('round-trips with parseImportDateTime', () => {
		const instant = parseImportDateTime('10/11/2569 14:00')!;
		expect(formatThaiDateTime(instant)).toBe('10/11/2569 14:00');
	});
});
