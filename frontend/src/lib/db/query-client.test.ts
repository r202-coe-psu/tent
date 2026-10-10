import { describe, expect, it, vi } from 'vitest';
import { CouchAuthError, NetworkError } from '$lib/utils/errors';
import { createAppQueryClient, type AuthFailureResolution } from './query-client';

function setup(resolution: AuthFailureResolution = 'expired') {
	const onAuthFailure = vi.fn().mockResolvedValue(resolution);
	const onMutationExpired = vi.fn();
	const onMutationPermissionDenied = vi.fn();
	const client = createAppQueryClient({
		onAuthFailure,
		onMutationExpired,
		onMutationPermissionDenied
	});
	return { client, onAuthFailure, onMutationExpired, onMutationPermissionDenied };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createAppQueryClient', () => {
	it('routes a failed query with an auth error to onAuthFailure without retrying', async () => {
		const { client, onAuthFailure } = setup();
		const queryFn = vi.fn().mockRejectedValue(new CouchAuthError(401));
		await client.fetchQuery({ queryKey: ['a'], queryFn }).catch(() => {});
		expect(queryFn).toHaveBeenCalledTimes(1);
		expect(onAuthFailure).toHaveBeenCalledTimes(1);
	});

	it('detects a BFF 401 that carries only a status', async () => {
		const { client, onAuthFailure } = setup();
		const bff = Object.assign(new Error('Unauthorized'), { status: 401 });
		await client
			.fetchQuery({ queryKey: ['b'], queryFn: () => Promise.reject(bff) })
			.catch(() => {});
		expect(onAuthFailure).toHaveBeenCalledWith(bff);
	});

	it('ignores network and unrelated errors', async () => {
		const { client, onAuthFailure } = setup();
		await client
			.fetchQuery({ queryKey: ['c'], queryFn: () => Promise.reject(new NetworkError()) })
			.catch(() => {});
		await client
			.fetchQuery({ queryKey: ['d'], queryFn: () => Promise.reject(new Error('boom')) })
			.catch(() => {});
		expect(onAuthFailure).not.toHaveBeenCalled();
	});

	it('toasts once per expired mutation and never retries it', async () => {
		const { client, onMutationExpired } = setup('expired');
		const mutationFn = vi.fn().mockRejectedValue(new CouchAuthError(401));
		await client
			.getMutationCache()
			.build(client, { mutationFn })
			.execute(undefined)
			.catch(() => {});
		await flush();
		expect(mutationFn).toHaveBeenCalledTimes(1);
		expect(onMutationExpired).toHaveBeenCalledTimes(1);
	});

	it('reports a permission denial for a signed-in user instead of expiry', async () => {
		const { client, onMutationExpired, onMutationPermissionDenied } = setup('permission-denied');
		await client
			.getMutationCache()
			.build(client, { mutationFn: () => Promise.reject(new CouchAuthError(403)) })
			.execute(undefined)
			.catch(() => {});
		await flush();
		expect(onMutationExpired).not.toHaveBeenCalled();
		expect(onMutationPermissionDenied).toHaveBeenCalledTimes(1);
	});

	it('stays silent when the session cannot be verified (offline)', async () => {
		const { client, onMutationExpired, onMutationPermissionDenied } = setup('ignored');
		await client
			.getMutationCache()
			.build(client, { mutationFn: () => Promise.reject(new CouchAuthError(403)) })
			.execute(undefined)
			.catch(() => {});
		await flush();
		expect(onMutationExpired).not.toHaveBeenCalled();
		expect(onMutationPermissionDenied).not.toHaveBeenCalled();
	});
});
