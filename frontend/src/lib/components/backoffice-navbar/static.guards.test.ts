import { beforeEach, describe, expect, it, vi } from 'vitest';

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
	requireEvacueeRegistration,
	requireIncidents,
	requireKitchen,
	requireManager,
	requireTicketAccess,
	requireVolunteerBackoffice,
	requireWarehouseAccess
} from '$lib/guards/auth';
import {
	backofficeNavbarGroups,
	canSeeNavNode,
	isGroup,
	type BackofficeNavbarNode
} from './static';

/**
 * Anti-drift (#842): every nav leaf whose page has a role guard must be visible exactly when that
 * guard lets the user in. `GUARD_OF` is the href → guard map; a nav href that is in neither map
 * fails the "unmapped" test, so a new menu cannot ship without a decision.
 */
type Guard = () => Promise<void>;
const GUARD_OF: Record<string, Guard> = {
	'/back-office/evacuee-management': requireEvacueeRegistration,
	'/back-office/volunteers': requireVolunteerBackoffice,
	'/back-office/referrals': requireManager,
	'/back-office/supply': requireWarehouseAccess,
	'/back-office/stock-donations': requireWarehouseAccess,
	'/back-office/distribution': requireWarehouseAccess,
	'/back-office/supply?tab=catalog': requireWarehouseAccess,
	'/back-office/tickets/kitchen': requireTicketAccess,
	'/back-office/kitchen': requireKitchen,
	'/back-office/shelters': requireManager,
	'/back-office/users': requireManager,
	'/back-office/master-data': requireManager,
	'/back-office/incidents': requireIncidents
};

/** No page guard (R2, #845), or a deliberately looser menu rule (kiosks, issue #842 Q3). */
const EXEMPT = new Set([
	'/back-office/shelters/readiness',
	'/back-office/dailysop',
	'/back-office/sop-parameters',
	'/back-office/kiosks',
	'/back-office/kiosks/banners'
]);

const leaves = (): BackofficeNavbarNode[] => {
	const walk = (nodes: BackofficeNavbarNode[]): BackofficeNavbarNode[] =>
		nodes.flatMap((n) => (isGroup(n) ? [n, ...walk(n.children)] : [n]));
	return backofficeNavbarGroups.flatMap((g) => walk(g.items));
};

const ROLE_SETS: string[][] = [
	[],
	['system_admin'],
	['_admin'],
	...[
		'shelter_manager',
		'registration_staff',
		'kitchen_staff',
		'warehouse_staff',
		'supply_coordinator',
		'volunteer_coordinator',
		'distribution_staff',
		'security_officer',
		'triage_staff',
		'medical_staff',
		'facility_staff'
	].flatMap((cap) => [
		['shelter:SH001', `SH001:${cap}`],
		['shelter:SH002', `SH002:${cap}`]
	]),
	['shelter:SH001', 'SH001:kitchen_staff', 'SH001:supply_coordinator']
];

async function allows(guard: Guard): Promise<boolean> {
	try {
		await guard();
		return true;
	} catch {
		return false;
	}
}

describe('sidebar visibility matches the page guards (#842)', () => {
	beforeEach(() => {
		mocks.selectedShelterCode = null;
	});

	it('maps every nav href to a guard or an explicit exemption', () => {
		const unmapped = leaves()
			.filter((n) => n.href && !isGroup(n))
			.map((n) => String(n.href))
			.filter((h) => !(h in GUARD_OF) && !EXEMPT.has(h));
		expect(unmapped).toEqual([]);
	});

	for (const [href, guard] of Object.entries(GUARD_OF)) {
		it(`${href}: visible exactly when its guard admits`, async () => {
			const node = leaves().find((n) => String(n.href) === href);
			expect(node, `nav node for ${href}`).toBeDefined();
			for (const roles of ROLE_SETS) {
				for (const selected of ['SH001', null]) {
					mocks.user = { roles };
					mocks.selectedShelterCode = selected;
					const visible = canSeeNavNode(node!, { roles, shelterCode: selected });
					expect(visible, `${href} roles=${roles} shelter=${selected}`).toBe(await allows(guard));
				}
			}
		});
	}
});
