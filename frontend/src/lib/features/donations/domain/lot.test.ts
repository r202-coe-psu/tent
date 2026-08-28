import { describe, expect, it } from 'vitest';
import { formatLotNote, generateLotNo } from './lot';

describe('generateLotNo (CR-052 §1.2)', () => {
	it('formats the drop-off date and sequence as L-YYMMDD-XXX', () => {
		expect(generateLotNo(new Date(2026, 7, 25), 1)).toBe('L-260825-001');
	});

	it('zero-pads month, day and sequence', () => {
		expect(generateLotNo(new Date(2026, 0, 3), 7)).toBe('L-260103-007');
	});

	it('uses the local calendar date staff read off the shelf, not UTC', () => {
		// 2026-08-25T23:30 local — a UTC-based formatter would print the 26th in Thailand.
		expect(generateLotNo(new Date(2026, 7, 25, 23, 30), 1)).toBe('L-260825-001');
	});

	it('keeps three digits for a sequence past 999 instead of widening the label', () => {
		expect(generateLotNo(new Date(2026, 7, 25), 999)).toBe('L-260825-999');
		expect(generateLotNo(new Date(2026, 7, 25), 1000)).toBe('L-260825-001');
	});
});

describe('formatLotNote', () => {
	it('packs lot number and storage zone into the single lot.note field', () => {
		expect(formatLotNote('L-260825-001', 'Zone A')).toBe('L-260825-001 · Zone A');
	});

	it('leaves no dangling separator when no zone was picked yet', () => {
		expect(formatLotNote('L-260825-001')).toBe('L-260825-001');
		expect(formatLotNote('L-260825-001', '   ')).toBe('L-260825-001');
	});
});
