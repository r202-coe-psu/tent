import { describe, expect, it } from 'vitest';
import { maskLastName } from './mask';

describe('maskLastName', () => {
	it('returns an empty string for missing or blank names', () => {
		expect(maskLastName(null)).toBe('');
		expect(maskLastName(undefined)).toBe('');
		expect(maskLastName('')).toBe('');
		expect(maskLastName('   ')).toBe('');
	});

	it('keeps the first code point for names of at most four code points', () => {
		expect(maskLastName('abcd')).toBe('a****');
		expect(maskLastName('นาม')).toBe('น****');
	});

	it('keeps the first two and last code points for longer names', () => {
		expect(maskLastName('Smith')).toBe('Sm****h');
	});

	it('uses Unicode code points, not Thai grapheme clusters', () => {
		expect(maskLastName('แก้ว')).toBe('แ****');
		expect(maskLastName('สมชาย')).toBe('สม****ย');
	});
});
