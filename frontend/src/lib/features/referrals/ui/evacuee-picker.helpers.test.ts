import { describe, it, expect } from 'vitest';
import type { Evacuee } from '$lib/features/people';
import {
	clearLoaded,
	loadedSelectionState,
	pickableEvacuees,
	selectLoaded,
	toggleEvacuee
} from './evacuee-picker.helpers';

const ev = (id: string, status: 'active' | 'checked_out' = 'active'): Evacuee =>
	({ _id: id, first_name: id, last_name: '', current_stay: { status } }) as unknown as Evacuee;

const ids = (list: readonly Evacuee[]) => list.map((e) => e._id);

describe('pickableEvacuees', () => {
	it('flattens pages, drops duplicates and people not staying in the shelter', () => {
		const pages = [
			{ items: [ev('a'), ev('b', 'checked_out')], nextCursor: { k: 'x' } },
			{ items: [ev('a'), ev('c')], nextCursor: null }
		];
		expect(ids(pickableEvacuees(pages))).toEqual(['a', 'c']);
	});
});

describe('toggleEvacuee', () => {
	it('adds once and removes', () => {
		const once = toggleEvacuee([], ev('a'), true);
		expect(ids(toggleEvacuee(once, ev('a'), true))).toEqual(['a']);
		expect(toggleEvacuee(once, ev('a'), false)).toEqual([]);
	});
});

describe('select all over loaded rows (#555)', () => {
	const loaded = [ev('a'), ev('b'), ev('c')];
	const blocked = new Set(['b']);

	it('adds only loaded, unblocked rows and keeps earlier picks from other searches', () => {
		expect(ids(selectLoaded([ev('z')], loaded, blocked))).toEqual(['z', 'a', 'c']);
	});

	it('clearing removes only loaded rows', () => {
		expect(ids(clearLoaded([ev('z'), ev('a')], loaded))).toEqual(['z']);
	});

	it('reports all / some / none ignoring blocked rows', () => {
		expect(loadedSelectionState([ev('a'), ev('c')], loaded, blocked)).toBe('all');
		expect(loadedSelectionState([ev('a')], loaded, blocked)).toBe('some');
		expect(loadedSelectionState([ev('z')], loaded, blocked)).toBe('none');
	});
});
