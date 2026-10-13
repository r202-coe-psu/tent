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

	it('trims surrounding whitespace before checking', () => {
		expect(validateFamilySearchQuery('  0812345678  ')).toBeNull();
	});
});
