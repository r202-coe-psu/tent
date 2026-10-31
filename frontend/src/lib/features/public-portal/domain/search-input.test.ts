import { describe, expect, it } from 'vitest';
import {
	FAMILY_SEARCH_MAX_LENGTH,
	normalizeFamilySearchQuery,
	validateFamilySearchQuery
} from './search-input';

describe('validateFamilySearchQuery', () => {
	it.each([
		['0812345678', 'mobile phone (10 digits)'],
		['081-234-5678', 'phone with dashes'],
		['081 234 5678', 'phone with spaces'],
		['+66812345678', '+66 international form'],
		['(081) 234-5678', 'phone with parentheses'],
		['812345678', 'phone without leading 0'],
		['1234567890123', 'national ID (13 digits)'],
		['1-2345-67890-12-3', 'national ID with dashes'],
		['AB1234567', 'passport'],
		['สมชาย', 'Thai name'],
		['สมชาย ใจดี', 'full name'],
		['สม', 'two-grapheme name (CR-166 floor)'],
		['ab', 'two-letter name'],
		['สม มา', 'two short words'],
		['สม ชาย มา โชค', 'four words'],
		['+6612345', 'non-digit text the backend treats as a name']
	])('accepts %s (%s)', (query) => {
		expect(validateFamilySearchQuery(query)).toBeNull();
	});

	it.each([
		'08236',
		'0823',
		'12345',
		'12',
		'08123456789012',
		'0812345',
		'๐๘๒๓๖',
		'021234567',
		'02-123-4567'
	])('flags %s as an incomplete phone', (query) => {
		expect(validateFamilySearchQuery(query)).toBe('incompletePhone');
	});

	it.each([
		'',
		'   ',
		'a',
		' a ',
		'ก ข',
		'สมหมาย ก',
		'ก สมหมาย',
		// Thai marks attach to their consonant: each of these is ONE grapheme.
		'ที่',
		'มี',
		'สมหมาย มี'
	])('flags %j as too short', (query) => {
		expect(validateFamilySearchQuery(query)).toBe('tooShort');
	});

	it('flags more than four words', () => {
		expect(validateFamilySearchQuery('สม ชาย มา โชค ใจ')).toBe('tooManyWords');
		expect(validateFamilySearchQuery('  สม   ชาย  มา   โชค  ')).toBeNull();
	});

	it('counts words after NFKC, like the backend name_key', () => {
		// SARA AM written as U+0E4D U+0E32 composes to the same word as U+0E33.
		expect(validateFamilySearchQuery('น\u0e4d\u0e32้ใจ ใจดี')).toBeNull();
		expect(validateFamilySearchQuery('ＡＢ')).toBeNull();
		expect(validateFamilySearchQuery('Ａ')).toBe('tooShort');
		// Python casefold turns ß into ss (2 graphemes), so the backend accepts it.
		expect(validateFamilySearchQuery('ß')).toBeNull();
	});

	// Python's str.strip() and re \s do not treat U+FEFF (BOM) as whitespace, while JS trim() and
	// \s do. The backend therefore keeps these as names (>= 3 code points) and accepts them.
	it.each(['\ufeffab', 'ab\ufeff', '\ufeff08236', '08\ufeff236'])(
		'accepts %j because the backend does not strip U+FEFF',
		(query) => {
			expect(validateFamilySearchQuery(query)).toBeNull();
		}
	);

	it('trims surrounding whitespace before checking', () => {
		expect(validateFamilySearchQuery('  0812345678  ')).toBeNull();
	});

	it.each(['\u001c0812345678', '\u00850812345678', '\u30000812345678\u2003'])(
		'strips Python-only whitespace around %j',
		(query) => {
			expect(validateFamilySearchQuery(query)).toBeNull();
			expect(normalizeFamilySearchQuery(query)).toBe('0812345678');
		}
	);

	it('keeps U+FEFF when normalizing, like Python strip()', () => {
		expect(normalizeFamilySearchQuery(' \ufeffab ')).toBe('\ufeffab');
	});

	it('rejects queries over the backend max length', () => {
		expect(validateFamilySearchQuery('ก'.repeat(FAMILY_SEARCH_MAX_LENGTH))).toBeNull();
		expect(validateFamilySearchQuery('ก'.repeat(FAMILY_SEARCH_MAX_LENGTH + 1))).toBe('tooLong');
		expect(validateFamilySearchQuery(`  ${'ก'.repeat(FAMILY_SEARCH_MAX_LENGTH)}  `)).toBeNull();
	});
});
