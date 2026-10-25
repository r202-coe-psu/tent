import { describe, it, expect } from 'vitest';
import { accountPhone, normalizePhone } from './phone';

describe('normalizePhone', () => {
	it.each([
		['+66812345678', '0812345678'],
		['66812345678', '0812345678'],
		['081-234 5678', '0812345678'],
		['(081) 234-5678', '0812345678'],
		['0812345678', '0812345678']
	])('normalizes %s to %s', (input, expected) => {
		expect(normalizePhone(input)).toBe(expected);
	});

	it('leaves a short 66-prefixed number alone (under 11 digits)', () => {
		expect(normalizePhone('661234567')).toBe('661234567');
	});
});

describe('accountPhone', () => {
	it.each([
		['0887887878', '0887887878'],
		['088-788 7878', '0887887878'],
		['+66887887878', '0887887878'],
		['022222222', null],
		['02-222-2222', null],
		['', null],
		['   ', null],
		[null, null],
		[undefined, null]
	])('maps %s to %s', (input, expected) => {
		expect(accountPhone(input)).toBe(expected);
	});
});
