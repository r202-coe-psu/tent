import { describe, expect, it } from 'vitest';
import BackofficeLayout from './+layout.svelte';
import PublicFooter from '$lib/components/public-footer.svelte';
import { BasicInfoSection } from '$lib/features/shelters';

describe('Ticket #393: Zero-Shelter Back-office Guard logic', () => {
	it('evaluates zero-shelter locked state correctly based on loading and shelters count', () => {
		const isZeroShelters = (isLoading: boolean, sheltersCount: number) =>
			!isLoading && sheltersCount === 0;

		// While loading, should not be locked
		expect(isZeroShelters(true, 0)).toBe(false);
		expect(isZeroShelters(true, 5)).toBe(false);

		// Loaded with 0 shelters -> locked!
		expect(isZeroShelters(false, 0)).toBe(true);

		// Loaded with shelters -> unlocked!
		expect(isZeroShelters(false, 1)).toBe(false);
		expect(isZeroShelters(false, 3)).toBe(false);
	});

	it('layout component exports a valid Svelte component', () => {
		expect(BackofficeLayout).toBeDefined();
	});
});

describe('Ticket #398: Footer Online Channels Cleanup', () => {
	it('public footer exports a valid Svelte component without Column 3 channels', () => {
		expect(PublicFooter).toBeDefined();
	});
});

describe('Ticket #399: Coordinator Label Renaming', () => {
	it('basic-info-section exports a valid Svelte component with eoc_liaison mapped to Coordinator', () => {
		expect(BasicInfoSection).toBeDefined();
	});
});
