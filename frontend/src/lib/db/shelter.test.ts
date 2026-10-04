// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getShelterCode, getShelterDb, resolveShelterCode } from './shelter';
import { shelterStore } from '$lib/stores/shelter.svelte';

let mockRoles: string[] = [];

vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: {
		get user() {
			return { roles: mockRoles };
		}
	}
}));

describe('shelter database config', () => {
	beforeEach(() => {
		shelterStore.selectedShelterCode = undefined;
		shelterStore.listDefaultCode = undefined;
		mockRoles = [];
	});

	it('returns shelterStore.selectedShelterCode if it is set (e.g. SA selecting a shelter)', () => {
		shelterStore.selectedShelterCode = 'SH005';
		mockRoles = ['user', 'shelter:SH003']; // Should ignore role

		expect(getShelterCode()).toBe('SH005');
		expect(getShelterDb()).toBe('shelter_sh005');
	});

	it('falls back to the user role (e.g. shelter:SH003) when no shelter is selected', () => {
		mockRoles = ['user', 'shelter:SH003'];

		expect(getShelterCode()).toBe('SH003');
		expect(getShelterDb()).toBe('shelter_sh003');
	});

	it('falls back to SH001 when neither selection nor shelter role is present', () => {
		mockRoles = ['user', 'system_admin'];

		expect(getShelterCode()).toBe('SH001');
		expect(getShelterDb()).toBe('shelter_sh001');
	});

	it('resolveShelterCode returns null instead of SH001 when nothing scopes a shelter', () => {
		mockRoles = ['user', 'system_admin'];

		expect(resolveShelterCode()).toBeNull();
	});

	it('resolveShelterCode follows the same order as getShelterCode', () => {
		mockRoles = ['user', 'shelter:SH003'];
		expect(resolveShelterCode()).toBe('SH003');

		shelterStore.listDefaultCode = 'SH004';
		expect(resolveShelterCode()).toBe('SH004');

		shelterStore.selectedShelterCode = 'SH005';
		expect(resolveShelterCode()).toBe('SH005');
	});
});
