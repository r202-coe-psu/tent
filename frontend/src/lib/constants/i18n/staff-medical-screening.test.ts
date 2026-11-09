import { describe, expect, it } from 'vitest';
import { STAFF_MEDICAL_SCREENING_I18N } from './staff-medical-screening';

const THAI = /[฀-๿]/;

function keys(value: unknown, prefix = ''): string[] {
	if (value && typeof value === 'object') {
		return Object.entries(value).flatMap(([k, v]) => keys(v, `${prefix}${k}.`));
	}
	return [prefix.slice(0, -1)];
}

function strings(value: unknown): string[] {
	if (typeof value === 'string') return [value];
	if (typeof value === 'function')
		return [String((value as (...a: string[]) => unknown)('x', 'x', 'x', 'x'))];
	if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
	return [];
}

describe('STAFF_MEDICAL_SCREENING_I18N', () => {
	it('has identical key sets in th and en', () => {
		expect(keys(STAFF_MEDICAL_SCREENING_I18N.en).sort()).toEqual(
			keys(STAFF_MEDICAL_SCREENING_I18N.th).sort()
		);
	});

	it('contains no Thai characters in en', () => {
		for (const s of strings(STAFF_MEDICAL_SCREENING_I18N.en)) {
			expect(s).not.toMatch(THAI);
		}
	});
});
