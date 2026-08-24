import { describe, expect, it } from 'vitest';
import { H } from './columns';
import { emptyLookups, validateRow, validateWorkbook, type RawRow } from './import-row';
import {
	existingPersonKey,
	findExistingDuplicates,
	normalizeIdNumber,
	personDuplicateKey,
	type ExistingPerson
} from './duplicates';

function head(overrides: RawRow = {}): RawRow {
	return {
		[H.first_name]: 'สมชาย',
		[H.last_name]: 'ใจดี',
		[H.gender]: 'ชาย',
		...overrides
	};
}

function stored(overrides: Partial<ExistingPerson> = {}): ExistingPerson {
	return {
		_id: 'evacuee:01',
		first_name: 'สมชาย',
		last_name: 'ใจดี',
		person_id: { number: '1234567890123' },
		...overrides
	};
}

describe('normalizeIdNumber', () => {
	it('ignores the separators people type into an ID cell', () => {
		expect(normalizeIdNumber('1-2345-67890-12-3')).toBe('1234567890123');
		expect(normalizeIdNumber(' ab 123 ')).toBe('AB123');
	});
});

describe('identity keys', () => {
	it('prefers the document number', () => {
		const row = validateRow(head({ [H.id_number]: '1-2345-67890-12-3' }), 1, emptyLookups());
		expect(personDuplicateKey(row.payload!.head)).toBe('id:1234567890123');
	});

	it('falls back to name + birth year when there is no document number', () => {
		const row = validateRow(head({ [H.birth_year]: '2520' }), 1, emptyLookups());
		expect(personDuplicateKey(row.payload!.head)).toBe('name:สมชาย ใจดี:2520');
	});

	it('gives no key at all when neither is present, so nobody is skipped on a name alone', () => {
		const row = validateRow(head(), 1, emptyLookups());
		expect(personDuplicateKey(row.payload!.head)).toBeNull();
	});

	it('reads a stored evacuee the same way it reads a workbook row', () => {
		const row = validateRow(head({ [H.id_number]: '1234567890123' }), 1, emptyLookups());
		expect(existingPersonKey(stored())).toBe(personDuplicateKey(row.payload!.head));
	});
});

describe('findExistingDuplicates', () => {
	it('flags a head who already exists in the shelter', () => {
		const rows = [validateRow(head({ [H.id_number]: '1234567890123' }), 1, emptyLookups())];

		const matches = findExistingDuplicates(rows, [stored()]);

		expect(matches.get(1)?.head?.existingId).toBe('evacuee:01');
		expect(matches.get(1)?.members).toEqual([]);
	});

	it('flags only the members who already exist, leaving the household importable', () => {
		const rows = [
			validateRow(head(), 1, emptyLookups(), [
				{
					ref: '1',
					line: 2,
					cells: {
						[H.first_name]: 'สมหญิง',
						[H.last_name]: 'ใจดี',
						[H.gender]: 'หญิง',
						[H.id_number]: '9999999999999'
					}
				}
			])
		];

		const matches = findExistingDuplicates(rows, [
			stored({ _id: 'evacuee:09', first_name: 'สมหญิง', person_id: { number: '9999999999999' } })
		]);

		expect(matches.get(1)?.head).toBeNull();
		expect(matches.get(1)?.members).toEqual([
			{ name: 'สมหญิง ใจดี', existingId: 'evacuee:09', line: 2 }
		]);
	});

	it('ignores rows that failed validation', () => {
		const rows = [validateRow({ [H.id_number]: '1234567890123' }, 1, emptyLookups())];
		expect(findExistingDuplicates(rows, [stored()]).size).toBe(0);
	});

	it('does not match a namesake with no birth year on either side', () => {
		const rows = [validateRow(head(), 1, emptyLookups())];
		expect(findExistingDuplicates(rows, [stored({ person_id: undefined })]).size).toBe(0);
	});
});

describe('in-file duplicates', () => {
	it('rejects the same person appearing as a member of two households', () => {
		const member = {
			[H.first_name]: 'สมหญิง',
			[H.last_name]: 'ใจดี',
			[H.gender]: 'หญิง',
			[H.id_number]: '9999999999999'
		};
		const rows = validateWorkbook(
			{
				households: [
					{ ref: '1', line: 1, cells: head() },
					{ ref: '2', line: 2, cells: head({ [H.first_name]: 'มานี' }) }
				],
				members: [
					{ ref: '1', line: 1, cells: member },
					{ ref: '2', line: 2, cells: { ...member } }
				]
			},
			emptyLookups()
		);

		expect(rows[0].ok).toBe(true);
		expect(rows[1].ok).toBe(false);
		expect(rows[1].errors.at(-1)?.sheet).toBe('สมาชิก');
		expect(rows[1].errors.at(-1)?.line).toBe(2);
	});

	it('rejects a person listed twice inside one household', () => {
		const rows = validateWorkbook(
			{
				households: [{ ref: '1', line: 1, cells: head({ [H.id_number]: '1234567890123' }) }],
				members: [
					{
						ref: '1',
						line: 1,
						cells: {
							[H.first_name]: 'สมชาย',
							[H.last_name]: 'ใจดี',
							[H.gender]: 'ชาย',
							[H.id_number]: '1234567890123'
						}
					}
				]
			},
			emptyLookups()
		);

		expect(rows[0].ok).toBe(false);
		expect(rows[0].errors.at(-1)?.message).toContain('ครัวเรือนเดียวกัน');
	});
});
