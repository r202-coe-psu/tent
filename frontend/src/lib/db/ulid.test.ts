import { describe, it, expect } from 'vitest';
import { ulid, isUlid } from './ulid';

describe('ulid', () => {
	it('produces 26-char Crockford-base32 ids', () => {
		const id = ulid();
		expect(id).toHaveLength(26);
		expect(isUlid(id)).toBe(true);
	});

	it('is monotonic within the same millisecond', () => {
		const t = 1_700_000_000_000;
		const a = ulid(t);
		const b = ulid(t);
		const c = ulid(t);
		expect(a < b).toBe(true);
		expect(b < c).toBe(true);
	});

	it('sorts lexicographically by time', () => {
		const earlier = ulid(1_700_000_000_000);
		const later = ulid(1_700_000_001_000);
		expect(earlier < later).toBe(true);
	});

	it('rejects malformed ids', () => {
		expect(isUlid('not-a-ulid')).toBe(false);
		expect(isUlid('IILLOOUU0000000000000000AB')).toBe(false); // excluded letters
	});
});
