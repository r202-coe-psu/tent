import { describe, expect, it } from 'vitest';
import { applyRowClickSelection, selectRange, toggleId } from './row-selection';

const IDS = ['a', 'b', 'c', 'd', 'e'] as const;

describe('toggleId', () => {
	it('adds an id that is not selected', () => {
		expect(toggleId(['a'], 'b')).toEqual(['a', 'b']);
	});

	it('removes an id that is already selected', () => {
		expect(toggleId(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
	});

	it('does not mutate the input array', () => {
		const selected = ['a'];
		const next = toggleId(selected, 'b');
		expect(selected).toEqual(['a']);
		expect(next).not.toBe(selected);
	});
});

describe('selectRange', () => {
	it('returns inclusive ids between anchor and target (either direction)', () => {
		expect(selectRange(IDS, 1, 3)).toEqual(['b', 'c', 'd']);
		expect(selectRange(IDS, 3, 1)).toEqual(['b', 'c', 'd']);
	});

	it('returns a single id when indices match', () => {
		expect(selectRange(IDS, 2, 2)).toEqual(['c']);
	});

	it('returns empty for empty view', () => {
		expect(selectRange([], 0, 0)).toEqual([]);
	});

	it('clamps out-of-range indices to the view', () => {
		expect(selectRange(IDS, -2, 1)).toEqual(['a', 'b']);
		expect(selectRange(IDS, 3, 99)).toEqual(['d', 'e']);
	});
});

describe('applyRowClickSelection', () => {
	it('ctrl toggles the clicked id and updates lastIndex', () => {
		expect(
			applyRowClickSelection({
				selected: ['a'],
				ids: IDS,
				index: 2,
				lastIndex: 0,
				ctrl: true,
				shift: false
			})
		).toEqual({ nextSelected: ['a', 'c'], nextLastIndex: 2 });

		expect(
			applyRowClickSelection({
				selected: ['a', 'c'],
				ids: IDS,
				index: 2,
				lastIndex: 2,
				ctrl: true,
				shift: false
			})
		).toEqual({ nextSelected: ['a'], nextLastIndex: 2 });
	});

	it('shift selects the inclusive range from lastIndex and keeps the anchor', () => {
		expect(
			applyRowClickSelection({
				selected: ['x'],
				ids: IDS,
				index: 3,
				lastIndex: 1,
				ctrl: false,
				shift: true
			})
		).toEqual({ nextSelected: ['b', 'c', 'd'], nextLastIndex: 1 });
	});

	it('a second shift click still ranges from the original anchor', () => {
		const first = applyRowClickSelection({
			selected: ['a'],
			ids: IDS,
			index: 2,
			lastIndex: 0,
			ctrl: false,
			shift: true
		});
		expect(first).toEqual({ nextSelected: ['a', 'b', 'c'], nextLastIndex: 0 });

		expect(
			applyRowClickSelection({
				selected: first.nextSelected,
				ids: IDS,
				index: 4,
				lastIndex: first.nextLastIndex,
				ctrl: false,
				shift: true
			})
		).toEqual({ nextSelected: ['a', 'b', 'c', 'd', 'e'], nextLastIndex: 0 });
	});

	it('shift with null lastIndex selects only the clicked row and sets lastIndex', () => {
		expect(
			applyRowClickSelection({
				selected: [],
				ids: IDS,
				index: 2,
				lastIndex: null,
				ctrl: false,
				shift: true
			})
		).toEqual({ nextSelected: ['c'], nextLastIndex: 2 });
	});

	it('shift wins over ctrl when both are set', () => {
		expect(
			applyRowClickSelection({
				selected: ['a'],
				ids: IDS,
				index: 3,
				lastIndex: 1,
				ctrl: true,
				shift: true
			})
		).toEqual({ nextSelected: ['b', 'c', 'd'], nextLastIndex: 1 });
	});

	it('plain click leaves selection and lastIndex unchanged', () => {
		expect(
			applyRowClickSelection({
				selected: ['a', 'b'],
				ids: IDS,
				index: 4,
				lastIndex: 0,
				ctrl: false,
				shift: false
			})
		).toEqual({ nextSelected: ['a', 'b'], nextLastIndex: 0 });
	});

	it('ctrl with out-of-range index is a no-op on selection', () => {
		expect(
			applyRowClickSelection({
				selected: ['a'],
				ids: IDS,
				index: 99,
				lastIndex: 0,
				ctrl: true,
				shift: false
			})
		).toEqual({ nextSelected: ['a'], nextLastIndex: 0 });
	});
});
