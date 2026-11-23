// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { applyActiveShelterChoice, isSelectionProvisional, shelterStore } from './shelter.svelte';

const KEY = 'tent.activeShelterCode';

beforeEach(() => {
	localStorage.clear();
	shelterStore.selectedShelterCode = undefined;
	shelterStore.provisionalCode = undefined;
});

describe('applyActiveShelterChoice (#1473)', () => {
	it('selects a stand-in without remembering it', () => {
		applyActiveShelterChoice({ code: 'SH002', provisional: true });
		expect(shelterStore.selectedShelterCode).toBe('SH002');
		expect(isSelectionProvisional()).toBe(true);
		expect(localStorage.getItem(KEY)).toBeNull();
	});

	it('remembers the code once the choice settles, even when it is the same code', () => {
		applyActiveShelterChoice({ code: 'SH002', provisional: true });
		applyActiveShelterChoice({ code: 'SH002', provisional: false });
		expect(isSelectionProvisional()).toBe(false);
		expect(localStorage.getItem(KEY)).toBe('SH002');
	});

	it('forgets the remembered shelter when the choice is none (W2)', () => {
		localStorage.setItem(KEY, 'SH001');
		shelterStore.selectedShelterCode = 'SH001';
		applyActiveShelterChoice({ code: undefined, provisional: false });
		expect(shelterStore.selectedShelterCode).toBeUndefined();
		expect(localStorage.getItem(KEY)).toBeNull();
	});

	it('does not rewrite storage when nothing changed', () => {
		shelterStore.selectedShelterCode = 'SH001';
		localStorage.setItem(KEY, 'other');
		applyActiveShelterChoice({ code: 'SH001', provisional: false });
		expect(localStorage.getItem(KEY)).toBe('other');
	});

	it('treats a code picked by someone else as a real choice, not a stand-in', () => {
		applyActiveShelterChoice({ code: 'SH002', provisional: true });
		shelterStore.selectedShelterCode = 'SH001'; // e.g. the user picks in the back-office select
		expect(isSelectionProvisional()).toBe(false);
	});
});
