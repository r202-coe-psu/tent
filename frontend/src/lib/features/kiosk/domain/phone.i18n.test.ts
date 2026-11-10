import { describe, expect, it } from 'vitest';
import { phoneEntryHint } from './phone';

describe('phoneEntryHint language', () => {
	it('words the incomplete-number hint in English when asked', () => {
		expect(phoneEntryHint('08123', 'en')).toBe('Enter all 10 digits, starting with 0');
	});

	it('stays Thai without a language', () => {
		expect(phoneEntryHint('08123')).toBe('กรอกให้ครบ 10 หลัก ขึ้นต้นด้วย 0');
	});

	it('has no hint for a ready number in either language', () => {
		expect(phoneEntryHint('0812345678', 'en')).toBeNull();
	});
});
