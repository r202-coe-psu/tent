import { describe, expect, it } from 'vitest';
import { formatSkippedDocIds, isTimelineSkippedCoveredByShelter } from './bulk-return-skipped-docs';

describe('formatSkippedDocIds', () => {
	it('joins ids with a comma and space', () => {
		expect(formatSkippedDocIds([{ _id: 'a' }, { _id: 'b' }])).toBe('a, b');
	});

	it('drops empty ids', () => {
		expect(formatSkippedDocIds([{ _id: 'a' }, { _id: '' }, { _id: 'c' }])).toBe('a, c');
	});

	it('returns an empty string for an empty array', () => {
		expect(formatSkippedDocIds([])).toBe('');
	});
});

describe('isTimelineSkippedCoveredByShelter', () => {
	it('is true when the shelter list covers every timeline id', () => {
		expect(
			isTimelineSkippedCoveredByShelter([{ _id: 'a' }, { _id: 'b' }], [{ _id: 'b' }, { _id: 'a' }])
		).toBe(true);
	});

	it('is false when one timeline id is missing from the shelter list', () => {
		expect(isTimelineSkippedCoveredByShelter([{ _id: 'a' }, { _id: 'b' }], [{ _id: 'a' }])).toBe(
			false
		);
	});

	it('is false while the shelter list is not loaded', () => {
		expect(isTimelineSkippedCoveredByShelter([{ _id: 'a' }], undefined)).toBe(false);
	});

	it('is false for an empty timeline list', () => {
		expect(isTimelineSkippedCoveredByShelter([], [{ _id: 'a' }])).toBe(false);
	});

	it('is false for an empty shelter list with a non-empty timeline', () => {
		expect(isTimelineSkippedCoveredByShelter([{ _id: 'a' }], [])).toBe(false);
	});

	it('ignores empty ids', () => {
		expect(isTimelineSkippedCoveredByShelter([{ _id: 'a' }, { _id: '' }], [{ _id: 'a' }])).toBe(
			true
		);
		expect(isTimelineSkippedCoveredByShelter([{ _id: '' }], [{ _id: '' }])).toBe(false);
	});
});
