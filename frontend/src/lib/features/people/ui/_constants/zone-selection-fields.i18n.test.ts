import { describe, expect, it } from 'vitest';
import { ZONE_SELECTION_FIELDS_I18N } from './zone-selection-fields.i18n';

const THAI = /[฀-๿]/;

function keySet(value: unknown, prefix = ''): string[] {
	if (!value || typeof value !== 'object') return [prefix];
	return Object.entries(value).flatMap(([k, v]) => keySet(v, prefix ? `${prefix}.${k}` : k));
}

function strings(value: unknown): string[] {
	if (typeof value === 'string') return [value];
	if (typeof value === 'function')
		return [String((value as (...a: unknown[]) => unknown)('1', 2, 3))];
	if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
	return [];
}

describe('ZONE_SELECTION_FIELDS_I18N', () => {
	it('has identical key sets in th and en', () => {
		expect(keySet(ZONE_SELECTION_FIELDS_I18N.en).sort()).toEqual(
			keySet(ZONE_SELECTION_FIELDS_I18N.th).sort()
		);
	});

	it('contains no Thai characters in en', () => {
		expect(strings(ZONE_SELECTION_FIELDS_I18N.en).filter((s) => THAI.test(s))).toEqual([]);
	});
});
