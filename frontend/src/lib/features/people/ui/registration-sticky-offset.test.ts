// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { readRegistrationStickyTopPx } from './registration-sticky-offset';

function mockEl(): Element {
	return {} as Element;
}

function mockStyles(opts: { elVars?: Record<string, string>; rootFontSize?: string }) {
	const elVars = opts.elVars ?? {};
	vi.spyOn(window, 'getComputedStyle').mockImplementation((target) => {
		if (target === document.documentElement) {
			return {
				getPropertyValue: () => '',
				fontSize: opts.rootFontSize ?? '16px'
			} as unknown as CSSStyleDeclaration;
		}
		return {
			getPropertyValue: (name: string) => elVars[name] ?? '',
			fontSize: '16px'
		} as unknown as CSSStyleDeclaration;
	});
}

describe('readRegistrationStickyTopPx', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('parses rem from --registration-sticky-top', () => {
		const el = mockEl();
		mockStyles({ elVars: { '--registration-sticky-top': '4rem' } });
		expect(readRegistrationStickyTopPx(el)).toBe(64);
	});

	it('parses px values', () => {
		const el = mockEl();
		mockStyles({ elVars: { '--registration-sticky-top': '108px' } });
		expect(readRegistrationStickyTopPx(el)).toBe(108);
	});

	it('falls back when unset', () => {
		const el = mockEl();
		mockStyles({ elVars: {} });
		expect(readRegistrationStickyTopPx(el)).toBe(64);
	});
});
