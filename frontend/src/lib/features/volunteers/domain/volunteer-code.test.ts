import { describe, it, expect } from 'vitest';
import { nextVolunteerCode, formatVolunteerCode } from './volunteer-code';

describe('formatVolunteerCode', () => {
	it('zero-pads to 3 digits', () => {
		expect(formatVolunteerCode(1)).toBe('V-001');
		expect(formatVolunteerCode(42)).toBe('V-042');
	});

	it('widens past 999 instead of truncating', () => {
		expect(formatVolunteerCode(1000)).toBe('V-1000');
	});
});

describe('nextVolunteerCode', () => {
	it('starts at V-001 for an empty shelter', () => {
		expect(nextVolunteerCode([])).toBe('V-001');
	});

	it('continues from the highest existing code', () => {
		expect(nextVolunteerCode(['V-001', 'V-002', 'V-003'])).toBe('V-004');
	});

	it('is order-independent', () => {
		expect(nextVolunteerCode(['V-010', 'V-002', 'V-007'])).toBe('V-011');
	});

	it('does not fill gaps — always continues past the max', () => {
		expect(nextVolunteerCode(['V-001', 'V-005'])).toBe('V-006');
	});

	it('ignores non-matching entries', () => {
		expect(nextVolunteerCode(['V-001', 'not-a-code', 'VX-9', ''])).toBe('V-002');
	});

	it('widens past 999', () => {
		expect(nextVolunteerCode(['V-999'])).toBe('V-1000');
	});

	it('is case-insensitive — a lowercase "v-001" does not cause a duplicate mint (F14)', () => {
		expect(nextVolunteerCode(['v-001', 'v-002'])).toBe('V-003');
	});

	it('treats mixed-case entries the same as uppercase when finding the max', () => {
		expect(nextVolunteerCode(['V-001', 'v-005', 'V-003'])).toBe('V-006');
	});

	it('accepts a wide code like V-0001 (extra leading zero) without over/under-counting', () => {
		expect(nextVolunteerCode(['V-0001'])).toBe('V-002');
	});

	it('deduplicates a code repeated by an existing-codes list (e.g. duplicate mint already occurred)', () => {
		expect(nextVolunteerCode(['V-001', 'V-001', 'V-002'])).toBe('V-003');
	});
});
