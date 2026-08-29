import { describe, expect, it } from 'vitest';
import { resolveMasterLabel, toLabelMap } from './master-labels';

describe('toLabelMap', () => {
	it('indexes code → label and skips empty rows', () => {
		expect(
			toLabelMap([
				{ code: 'item_a', label: 'ผู้สูงอายุ' },
				{ code: '', label: 'x' },
				{ code: 'item_b', label: '' }
			])
		).toEqual({ item_a: 'ผู้สูงอายุ' });
	});

	it('returns an empty object for nullish input', () => {
		expect(toLabelMap(null)).toEqual({});
		expect(toLabelMap(undefined)).toEqual({});
	});
});

describe('resolveMasterLabel', () => {
	const labels = { item_a: 'ผู้สูงอายุ', item_b: 'โรงเรียน' };

	it('returns the master-data label when present', () => {
		expect(resolveMasterLabel('item_a', labels)).toBe('ผู้สูงอายุ');
	});

	it('falls back to legacy maps for old free-text / slug values', () => {
		expect(resolveMasterLabel('elderly', labels, { elderly: 'ผู้สูงอายุ' })).toBe('ผู้สูงอายุ');
		expect(resolveMasterLabel('วัด', labels)).toBe('วัด');
	});

	it('never surfaces unresolved ULIDs to citizens', () => {
		expect(resolveMasterLabel('item_missing', labels)).toBe('');
		expect(resolveMasterLabel('item_a', undefined)).toBe('');
	});

	it('returns empty for nullish codes', () => {
		expect(resolveMasterLabel(null, labels)).toBe('');
		expect(resolveMasterLabel(undefined, labels)).toBe('');
	});
});
