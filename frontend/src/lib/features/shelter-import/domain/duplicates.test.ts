import { describe, it, expect } from 'vitest';
import {
	findExistingDuplicates,
	findInFileDuplicates,
	normalizeShelterName,
	type ExistingShelter
} from './duplicates';
import type { RowValidation } from './import-row';

function ok(row: number, name: string): RowValidation {
	return { row, name, ok: true, shelter: {} as RowValidation['shelter'], errors: [] };
}

function failed(row: number, name: string): RowValidation {
	return { row, name, ok: false, errors: [] };
}

describe('normalizeShelterName', () => {
	it('trims and lowercases', () => {
		expect(normalizeShelterName('  ศูนย์ ทดสอบ  ')).toBe('ศูนย์ ทดสอบ');
		expect(normalizeShelterName('Shelter A')).toBe('shelter a');
	});

	it('collapses internal whitespace', () => {
		expect(normalizeShelterName('ศูนย์   ทดสอบ')).toBe('ศูนย์ ทดสอบ');
		expect(normalizeShelterName('ศูนย์\tทดสอบ\n')).toBe('ศูนย์ ทดสอบ');
	});
});

describe('findExistingDuplicates', () => {
	const existing: ExistingShelter[] = [
		{ code: 'SH001', name: 'ศูนย์ ก' },
		{ code: 'SH002', name: 'ศูนย์ ข' }
	];

	it('matches a row by normalized name', () => {
		const matches = findExistingDuplicates([ok(1, '  ศูนย์   ก  ')], existing);
		expect(matches.get(1)).toEqual({
			row: 1,
			name: '  ศูนย์   ก  ',
			existingCode: 'SH001',
			existingName: 'ศูนย์ ก'
		});
	});

	it('is case-insensitive for latin names', () => {
		const matches = findExistingDuplicates(
			[ok(1, 'shelter a')],
			[{ code: 'SH010', name: 'Shelter A' }]
		);
		expect(matches.get(1)?.existingCode).toBe('SH010');
	});

	it('returns no match when the name is not found', () => {
		const matches = findExistingDuplicates([ok(1, 'ศูนย์ ไม่มีจริง')], existing);
		expect(matches.has(1)).toBe(false);
	});

	it('the first existing shelter wins when names are ambiguous', () => {
		const ambiguous: ExistingShelter[] = [
			{ code: 'SH100', name: 'ศูนย์ ซ้ำ' },
			{ code: 'SH101', name: 'ศูนย์ ซ้ำ' }
		];
		const matches = findExistingDuplicates([ok(1, 'ศูนย์ ซ้ำ')], ambiguous);
		expect(matches.get(1)?.existingCode).toBe('SH100');
	});

	it('ignores rows that are not ok', () => {
		const matches = findExistingDuplicates([failed(1, 'ศูนย์ ก')], existing);
		expect(matches.has(1)).toBe(false);
	});
});

describe('findInFileDuplicates', () => {
	it('flags a later row that repeats an earlier row name', () => {
		const rows = [ok(1, 'ศูนย์ ก'), ok(2, 'ศูนย์ ข'), ok(3, '  ศูนย์   ก  ')];
		const dups = findInFileDuplicates(rows);
		expect(dups.get(3)).toBe(1);
		expect(dups.has(1)).toBe(false);
		expect(dups.has(2)).toBe(false);
	});

	it('flags every subsequent repeat against the first occurrence', () => {
		const rows = [ok(1, 'ศูนย์ ก'), ok(2, 'ศูนย์ ก'), ok(3, 'ศูนย์ ก')];
		const dups = findInFileDuplicates(rows);
		expect(dups.get(2)).toBe(1);
		expect(dups.get(3)).toBe(1);
	});

	it('returns an empty map when there are no repeats', () => {
		const rows = [ok(1, 'ศูนย์ ก'), ok(2, 'ศูนย์ ข')];
		expect(findInFileDuplicates(rows).size).toBe(0);
	});

	it('ignores rows that are not ok', () => {
		const rows = [ok(1, 'ศูนย์ ก'), failed(2, 'ศูนย์ ก')];
		expect(findInFileDuplicates(rows).size).toBe(0);
	});
});
