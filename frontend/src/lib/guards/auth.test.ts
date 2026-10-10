import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolvePostLoginDestination, requireDistributionDesk, LANDING_ROUTE } from './auth';

const mocks = vi.hoisted(() => ({
	authStore: {
		isAuthenticated: true,
		user: { roles: [] as string[] } as { roles: string[] } | null,
		ensureInitialized: async () => {}
	},
	shelterStore: { selectedShelterCode: 'SH001' as string | null }
}));

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('$lib/stores/auth.svelte', () => ({ authStore: mocks.authStore }));
vi.mock('$lib/stores/shelter.svelte', () => ({ shelterStore: mocks.shelterStore }));
vi.mock('$lib/features/users', () => ({
	fetchAuthStatus: async () => ({
		must_change_password: false,
		has_security_question: true,
		pending_mfa: false
	})
}));

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

describe('requireDistributionDesk', () => {
	beforeEach(() => {
		mocks.authStore.isAuthenticated = true;
		mocks.shelterStore.selectedShelterCode = 'SH001';
	});

	const withRoles = (roles: string[]) => {
		mocks.authStore.user = { roles };
		return requireDistributionDesk();
	};

	it.each([
		['system_admin', ['system_admin']],
		['shelter_manager', ['shelter:SH001', 'SH001:shelter_manager']],
		['supply_coordinator', ['shelter:SH001', 'SH001:supply_coordinator']],
		['warehouse_staff', ['shelter:SH001', 'SH001:warehouse_staff']],
		['registration_staff', ['shelter:SH001', 'SH001:registration_staff']]
	])('lets %s into the desk', async (_label, roles) => {
		await expect(withRoles(roles)).resolves.toBeUndefined();
	});

	it.each([
		['kitchen_staff', ['shelter:SH001', 'SH001:kitchen_staff']],
		['triage_staff', ['shelter:SH001', 'SH001:triage_staff']],
		['a shelter scope only', ['shelter:SH001']]
	])('redirects %s to the landing route', async (_label, roles) => {
		await expect(withRoles(roles)).rejects.toMatchObject({ status: 302, location: LANDING_ROUTE });
	});

	it('checks the capability against the selected shelter', async () => {
		mocks.shelterStore.selectedShelterCode = 'SH002';
		await expect(
			withRoles(['shelter:SH001', 'shelter:SH002', 'SH001:registration_staff'])
		).rejects.toMatchObject({ status: 302, location: LANDING_ROUTE });
	});

	it('sends unauthenticated users to login first', async () => {
		mocks.authStore.isAuthenticated = false;
		await expect(withRoles(['system_admin'])).rejects.toMatchObject({
			status: 302,
			location: '/login'
		});
	});
});
