import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
	user: { roles: [] as string[] } as { roles: string[] } | null,
	selectedShelterCode: null as string | null
}));

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: {
		ensureInitialized: async () => {},
		get isAuthenticated() {
			return mocks.user !== null;
		},
		get user() {
			return mocks.user;
		}
	}
}));
vi.mock('$lib/stores/shelter.svelte', () => ({
	shelterStore: {
		get selectedShelterCode() {
			return mocks.selectedShelterCode;
		}
	}
}));
vi.mock('$lib/features/users', () => ({
	fetchAuthStatus: async () => ({
		must_change_password: false,
		has_security_question: true,
		pending_mfa: false
	})
}));

import {
	resolvePostLoginDestination,
	requireMedicalScreening,
	requireVolunteerBackoffice,
	LANDING_ROUTE
} from './auth';

describe('resolvePostLoginDestination (CR-124)', () => {
	it('sends force-setup before MFA when password/security setup is required', () => {
		expect(
			resolvePostLoginDestination({
				must_change_password: true,
				has_security_question: false,
				pending_mfa: true
			})
		).toBe('/force-setup');

		expect(
			resolvePostLoginDestination({
				must_change_password: false,
				has_security_question: false,
				pending_mfa: true
			})
		).toBe('/force-setup');
	});

	it('sends MFA challenge when enrolled and pending after force-setup is clear', () => {
		expect(
			resolvePostLoginDestination({
				must_change_password: false,
				has_security_question: true,
				pending_mfa: true
			})
		).toBe('/mfa-challenge');
	});

	it('lands on portal when not pending MFA', () => {
		expect(
			resolvePostLoginDestination({
				must_change_password: false,
				has_security_question: true,
				pending_mfa: false
			})
		).toBe(LANDING_ROUTE);
	});

	it('routes CouchDB server admin (_admin) directly to portal regardless of force-setup flags', () => {
		expect(
			resolvePostLoginDestination({
				roles: ['_admin'],
				must_change_password: false,
				has_security_question: false,
				pending_mfa: false
			})
		).toBe(LANDING_ROUTE);

		expect(
			resolvePostLoginDestination({
				roles: ['_admin'],
				must_change_password: true,
				has_security_question: false,
				pending_mfa: true
			})
		).toBe(LANDING_ROUTE);
	});
});

/** Run a guard as a user and report whether it let them through (true) or redirected (false). */
async function passes(
	guard: () => Promise<void>,
	roles: string[],
	selectedShelterCode: string | null = 'SH001'
): Promise<boolean> {
	mocks.user = { roles };
	mocks.selectedShelterCode = selectedShelterCode;
	try {
		await guard();
		return true;
	} catch (e) {
		expect(e).toMatchObject({ status: 302, location: LANDING_ROUTE });
		return false;
	}
}

describe('requireMedicalScreening (Station 2 route guard)', () => {
	beforeEach(() => {
		mocks.user = { roles: [] };
		mocks.selectedShelterCode = null;
	});

	it('admits SA, SM, REG, TRG and MED of the selected shelter', async () => {
		expect(await passes(requireMedicalScreening, ['system_admin'])).toBe(true);
		expect(await passes(requireMedicalScreening, ['shelter:SH001', 'SH001:shelter_manager'])).toBe(
			true
		);
		expect(
			await passes(requireMedicalScreening, ['shelter:SH001', 'SH001:registration_staff'])
		).toBe(true);
		expect(await passes(requireMedicalScreening, ['shelter:SH001', 'SH001:triage_staff'])).toBe(
			true
		);
		expect(await passes(requireMedicalScreening, ['shelter:SH001', 'SH001:medical_staff'])).toBe(
			true
		);
	});

	it('does not widen beyond REG/TRG/MED/SM/SA', async () => {
		for (const cap of [
			'kitchen_staff',
			'supply_coordinator',
			'warehouse_staff',
			'volunteer_coordinator',
			'security_officer',
			'facility_staff'
		]) {
			expect(await passes(requireMedicalScreening, ['shelter:SH001', `SH001:${cap}`])).toBe(false);
		}
	});

	it('is scoped to the selected shelter', async () => {
		const roles = ['shelter:SH001', 'shelter:SH002', 'SH001:registration_staff'];
		expect(await passes(requireMedicalScreening, roles, 'SH001')).toBe(true);
		expect(await passes(requireMedicalScreening, roles, 'SH002')).toBe(false);
	});
});

describe('requireVolunteerBackoffice (/back-office/volunteers)', () => {
	beforeEach(() => {
		mocks.user = { roles: [] };
		mocks.selectedShelterCode = null;
	});

	it('admits SA, SM and volunteer_coordinator of the selected shelter', async () => {
		expect(await passes(requireVolunteerBackoffice, ['system_admin'])).toBe(true);
		expect(
			await passes(requireVolunteerBackoffice, ['shelter:SH001', 'SH001:shelter_manager'])
		).toBe(true);
		expect(
			await passes(requireVolunteerBackoffice, ['shelter:SH001', 'SH001:volunteer_coordinator'])
		).toBe(true);
	});

	it('redirects other staff roles and users without roles', async () => {
		for (const cap of [
			'registration_staff',
			'triage_staff',
			'medical_staff',
			'kitchen_staff',
			'supply_coordinator',
			'warehouse_staff',
			'security_officer',
			'facility_staff'
		]) {
			expect(await passes(requireVolunteerBackoffice, ['shelter:SH001', `SH001:${cap}`])).toBe(
				false
			);
		}
		expect(await passes(requireVolunteerBackoffice, [])).toBe(false);
	});

	it('is scoped to the selected shelter', async () => {
		const roles = ['shelter:SH001', 'shelter:SH002', 'SH001:volunteer_coordinator'];
		expect(await passes(requireVolunteerBackoffice, roles, 'SH001')).toBe(true);
		expect(await passes(requireVolunteerBackoffice, roles, 'SH002')).toBe(false);
	});

	it('redirects an unauthenticated visitor to login', async () => {
		mocks.user = null;
		await expect(requireVolunteerBackoffice()).rejects.toMatchObject({
			status: 302,
			location: '/login'
		});
	});
});
