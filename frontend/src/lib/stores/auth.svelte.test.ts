import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getSessionMock = vi.fn();
const sessionLoginMock = vi.fn();
const sessionLogoutMock = vi.fn();

const storage = new Map<string, string>();

vi.mock('$app/environment', () => ({ browser: true }));

vi.mock('$lib/db/couch', () => ({
	getSession: (...args: unknown[]) => getSessionMock(...args),
	sessionLogin: (...args: unknown[]) => sessionLoginMock(...args),
	sessionLogout: (...args: unknown[]) => sessionLogoutMock(...args)
}));

vi.mock('$lib/stores/shelter.svelte', () => ({
	shelterStore: { selectedShelterCode: undefined }
}));

describe('authStore.ensureInitialized', () => {
	beforeEach(() => {
		vi.resetModules();
		storage.clear();
		vi.stubGlobal('localStorage', {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => {
				storage.set(key, value);
			},
			removeItem: (key: string) => {
				storage.delete(key);
			},
			clear: () => {
				storage.clear();
			}
		});
		getSessionMock.mockReset();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('returns immediately when a cached identity exists', async () => {
		storage.set('auth:user', JSON.stringify({ name: 'demo', roles: ['staff'] }));
		let resolveSession!: (value: null) => void;
		getSessionMock.mockReturnValue(
			new Promise((resolve) => {
				resolveSession = resolve;
			})
		);

		const { authStore } = await import('./auth.svelte');

		const init = authStore.ensureInitialized();
		await expect(init).resolves.toBeUndefined();
		expect(authStore.isAuthenticated).toBe(true);
		expect(getSessionMock).toHaveBeenCalledOnce();

		resolveSession(null);
		await vi.waitFor(() => expect(authStore.needsReauth).toBe(true));
		expect(authStore.isAuthenticated).toBe(true);
	});

	it('awaits getSession when no cached identity exists', async () => {
		getSessionMock.mockResolvedValue({ name: 'demo', roles: ['staff'] });

		const { authStore } = await import('./auth.svelte');
		await authStore.ensureInitialized();

		expect(authStore.isAuthenticated).toBe(true);
		expect(authStore.needsReauth).toBe(false);
	});

	it('keeps cached identity when getSession times out or fails', async () => {
		storage.set('auth:user', JSON.stringify({ name: 'demo', roles: ['staff'] }));
		getSessionMock.mockRejectedValue(new Error('network down'));

		const { authStore } = await import('./auth.svelte');
		await authStore.ensureInitialized();
		await vi.waitFor(() => expect(getSessionMock).toHaveBeenCalled());

		expect(authStore.isAuthenticated).toBe(true);
		expect(authStore.needsReauth).toBe(false);
	});
});
