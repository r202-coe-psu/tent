import { describe, expect, it } from 'vitest';
import { EWAR_SYMPTOMS_FIELDS_I18N } from './ewar-symptoms-fields.i18n';

const THAI = /[฀-๿]/;

function keys(value: unknown, prefix = ''): string[] {
	if (value && typeof value === 'object') {
		return Object.entries(value).flatMap(([k, v]) => keys(v, `${prefix}${k}.`));
	}
	return [prefix.slice(0, -1)];
}

function strings(value: unknown): string[] {
	if (typeof value === 'string') return [value];
	if (typeof value === 'function') return [String((value as (n: number) => unknown)(1))];
	if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
	return [];
}

describe('EWAR_SYMPTOMS_FIELDS_I18N', () => {
	it('has identical key sets in th and en', () => {
		expect(keys(EWAR_SYMPTOMS_FIELDS_I18N.en).sort()).toEqual(
			keys(EWAR_SYMPTOMS_FIELDS_I18N.th).sort()
		);
	});

	it('contains no Thai characters in en', () => {
		for (const s of strings(EWAR_SYMPTOMS_FIELDS_I18N.en)) expect(s).not.toMatch(THAI);
	});
});
