import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyChangesPollStatus, startChangesSubscriber } from './changes-subscriber';

const markNeedsReauth = vi.fn();
const markConnected = vi.fn();
const markDisconnected = vi.fn();

vi.mock('$app/environment', () => ({ browser: true }));

vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: {
		markNeedsReauth: (...args: unknown[]) => markNeedsReauth(...args)
	}
}));

vi.mock('$lib/stores/endpoint.svelte', () => ({
	endpointStore: {
		markConnected: (...args: unknown[]) => markConnected(...args),
		markDisconnected: (...args: unknown[]) => markDisconnected(...args)
	}
}));

vi.mock('./couch', () => ({
	COUCH_URL: '/couch'
}));

vi.mock('./event-channel', () => ({
	eventChannel: { emit: vi.fn() }
}));

describe('classifyChangesPollStatus', () => {
	it('treats 404 as a missing database (fresh install)', () => {
		expect(classifyChangesPollStatus(404)).toBe('missing_db');
	});

	it('treats 2xx as ok', () => {
		expect(classifyChangesPollStatus(200)).toBe('ok');
	});

	it('treats 5xx as a server error', () => {
		expect(classifyChangesPollStatus(500)).toBe('error');
	});

	it('treats auth failures separately', () => {
		expect(classifyChangesPollStatus(401)).toBe('auth_error');
		expect(classifyChangesPollStatus(403)).toBe('auth_error');
	});
});

describe('startChangesSubscriber auth hard-stop', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		markNeedsReauth.mockReset();
		markConnected.mockReset();
		markDisconnected.mockReset();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('stops polling after 401 and does not fetch _changes again', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }));
		vi.stubGlobal('fetch', fetchMock);

		const handle = startChangesSubscriber(['testdb']);
		await vi.advanceTimersByTimeAsync(0);

		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		expect(markNeedsReauth).toHaveBeenCalledTimes(1);

		const callsAfterAuth = fetchMock.mock.calls.length;
		await vi.advanceTimersByTimeAsync(30_000);
		expect(fetchMock).toHaveBeenCalledTimes(callsAfterAuth);

		handle.stop();
	});

	it('aborts sibling pollers when one DB hits 403', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }));
		vi.stubGlobal('fetch', fetchMock);

		const handle = startChangesSubscriber(['db_a', 'db_b']);
		// First poller starts at t=0; second is staggered by POLL_STAGGER_MS (400).
		await vi.advanceTimersByTimeAsync(0);
		await vi.waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1));
		expect(markNeedsReauth).toHaveBeenCalled();

		const callsAfterHalt = fetchMock.mock.calls.length;
		await vi.advanceTimersByTimeAsync(5_000);
		expect(fetchMock.mock.calls.length).toBe(callsAfterHalt);

		handle.stop();
	});
});
