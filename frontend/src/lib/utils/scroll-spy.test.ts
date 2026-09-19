// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	applyIntersectionEntries,
	isScrollNearEnd,
	pickActiveSectionId,
	readStickyTopPx
} from './scroll-spy';

const SECTIONS = ['address', 'pets', 'vehicles', 'members'] as const;

describe('applyIntersectionEntries', () => {
	it('merges changed entries into the ratio map', () => {
		const ratios = new Map<string, number>([['address', 0.5]]);
		applyIntersectionEntries(ratios, [
			{ id: 'pets', isIntersecting: true, intersectionRatio: 0.4 },
			{ id: 'address', isIntersecting: false, intersectionRatio: 0 }
		]);
		expect(ratios.get('pets')).toBe(0.4);
		expect(ratios.get('address')).toBe(0);
	});

	it('drops leaving targets to zero instead of deleting them', () => {
		const ratios = new Map<string, number>([['vehicles', 0.7]]);
		applyIntersectionEntries(ratios, [
			{ id: 'vehicles', isIntersecting: false, intersectionRatio: 0 }
		]);
		expect(ratios.has('vehicles')).toBe(true);
		expect(ratios.get('vehicles')).toBe(0);
	});
});

describe('pickActiveSectionId', () => {
	it('picks the highest-ratio section', () => {
		const ratios = new Map<string, number>([
			['address', 0.1],
			['pets', 0.6],
			['vehicles', 0.2]
		]);
		expect(pickActiveSectionId(SECTIONS, ratios)).toBe('pets');
	});

	it('returns null when there are no sections', () => {
		expect(pickActiveSectionId([], new Map())).toBeNull();
	});

	it('returns null when no section has a positive ratio', () => {
		const ratios = new Map<string, number>([
			['address', 0],
			['pets', 0]
		]);
		expect(pickActiveSectionId(['address', 'pets'], ratios)).toBeNull();
	});

	it('prefers the last section when at scroll end, even with a lower ratio', () => {
		const ratios = new Map<string, number>([
			['vehicles', 0.7],
			['members', 0.15]
		]);
		expect(pickActiveSectionId(SECTIONS, ratios, { atScrollEnd: true })).toBe('members');
	});
});

describe('isScrollNearEnd', () => {
	it('detects an overflow root at the bottom', () => {
		const root = {
			scrollTop: 976,
			clientHeight: 800,
			scrollHeight: 1800
		} as unknown as Element;
		expect(isScrollNearEnd(root, 24)).toBe(true);
		expect(isScrollNearEnd({ ...root, scrollTop: 900 } as unknown as Element, 24)).toBe(false);
	});
});

describe('readStickyTopPx', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

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

	it('parses rem using the root font size', () => {
		const el = {} as Element;
		mockStyles({ elVars: { '--shelter-form-sticky-top': '4rem' }, rootFontSize: '18px' });
		expect(readStickyTopPx(el, '--shelter-form-sticky-top')).toBe(72);
	});

	it('parses px values', () => {
		const el = {} as Element;
		mockStyles({ elVars: { '--shelter-form-sticky-top': '108px' } });
		expect(readStickyTopPx(el, '--shelter-form-sticky-top')).toBe(108);
	});

	it('falls back when the var is unset', () => {
		const el = {} as Element;
		mockStyles({ elVars: {} });
		expect(readStickyTopPx(el, '--shelter-form-sticky-top')).toBe(64);
	});

	it('honours a custom fallback', () => {
		const el = {} as Element;
		mockStyles({ elVars: {} });
		expect(readStickyTopPx(el, '--shelter-form-sticky-top', 80)).toBe(80);
	});
});
