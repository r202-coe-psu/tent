import { describe, expect, it } from 'vitest';
import { deriveRecipientMenuTags, matchRecipientToMenu, menuTargetTags } from './index';

/** Fixed Gregorian year so CR-130 buckets do not drift with the calendar. */
const YEAR = 2026;
/** Thai Buddhist birth year of someone `age` years old in {@link YEAR}. */
const bornAged = (age: number) => YEAR + 543 - age;
const tagsOf = (profile: Parameters<typeof deriveRecipientMenuTags>[0]) =>
	deriveRecipientMenuTags(profile, YEAR);

describe('deriveRecipientMenuTags (FR-MRM-01)', () => {
	it('tags muslim recipients HALAL', () => {
		expect(tagsOf({ religion: 'muslim', age: 30 })).toEqual(['HALAL']);
		expect(tagsOf({ religion: 'buddhist', age: 30 })).toEqual([]);
	});

	it.each([
		['vulnerable group', { vulnerable_groups: ['infant'] }],
		['special need keyword', { special_needs: [' Infant '] }],
		['CR-130 bucket <1', { birth_year: bornAged(0) }]
	])('tags INFANT by %s', (_label, profile) => {
		expect(tagsOf(profile)).toContain('INFANT');
	});

	it.each([
		['vulnerable group', { vulnerable_groups: ['young_child'] }],
		['CR-130 bucket 1-5 (age 1)', { birth_year: bornAged(1) }],
		['CR-130 bucket 6-11 (age 11)', { birth_year: bornAged(11) }]
	])('tags CHILD by %s', (_label, profile) => {
		expect(tagsOf(profile)).toContain('CHILD');
	});

	it.each([
		['vulnerable group', { vulnerable_groups: ['elderly_dependent'] }],
		['special need keyword', { special_needs: ['elderly'] }],
		['CR-130 bucket 60+', { birth_year: bornAged(60) }]
	])('tags ELDERLY by %s', (_label, profile) => {
		expect(tagsOf(profile)).toContain('ELDERLY');
	});

	it('follows the CR-130 bucket edges', () => {
		expect(tagsOf({ birth_year: bornAged(0) })).toEqual(['INFANT']);
		expect(tagsOf({ birth_year: bornAged(1) })).toEqual(['CHILD']);
		expect(tagsOf({ birth_year: bornAged(12) })).toEqual([]);
		expect(tagsOf({ birth_year: bornAged(59) })).toEqual([]);
	});

	it('prefers birth_year and falls back to age when birth_year is missing', () => {
		expect(tagsOf({ birth_year: bornAged(70), age: 30 })).toEqual(['ELDERLY']);
		expect(tagsOf({ age: 70 })).toEqual(['ELDERLY']);
		expect(tagsOf({ age: 0 })).toEqual(['INFANT']);
	});

	it('derives several tags and ignores free-text needs that only contain a keyword', () => {
		expect(tagsOf({ religion: 'muslim', birth_year: bornAged(70) })).toEqual(['HALAL', 'ELDERLY']);
		expect(tagsOf({ special_needs: ['elderly care at night'] })).toEqual([]);
	});

	it('returns no tags when nothing is known', () => {
		expect(tagsOf({})).toEqual([]);
		expect(tagsOf({ age: null, birth_year: null })).toEqual([]);
	});
});

describe('menuTargetTags', () => {
	it('treats empty dietary and ALL / unset age_group as a general menu', () => {
		expect(menuTargetTags({ dietary: [] })).toEqual([]);
		expect(menuTargetTags({ dietary: [], age_group: 'ALL' })).toEqual([]);
	});

	it('ignores VEGAN so anyone may take a VEGAN menu (FR-MRM-01 VEGAN B)', () => {
		expect(menuTargetTags({ dietary: ['VEGAN'] })).toEqual([]);
		expect(menuTargetTags({ dietary: ['VEGAN', 'HALAL'] })).toEqual(['HALAL']);
	});

	it('combines dietary and age group tags', () => {
		expect(menuTargetTags({ dietary: ['HALAL'], age_group: 'ELDERLY' })).toEqual([
			'HALAL',
			'ELDERLY'
		]);
	});
});

describe('matchRecipientToMenu (FR-MRM-02/03)', () => {
	it('lets everyone, including non-evacuees, take a general menu', () => {
		expect(matchRecipientToMenu([], { dietary: [] }).matches).toBe(true);
		expect(matchRecipientToMenu(null, { dietary: [], age_group: 'ALL' }).matches).toBe(true);
	});

	it('matches a tagged menu when the recipient shares a tag', () => {
		expect(matchRecipientToMenu(['HALAL'], { dietary: ['HALAL'] })).toEqual({
			matches: true,
			menuTags: ['HALAL']
		});
		expect(
			matchRecipientToMenu(['ELDERLY'], { dietary: ['HALAL'], age_group: 'ELDERLY' }).matches
		).toBe(true);
	});

	it('flags a tagged menu for recipients without a shared tag', () => {
		expect(matchRecipientToMenu([], { dietary: ['HALAL'] }).matches).toBe(false);
		expect(matchRecipientToMenu(['CHILD'], { age_group: 'INFANT' }).matches).toBe(false);
		expect(matchRecipientToMenu(null, { dietary: ['HALAL'] }).matches).toBe(false);
	});
});
