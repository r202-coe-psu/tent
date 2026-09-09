// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { readRegistrationStickyTopPx } from './registration-sticky-offset';

function mockEl(): Element {
	return {} as Element;
}

describe('readRegistrationStickyTopPx', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('parses rem from --registration-sticky-top', () => {
		const el = mockEl();
		vi.spyOn(window, 'getComputedStyle').mockImplementation((target) => {
			if (target === el) {
				return { getPropertyValue: () => '4rem' } as unknown as CSSStyleDeclaration;
			}
			return { getPropertyValue: () => '', fontSize: '16px' } as unknown as CSSStyleDeclaration;
		});
		expect(readRegistrationStickyTopPx(el)).toBe(64);
	});

	it('parses px values', () => {
		const el = mockEl();
		vi.spyOn(window, 'getComputedStyle').mockReturnValue({
			getPropertyValue: () => '108px'
		} as unknown as CSSStyleDeclaration);
		expect(readRegistrationStickyTopPx(el)).toBe(108);
	});

	it('falls back when unset', () => {
		const el = mockEl();
		vi.spyOn(window, 'getComputedStyle').mockReturnValue({
			getPropertyValue: () => ''
		} as unknown as CSSStyleDeclaration);
		expect(readRegistrationStickyTopPx(el)).toBe(64);
	});
});
