import { describe, expect, it } from 'vitest';
import { matchesVolunteerSearch, volunteerSearchFields } from './volunteer-search';

const person = volunteerSearchFields({
	first_name: 'วิทวัส',
	last_name: 'สอนใจ',
	nickname: 'ต้น',
	phone: '0812345678',
	volunteer_code: 'V-013'
});

describe('volunteerSearchFields', () => {
	it('joins the full name and keeps the other fields', () => {
		expect(person).toEqual({
			name: 'วิทวัส สอนใจ',
			nickname: 'ต้น',
			phone: '0812345678',
			code: 'V-013'
		});
	});
});

describe('matchesVolunteerSearch', () => {
	it('matches everyone on a blank query', () => {
		expect(matchesVolunteerSearch(person, '')).toBe(true);
		expect(matchesVolunteerSearch(person, '   ')).toBe(true);
	});

	it.each(['วิทวัส', 'สอนใจ', 'วัส สอน', '  สอนใจ  '])('finds the name by %s', (query) => {
		expect(matchesVolunteerSearch(person, query)).toBe(true);
	});

	it('finds the nickname', () => {
		expect(matchesVolunteerSearch(person, 'ต้น')).toBe(true);
	});

	it.each(['081-234-5678', '081 234 5678', '0812345678', '081-234', '5678'])(
		'finds the phone by %s',
		(query) => {
			expect(matchesVolunteerSearch(person, query)).toBe(true);
		}
	);

	it('finds a phone stored with dashes by its digits', () => {
		const dashed = { ...person, phone: '081-234-5678' };
		expect(matchesVolunteerSearch(dashed, '0812345678')).toBe(true);
		expect(matchesVolunteerSearch(dashed, '081 234 5678')).toBe(true);
	});

	it.each(['v013', 'V-013', 'V 013'])('finds the code by %s', (query) => {
		expect(matchesVolunteerSearch(person, query)).toBe(true);
	});

	it('is case-insensitive', () => {
		const latin = { ...person, name: 'Somchai Jaidee', nickname: 'Tom' };
		expect(matchesVolunteerSearch(latin, 'SOMCHAI')).toBe(true);
		expect(matchesVolunteerSearch(latin, 'tom')).toBe(true);
	});

	it('misses what matches no field', () => {
		expect(matchesVolunteerSearch(person, 'สมหญิง')).toBe(false);
		expect(matchesVolunteerSearch(person, '0899999999')).toBe(false);
	});

	it('matches no one by phone or code on a query of only dashes or spaces', () => {
		expect(matchesVolunteerSearch(person, '-')).toBe(false);
		expect(matchesVolunteerSearch(person, ' - ')).toBe(false);
	});

	it('does not match a missing field', () => {
		expect(
			matchesVolunteerSearch({ name: null, nickname: null, phone: null, code: null }, 'a')
		).toBe(false);
	});
});
