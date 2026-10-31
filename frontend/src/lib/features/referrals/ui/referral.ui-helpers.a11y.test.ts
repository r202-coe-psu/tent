import { describe, it, expect } from 'vitest';
import { isRowActivationKey } from './referral.ui-helpers';

describe('isRowActivationKey', () => {
	it('activates on Enter and Space when the row itself is the event target', () => {
		expect(isRowActivationKey({ key: 'Enter', isOwnTarget: true })).toBe(true);
		expect(isRowActivationKey({ key: ' ', isOwnTarget: true })).toBe(true);
	});

	it('ignores Enter and Space pressed on a nested control inside the row', () => {
		expect(isRowActivationKey({ key: 'Enter', isOwnTarget: false })).toBe(false);
		expect(isRowActivationKey({ key: ' ', isOwnTarget: false })).toBe(false);
	});

	it('ignores other keys', () => {
		expect(isRowActivationKey({ key: 'Tab', isOwnTarget: true })).toBe(false);
		expect(isRowActivationKey({ key: 'a', isOwnTarget: true })).toBe(false);
	});
});
