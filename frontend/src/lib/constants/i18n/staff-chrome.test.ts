import { describe, expect, it } from 'vitest';
import { STAFF_CHROME_I18N } from './staff-chrome';

const THAI = /[฀-๿]/;

function shape(value: unknown): unknown {
	if (typeof value === 'function') return 'function';
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([k, v]) => [k, shape(v)])
		);
	}
	return typeof value;
}

function strings(value: unknown): string[] {
	if (typeof value === 'string') return [value];
	if (typeof value === 'function') return [String(value(2, 'x'))];
	if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
	return [];
}

describe('STAFF_CHROME_I18N', () => {
	it('has identical key sets in EN and TH', () => {
		expect(shape(STAFF_CHROME_I18N.en)).toEqual(shape(STAFF_CHROME_I18N.th));
	});

	it('contains no Thai characters in EN', () => {
		for (const text of strings(STAFF_CHROME_I18N.en)) expect(text).not.toMatch(THAI);
	});
});
