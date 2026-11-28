// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { langState } from '$lib/states/i18n.svelte';
import { shelterStore } from '$lib/stores/shelter.svelte';
import { getTranslation } from '$lib/utils/i18n';
import type { Evacuee } from '../../domain/people';
import { EVACUEE_PROFILE_I18N } from '../_constants/evacuee-profile.i18n';
import EvacueeProfileView from './evacuee-profile-view.svelte';

const mockAuth = vi.hoisted(() => ({
	user: null as { name: string; roles: string[] } | null,
	ensureInitialized: async () => {}
}));

vi.mock('$lib/stores/auth.svelte', () => ({ authStore: mockAuth }));
vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('$app/state', () => ({
	page: { url: new URL('http://localhost/'), params: {}, route: { id: null } }
}));

const evacuee = {
	_id: 'evacuee:test-123',
	_rev: '1-abc',
	type: 'evacuee',
	schema_v: 9,
	first_name: 'Anna',
	last_name: 'Schmidt',
	gender: 'female',
	age: 40,
	country: 'GERMANY',
	phone: null,
	vulnerable_groups: [],
	special_needs: [],
	current_stay: { status: 'active', zone: 'A', since: '2026-09-02T10:00:00.000Z' },
	privacy: { search_excluded: false },
	registered_via: 'staff',
	household_id: null,
	shelter_code: 'SH002',
	created_at: '2026-09-02T10:00:00.000Z',
	created_by: 'staff-1',
	updated_at: '2026-09-02T10:00:00.000Z'
} as Evacuee;

// The view builds a dozen TanStack hooks on mount and needs no QueryClient here — serve fixed results.
const { query, mutation } = vi.hoisted(() => ({
	query: <T>(data: T) => ({ data, isPending: false, isLoading: false, error: null }),
	mutation: () => ({ mutateAsync: vi.fn(async () => ({})), isPending: false })
}));

// Mock at the hooks module: the barrel re-exports it, and the privacy card imports it directly.
vi.mock('../../application/queries', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../application/queries')>()),
	useEvacuee: () => query(evacuee),
	useHousehold: () => query(null),
	useHouseholds: () => query([]),
	useHouseholdMembers: () => query([]),
	useMedicalByEvacuee: () => query(null),
	useScreeningsByEvacuee: () => query([]),
	useMovementsByEvacuee: () => query([]),
	usePatchEvacuee: mutation,
	usePatchHousehold: mutation,
	useChangeEvacueeZone: mutation,
	useCheckInEvacuee: mutation,
	useCheckOutEvacuee: mutation,
	useConfirmRoom: mutation,
	useRevertEvacueeStatus: mutation,
	useRecordMovement: mutation,
	useCreateMedical: mutation,
	usePatchMedical: mutation,
	useDeleteMedical: mutation,
	useCreateScreening: mutation,
	useSetSearchVisibility: mutation
}));
vi.mock('../../application/evacuee-qr-prints', () => ({ useEvacueeQrPrints: () => query([]) }));
// The QR modal (always mounted for writers) grabs the client only to invalidate after a print.
vi.mock('@tanstack/svelte-query', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tanstack/svelte-query')>()),
	useQueryClient: () => ({ invalidateQueries: vi.fn() })
}));
// The health card's master-data queries need a QueryClient; serve empty results instead.
vi.mock('$lib/features/master-data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/master-data')>()),
	useMasterData: () => query({ items: [] })
}));
vi.mock('$lib/features/shelters', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/shelters')>()),
	useShelter: () => query({ name: 'Riverside shelter', zones: [] })
}));
vi.mock('$lib/features/images', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/images')>()),
	useSaveImage: mutation
}));

const OVERRIDE_STATUSES = [
	'pre_registered',
	'kiosk_registered',
	'arriving',
	'active',
	'room_confirmed',
	'temporary_leave',
	'transferred',
	'checked_out',
	'deceased',
	'cancelled'
] as const;

let instance: ReturnType<typeof mount> | null = null;

async function settle() {
	flushSync();
	await tick();
	flushSync();
}

const labelOf = (status: (typeof OVERRIDE_STATUSES)[number]) =>
	getTranslation(EVACUEE_PROFILE_I18N, 'en').view.status[status].label;

/** Mount the real profile view as `roles` working in SH002, open "change status", return the radio labels. */
async function openStatusModalAs(roles: string[]): Promise<string[]> {
	langState.current = 'en';
	mockAuth.user = { name: 'staff-1', roles };
	shelterStore.selectedShelterCode = 'SH002';
	instance = mount(EvacueeProfileView, {
		target: document.body,
		props: { evacueeId: evacuee._id, readonly: false }
	});
	await settle();
	const changeStatus = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
		b.textContent?.includes('Change status')
	);
	expect(changeStatus, 'the "Change status" button is rendered').toBeDefined();
	changeStatus!.click();
	await settle();
	return [...document.body.querySelectorAll<HTMLElement>('[role="radio"]')].map(
		(el) => el.textContent?.trim() ?? ''
	);
}

afterEach(async () => {
	if (instance) unmount(instance);
	instance = null;
	// bits-ui body-scroll-lock cleans up on a 24ms timer; let it run before the env tears down
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
	mockAuth.user = null;
	shelterStore.selectedShelterCode = undefined;
	langState.current = 'th';
	vi.clearAllMocks();
});

describe('EvacueeProfileView change-status modal (canRevertStatus)', () => {
	it('opens for a shelter manager of the current shelter and offers the full override set', async () => {
		// Several shelters means compound capability roles (a flat `shelter_manager` only counts with one scope).
		const labels = await openStatusModalAs([
			'shelter:SH001',
			'shelter:SH002',
			'SH001:shelter_manager',
			'SH002:shelter_manager'
		]);
		for (const status of OVERRIDE_STATUSES) {
			expect(
				labels.some((l) => l.includes(labelOf(status))),
				status
			).toBe(true);
		}
		expect(labels).toHaveLength(OVERRIDE_STATUSES.length);
	});

	it('opens for registration staff without offering revert targets', async () => {
		const labels = await openStatusModalAs([
			'shelter:SH001',
			'shelter:SH002',
			'SH002:registration_staff'
		]);
		const offered = (status: (typeof OVERRIDE_STATUSES)[number]) =>
			labels.some((l) => l.includes(labelOf(status)));
		expect(labels.length).toBeGreaterThan(0);
		expect(offered('temporary_leave')).toBe(true);
		expect(offered('checked_out')).toBe(true);
		expect(offered('arriving')).toBe(false);
		expect(offered('pre_registered')).toBe(false);
	});

	it('offers the full override set to a system admin', async () => {
		const labels = await openStatusModalAs(['system_admin']);
		expect(labels).toHaveLength(OVERRIDE_STATUSES.length);
	});
});
