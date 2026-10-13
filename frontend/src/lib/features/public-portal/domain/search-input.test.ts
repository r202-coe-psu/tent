import { describe, expect, it } from 'vitest';
import { validateFamilySearchQuery } from './search-input';

describe('validateFamilySearchQuery', () => {
	it.each([
		['0812345678', 'mobile phone (10 digits)'],
		['082345678', 'landline (9 digits)'],
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
		['+6612345', 'non-digit text the backend treats as a name']
	])('accepts %s (%s)', (query) => {
		expect(validateFamilySearchQuery(query)).toBeNull();
	});

	it.each(['08236', '0823', '12345', '12', '08123456789012', '0812345', '๐๘๒๓๖'])(
		'flags %s as an incomplete phone',
		(query) => {
			expect(validateFamilySearchQuery(query)).toBe('incompletePhone');
		}
	);

	it.each(['', '   ', 'สม', 'ab', ' a '])('flags %j as too short', (query) => {
		expect(validateFamilySearchQuery(query)).toBe('tooShort');
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
});
