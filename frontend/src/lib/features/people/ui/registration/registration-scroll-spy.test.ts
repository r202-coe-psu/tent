// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
	applyIntersectionEntries,
	isScrollNearEnd,
	pickActiveSectionId
} from './registration-scroll-spy';

const SECTIONS = ['address', 'pets', 'vehicles', 'members'] as const;

describe('registration scroll spy', () => {
	it('does not stay on vehicles at scroll end when members ratio is lower', () => {
		const ratios = new Map<string, number>([
			['address', 0],
			['pets', 0],
			['vehicles', 0.7],
			['members', 0.15]
		]);
		expect(pickActiveSectionId(SECTIONS, ratios, { atScrollEnd: true })).toBe('members');
	});

	it('still selects members after vehicles leaves the observation band', () => {
		const ratios = new Map<string, number>([
			['address', 0],
			['pets', 0],
			['vehicles', 0.6],
			['members', 0.4]
		]);
		applyIntersectionEntries(ratios, [
			{ id: 'vehicles', isIntersecting: false, intersectionRatio: 0 }
		]);
		expect(pickActiveSectionId(SECTIONS, ratios)).toBe('members');
	});

	it('at scroll end without vehicles still unlocks from pets', () => {
		const sections = ['address', 'pets', 'members'] as const;
		const ratios = new Map<string, number>([
			['address', 0],
			['pets', 0.65],
			['members', 0.1]
		]);
		expect(pickActiveSectionId(sections, ratios, { atScrollEnd: true })).toBe('members');
	});

	it('isScrollNearEnd detects overflow root at bottom', () => {
		const root = {
			scrollTop: 976,
			clientHeight: 800,
			scrollHeight: 1800
		} as unknown as Element;
		expect(isScrollNearEnd(root, 24)).toBe(true);
		expect(isScrollNearEnd({ ...root, scrollTop: 900 } as unknown as Element, 24)).toBe(false);
	});
});
