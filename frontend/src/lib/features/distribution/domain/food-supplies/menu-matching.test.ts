import { describe, expect, it } from 'vitest';
import { deriveRecipientMenuTags, matchRecipientToMenu, menuTargetTags } from './index';

describe('deriveRecipientMenuTags (FR-MRM-01)', () => {
	it('tags muslim recipients HALAL', () => {
		expect(deriveRecipientMenuTags({ religion: 'muslim', age: 30 })).toEqual(['HALAL']);
		expect(deriveRecipientMenuTags({ religion: 'buddhist', age: 30 })).toEqual([]);
	});

	it.each([
		['vulnerable group', { vulnerable_groups: ['infant'] }],
		['special need keyword', { special_needs: [' Infant '] }],
		['age under 2', { age: 1 }]
	])('tags INFANT by %s', (_label, profile) => {
		expect(deriveRecipientMenuTags(profile)).toContain('INFANT');
	});

	it.each([
		['vulnerable group', { vulnerable_groups: ['young_child'] }],
		['age 2', { age: 2 }],
		['age 12', { age: 12 }]
	])('tags CHILD by %s', (_label, profile) => {
		expect(deriveRecipientMenuTags(profile)).toContain('CHILD');
	});

	it.each([
		['vulnerable group', { vulnerable_groups: ['elderly_dependent'] }],
		['special need keyword', { special_needs: ['elderly'] }],
		['age 60', { age: 60 }]
	])('tags ELDERLY by %s', (_label, profile) => {
		expect(deriveRecipientMenuTags(profile)).toContain('ELDERLY');
	});

	it('keeps age bands exclusive at the boundaries', () => {
		expect(deriveRecipientMenuTags({ age: 13 })).toEqual([]);
		expect(deriveRecipientMenuTags({ age: 59 })).toEqual([]);
		expect(deriveRecipientMenuTags({ age: 1 })).toEqual(['INFANT']);
	});

	it('derives several tags and ignores free-text needs that only contain a keyword', () => {
		expect(deriveRecipientMenuTags({ religion: 'muslim', age: 70 })).toEqual(['HALAL', 'ELDERLY']);
		expect(deriveRecipientMenuTags({ special_needs: ['elderly care at night'] })).toEqual([]);
	});

	it('returns no tags when nothing is known', () => {
		expect(deriveRecipientMenuTags({})).toEqual([]);
		expect(deriveRecipientMenuTags({ age: null })).toEqual([]);
	});
});

describe('menuTargetTags', () => {
	it('treats empty dietary and ALL / unset age_group as a general menu', () => {
		expect(menuTargetTags({ dietary: [] })).toEqual([]);
		expect(menuTargetTags({ dietary: [], age_group: 'ALL' })).toEqual([]);
	});

	it('ignores VEGAN until its recipient rule is decided', () => {
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
