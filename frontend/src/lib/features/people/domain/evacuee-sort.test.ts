import { describe, expect, it } from 'vitest';
import { DEFAULT_EVACUEE_SORT, isEvacueeSort, sortEvacuees } from './evacuee-sort';

const rows = [
	{ _id: 'evacuee:02', first_name: 'สมชาย', last_name: 'ใจดี' },
	{ _id: 'evacuee:03', first_name: 'กมล', last_name: 'ศรีสุข' },
	{ _id: 'evacuee:01', first_name: 'เอกชัย', last_name: 'มั่นคง' },
	{ _id: 'evacuee:04', first_name: 'กมล', last_name: 'กล้าหาญ' }
];

const ids = (items: { _id: string }[]) => items.map((e) => e._id);

describe('sortEvacuees', () => {
	it('defaults to newest-registered first', () => {
		expect(DEFAULT_EVACUEE_SORT).toBe('newest');
		expect(ids(sortEvacuees(rows, 'newest'))).toEqual([
			'evacuee:04',
			'evacuee:03',
			'evacuee:02',
			'evacuee:01'
		]);
	});

	it('sorts oldest-registered first by ULID _id', () => {
		expect(ids(sortEvacuees(rows, 'oldest'))).toEqual([
			'evacuee:01',
			'evacuee:02',
			'evacuee:03',
			'evacuee:04'
		]);
	});

	it('sorts by Thai first name, then last name (leading vowels collate by consonant)', () => {
		// เอกชัย collates under อ, so it lands after ส.
		expect(sortEvacuees(rows, 'name').map((e) => `${e.first_name} ${e.last_name}`)).toEqual([
			'กมล กล้าหาญ',
			'กมล ศรีสุข',
			'สมชาย ใจดี',
			'เอกชัย มั่นคง'
		]);
	});

	it('does not mutate the input', () => {
		const before = ids(rows);
		sortEvacuees(rows, 'newest');
		expect(ids(rows)).toEqual(before);
	});
});

describe('isEvacueeSort', () => {
	it('accepts known sorts only', () => {
		expect(isEvacueeSort('name')).toBe(true);
		expect(isEvacueeSort('')).toBe(false);
		expect(isEvacueeSort('created_at')).toBe(false);
	});
});
