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

vi.mock('$lib/features/users', () => ({
	invalidateAuthStatusRequest: vi.fn(),
	clearMfaOk: vi.fn().mockResolvedValue({ ok: true })
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

describe('authStore session expiry', () => {
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
		storage.set('auth:user', JSON.stringify({ name: 'demo', roles: ['staff'] }));
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	async function loadStore() {
		const { authStore } = await import('./auth.svelte');
		const { CouchAuthError } = await import('$lib/utils/errors');
		return { authStore, CouchAuthError };
	}

	it('flags a Couch 401 immediately without calling /_session', async () => {
		const { authStore, CouchAuthError } = await loadStore();
		await expect(authStore.handleAuthFailure(new CouchAuthError(401))).resolves.toBe('expired');
		expect(authStore.needsReauth).toBe(true);
		expect(getSessionMock).not.toHaveBeenCalled();
	});

	it('is a no-op without a cached identity', async () => {
		storage.clear();
		const { authStore, CouchAuthError } = await loadStore();
		await authStore.handleAuthFailure(new CouchAuthError(401));
		authStore.markNeedsReauth();
		expect(authStore.needsReauth).toBe(false);
	});

	it('confirms a 403 against /_session: anonymous means expired', async () => {
		getSessionMock.mockResolvedValue(null);
		const { authStore, CouchAuthError } = await loadStore();
		await expect(authStore.handleAuthFailure(new CouchAuthError(403))).resolves.toBe('expired');
		expect(authStore.needsReauth).toBe(true);
	});

	it('treats a 403 with a valid session as a permission denial (no modal)', async () => {
		getSessionMock.mockResolvedValue({ name: 'demo', roles: ['staff'] });
		const { authStore, CouchAuthError } = await loadStore();
		await expect(authStore.handleAuthFailure(new CouchAuthError(403))).resolves.toBe(
			'permission-denied'
		);
		expect(authStore.needsReauth).toBe(false);
	});

	it('confirms a BFF 401 (plain error with status) the same way', async () => {
		getSessionMock.mockResolvedValue({ name: 'demo', roles: ['staff'] });
		const { authStore } = await loadStore();
		const bff = Object.assign(new Error('Incorrect password'), { status: 401 });
		await expect(authStore.handleAuthFailure(bff)).resolves.toBe('permission-denied');
		expect(authStore.needsReauth).toBe(false);
	});

	it('never opens the modal when /_session is unreachable (offline)', async () => {
		getSessionMock.mockRejectedValue(new TypeError('Failed to fetch'));
		const { authStore, CouchAuthError } = await loadStore();
		await expect(authStore.handleAuthFailure(new CouchAuthError(403))).resolves.toBe('ignored');
		expect(authStore.needsReauth).toBe(false);
	});

	it('ignores network errors and unrelated errors', async () => {
		const { authStore } = await loadStore();
		await expect(authStore.handleAuthFailure(new TypeError('Failed to fetch'))).resolves.toBe(
			'ignored'
		);
		await expect(authStore.handleAuthFailure(new Error('boom'))).resolves.toBe('ignored');
		expect(authStore.needsReauth).toBe(false);
		expect(getSessionMock).not.toHaveBeenCalled();
	});

	it('single-flights concurrent unverified failures into one /_session call', async () => {
		let resolveSession!: (value: null) => void;
		getSessionMock.mockReturnValue(
			new Promise((resolve) => {
				resolveSession = resolve;
			})
		);
		const { authStore, CouchAuthError } = await loadStore();
		const results = Promise.all([
			authStore.handleAuthFailure(new CouchAuthError(403)),
			authStore.handleAuthFailure(new CouchAuthError(403)),
			authStore.handleAuthFailure(new CouchAuthError(403))
		]);
		resolveSession(null);
		await expect(results).resolves.toEqual(['expired', 'expired', 'expired']);
		expect(getSessionMock).toHaveBeenCalledTimes(1);
	});

	it('clears the flag after a successful re-login so a later expiry opens again', async () => {
		sessionLoginMock.mockResolvedValue({ name: 'demo', roles: ['staff'] });
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })));
		const { authStore, CouchAuthError } = await loadStore();
		await authStore.handleAuthFailure(new CouchAuthError(401));
		expect(authStore.needsReauth).toBe(true);
		await authStore.login({ name: 'demo', password: 'x' });
		expect(authStore.needsReauth).toBe(false);
		await authStore.handleAuthFailure(new CouchAuthError(401));
		expect(authStore.needsReauth).toBe(true);
	});

	it('revalidateSession flags expiry when the cookie is gone and clears it when valid again', async () => {
		getSessionMock.mockResolvedValue(null);
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })));
		const { authStore } = await loadStore();
		await authStore.revalidateSession();
		expect(authStore.needsReauth).toBe(true);
		getSessionMock.mockResolvedValue({ name: 'demo', roles: ['staff'] });
		await authStore.revalidateSession();
		expect(authStore.needsReauth).toBe(false);
	});
});
