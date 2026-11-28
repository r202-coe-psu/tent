import { describe, it, expect, vi } from 'vitest';
import type { Evacuee } from '$lib/features/people';
import {
	clearLoaded,
	loadedSelectionState,
	pickableEvacuees,
	resolvePickerScan,
	type PickerScanDeps,
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

describe('resolvePickerScan (CR-233 FR-EQR-27/30)', () => {
	const ID = 'evacuee:01JABCDEFGHJKMNPQRSTVWXYZ0';
	const deps = (status: 'valid' | 'expired' | 'invalid'): PickerScanDeps => ({
		parse: (raw) => (raw.startsWith('evacuee:') ? { evacuee_id: ID, hash6: 'a1b2c3' } : null),
		check: vi.fn(async () =>
			status === 'expired'
				? { status, issued_at: null, current_printed_at: '2026-11-20T00:00:00Z' }
				: { status }
		),
		message: (v) => `rejected:${v.status}`
	});

	it('searches the evacuee id of a valid Person QR', async () => {
		await expect(resolvePickerScan(`${ID}@a1b2c3`, deps('valid'))).resolves.toEqual({
			kind: 'search',
			query: ID
		});
	});

	it('refuses an expired Person QR instead of searching it', async () => {
		await expect(resolvePickerScan(`${ID}@000000`, deps('expired'))).resolves.toEqual({
			kind: 'rejected',
			message: 'rejected:expired'
		});
	});

	it('refuses an invalid Person QR', async () => {
		await expect(resolvePickerScan(`${ID}@ffffff`, deps('invalid'))).resolves.toEqual({
			kind: 'rejected',
			message: 'rejected:invalid'
		});
	});

	it('searches a code that is not a Person QR as typed, without reading the prints log', async () => {
		const d = deps('valid');
		await expect(resolvePickerScan('  0812345678 ', d)).resolves.toEqual({
			kind: 'search',
			query: '0812345678'
		});
		expect(d.check).not.toHaveBeenCalled();
	});

	it('lets a prints-log read error propagate rather than treating the QR as valid', async () => {
		const d = { ...deps('valid'), check: async () => Promise.reject(new Error('offline')) };
		await expect(resolvePickerScan(`${ID}@a1b2c3`, d)).rejects.toThrow('offline');
	});
});
