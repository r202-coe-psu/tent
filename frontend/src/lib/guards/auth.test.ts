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
	confineKioskStaffOnly,
	resolvePostLoginDestination,
	requireDistributionDesk,
	requireKioskManagement,
	requireMedicalScreening,
	requireVolunteerBackoffice,
	requireWarehouseAccess,
	LANDING_ROUTE,
	type DeskFallbackHref
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

describe('requireDistributionDesk (Station 4 route guard)', () => {
	beforeEach(() => {
		mocks.user = { roles: [] };
		mocks.selectedShelterCode = null;
	});

	it('admits SA, SM and DST of the selected shelter (CR-161 R5)', async () => {
		expect(await passes(requireDistributionDesk, ['system_admin'])).toBe(true);
		for (const cap of ['shelter_manager', 'distribution_staff']) {
			expect(await passes(requireDistributionDesk, ['shelter:SH001', `SH001:${cap}`])).toBe(true);
		}
	});

	it('redirects REG, SC, WH, other staff roles and a bare shelter scope', async () => {
		for (const cap of [
			'registration_staff',
			'supply_coordinator',
			'warehouse_staff',
			'kitchen_staff',
			'triage_staff'
		]) {
			expect(await passes(requireDistributionDesk, ['shelter:SH001', `SH001:${cap}`])).toBe(false);
		}
		expect(await passes(requireDistributionDesk, ['shelter:SH001'])).toBe(false);
	});

	it('is scoped to the selected shelter', async () => {
		for (const cap of ['shelter_manager', 'distribution_staff']) {
			const roles = ['shelter:SH001', 'shelter:SH002', `SH001:${cap}`];
			expect(await passes(requireDistributionDesk, roles, 'SH001')).toBe(true);
			expect(await passes(requireDistributionDesk, roles, 'SH002')).toBe(false);
		}
	});

	it('redirects an unauthenticated visitor to login', async () => {
		mocks.user = null;
		await expect(requireDistributionDesk()).rejects.toMatchObject({
			status: 302,
			location: '/login'
		});
	});
});

describe('requireWarehouseAccess desk fallback (bulk pool links)', () => {
	const deskFallback: DeskFallbackHref = '/onsite/distribution?mode=supplies&tab=returns&pool=p1';

	async function outcome(roles: string[], fallback?: DeskFallbackHref | null) {
		mocks.user = { roles };
		mocks.selectedShelterCode = 'SH001';
		try {
			await requireWarehouseAccess(undefined, { deskFallback: fallback });
			return 'pass';
		} catch (e) {
			return (e as { status: number; location: string }).status === 302
				? (e as { location: string }).location
				: 'error';
		}
	}

	it('sends distribution_staff to the desk when a fallback is given', async () => {
		expect(await outcome(['shelter:SH001', 'SH001:distribution_staff'], deskFallback)).toBe(
			deskFallback
		);
	});

	it('sends distribution_staff to the landing route without a fallback', async () => {
		const roles = ['shelter:SH001', 'SH001:distribution_staff'];
		expect(await outcome(roles)).toBe(LANDING_ROUTE);
		expect(await outcome(roles, null)).toBe(LANDING_ROUTE);
	});

	it('does not redirect SA, SM or warehouse-side staff', async () => {
		expect(await outcome(['system_admin'], deskFallback)).toBe('pass');
		expect(await outcome(['shelter:SH001', 'SH001:shelter_manager'], deskFallback)).toBe('pass');
		for (const cap of ['warehouse_staff', 'supply_coordinator']) {
			expect(await outcome(['shelter:SH001', `SH001:${cap}`], deskFallback)).toBe('pass');
		}
	});

	it('sends users without desk access to the landing route', async () => {
		expect(await outcome(['shelter:SH001', 'SH001:kitchen_staff'], deskFallback)).toBe(
			LANDING_ROUTE
		);
	});
});

describe('requireKioskManagement (/back-office/kiosks)', () => {
	beforeEach(() => {
		mocks.user = { roles: [] };
		mocks.selectedShelterCode = null;
	});

	it('admits SA, SM and kiosk_staff of the selected shelter (FR-SBO-20)', async () => {
		expect(await passes(requireKioskManagement, ['system_admin'], null)).toBe(true);
		for (const cap of ['shelter_manager', 'kiosk_staff']) {
			expect(await passes(requireKioskManagement, ['shelter:SH001', `SH001:${cap}`])).toBe(true);
		}
	});

	it('redirects other staff roles and a bare shelter scope', async () => {
		for (const cap of ['registration_staff', 'distribution_staff', 'kitchen_staff']) {
			expect(await passes(requireKioskManagement, ['shelter:SH001', `SH001:${cap}`])).toBe(false);
		}
		expect(await passes(requireKioskManagement, ['shelter:SH001'])).toBe(false);
	});

	it('is scoped to the selected shelter (AC-SBO-15)', async () => {
		const roles = [
			'shelter:SH001',
			'shelter:SH002',
			'SH001:kiosk_staff',
			'SH002:registration_staff'
		];
		expect(await passes(requireKioskManagement, roles, 'SH001')).toBe(true);
		expect(await passes(requireKioskManagement, roles, 'SH002')).toBe(false);
	});
});

describe('confineKioskStaffOnly (back-office layout, FR-SBO-29)', () => {
	const kioskOnly = ['shelter:SH001', 'SH001:kiosk_staff'];

	beforeEach(() => {
		mocks.selectedShelterCode = 'SH001';
	});

	it('sends a kiosk_staff-only user from another back-office page to the portal', () => {
		mocks.user = { roles: kioskOnly };
		expect(() => confineKioskStaffOnly('/back-office/evacuee-management')).toThrow(
			expect.objectContaining({ status: 302, location: '/portal' })
		);
		expect(() => confineKioskStaffOnly('/back-office')).toThrow(
			expect.objectContaining({ location: '/portal' })
		);
	});

	it('lets a kiosk_staff-only user stay on the scanners page', () => {
		mocks.user = { roles: kioskOnly };
		expect(() => confineKioskStaffOnly('/back-office/kiosks')).not.toThrow();
	});

	it('leaves users with another capability in the selected shelter alone', () => {
		mocks.user = { roles: [...kioskOnly, 'SH001:registration_staff'] };
		expect(() => confineKioskStaffOnly('/back-office/evacuee-management')).not.toThrow();
		mocks.user = { roles: ['system_admin'] };
		expect(() => confineKioskStaffOnly('/back-office/evacuee-management')).not.toThrow();
	});

	it('follows the selected shelter', () => {
		mocks.user = {
			roles: ['shelter:SH001', 'shelter:SH002', 'SH001:kiosk_staff', 'SH002:shelter_manager']
		};
		mocks.selectedShelterCode = 'SH002';
		expect(() => confineKioskStaffOnly('/back-office/evacuee-management')).not.toThrow();
		mocks.selectedShelterCode = 'SH001';
		expect(() => confineKioskStaffOnly('/back-office/evacuee-management')).toThrow();
	});
});
