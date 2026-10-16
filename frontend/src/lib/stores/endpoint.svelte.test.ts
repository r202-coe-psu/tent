import { beforeEach, describe, expect, it, vi } from 'vitest';

const probeCentral = vi.fn();
const revalidateSession = vi.fn();

vi.mock('$app/environment', () => ({ browser: true }));

vi.mock('$lib/db/couch-db', () => ({
	probeCentral: (...args: unknown[]) => probeCentral(...args)
}));

vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: { revalidateSession: (...args: unknown[]) => revalidateSession(...args) }
}));

describe('endpointStore.forceRetry', () => {
	beforeEach(() => {
		vi.resetModules();
		probeCentral.mockReset();
		revalidateSession.mockReset();
		revalidateSession.mockResolvedValue(undefined);
	});

	it('reports connected and re-checks the session when the server is reachable', async () => {
		probeCentral.mockResolvedValue(true);
		const { endpointStore } = await import('./endpoint.svelte');
		endpointStore.markDisconnected();
		await expect(endpointStore.forceRetry()).resolves.toBe(true);
		expect(endpointStore.status).toBe('connected');
		expect(revalidateSession).toHaveBeenCalledTimes(1);
	});

	it('stays disconnected and skips the session check when the server is unreachable', async () => {
		probeCentral.mockResolvedValue(false);
		const { endpointStore } = await import('./endpoint.svelte');
		await expect(endpointStore.forceRetry()).resolves.toBe(false);
		expect(endpointStore.status).toBe('disconnected');
		expect(revalidateSession).not.toHaveBeenCalled();
	});
});
