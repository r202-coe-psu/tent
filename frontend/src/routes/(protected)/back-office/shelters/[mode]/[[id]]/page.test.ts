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

import { load } from './+page';

type LoadEvent = Parameters<typeof load>[0];

/** Run the page load with the real guards; true when it lets the user in. */
async function opens(
	mode: string,
	id: string | undefined,
	roles: string[],
	selected: string | null
): Promise<boolean> {
	mocks.user = { roles };
	mocks.selectedShelterCode = selected;
	const event = {
		params: { mode, id },
		fetch,
		url: new URL(`http://localhost/back-office/shelters/${mode}/${id ?? ''}`)
	} as unknown as LoadEvent;
	try {
		await load(event);
		return true;
	} catch (e) {
		expect(e).toMatchObject({ status: 302, location: '/portal' });
		return false;
	}
}

const SM_SH001 = ['shelter:SH001', 'SH001:shelter_manager'];

describe('/back-office/shelters/[mode]/[[id]] guard', () => {
	beforeEach(() => {
		mocks.user = { roles: [] };
		mocks.selectedShelterCode = null;
	});

	it('lets an SM edit their own shelter', async () => {
		expect(await opens('edit', 'SH001', SM_SH001, 'SH001')).toBe(true);
	});

	it('redirects an SM who edits the URL to another shelter', async () => {
		expect(await opens('edit', 'SH002', SM_SH001, 'SH001')).toBe(false);
	});

	it('checks the shelter in the URL, not the selected one, for a multi-shelter user', async () => {
		const roles = [
			'shelter:SH001',
			'SH001:registration_staff',
			'shelter:SH002',
			'SH002:shelter_manager'
		];
		expect(await opens('edit', 'SH001', roles, 'SH002')).toBe(false);
		expect(await opens('edit', 'SH002', roles, 'SH001')).toBe(true);
	});

	it('lets SA edit any shelter with none selected', async () => {
		expect(await opens('edit', 'SH005', ['system_admin'], null)).toBe(true);
	});

	it('keeps create for system_admin only', async () => {
		expect(await opens('create', undefined, SM_SH001, 'SH001')).toBe(false);
		expect(await opens('create', undefined, ['system_admin'], null)).toBe(true);
	});
});
