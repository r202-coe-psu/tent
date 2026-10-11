import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyChangesPollStatus, startChangesSubscriber } from './changes-subscriber';

const handleAuthFailure = vi.fn();
const markConnected = vi.fn();
const markDisconnected = vi.fn();
const emit = vi.fn();

vi.mock('$app/environment', () => ({ browser: true }));

vi.mock('$lib/stores/auth.svelte', () => ({
	authStore: {
		handleAuthFailure: (...args: unknown[]) => handleAuthFailure(...args)
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
	eventChannel: { emit: (...args: unknown[]) => emit(...args) }
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
		handleAuthFailure.mockReset();
		handleAuthFailure.mockResolvedValue('expired');
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
		await vi.waitFor(() => expect(handleAuthFailure).toHaveBeenCalledTimes(1));
		expect(handleAuthFailure.mock.calls[0][0]).toMatchObject({ status: 401 });
		expect(markConnected).toHaveBeenCalled();

		const callsAfterAuth = fetchMock.mock.calls.length;
		await vi.advanceTimersByTimeAsync(30_000);
		expect(fetchMock).toHaveBeenCalledTimes(callsAfterAuth);

		handle.stop();
	});

	it('aborts sibling pollers when a 403 is confirmed as an expired session', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }));
		vi.stubGlobal('fetch', fetchMock);

		const handle = startChangesSubscriber(['db_a', 'db_b']);
		// First poller starts at t=0; second is staggered by POLL_STAGGER_MS (400).
		await vi.advanceTimersByTimeAsync(0);
		await vi.waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1));
		await vi.waitFor(() => expect(handleAuthFailure).toHaveBeenCalled());
		expect(handleAuthFailure.mock.calls[0][0]).toMatchObject({ status: 403 });

		const callsAfterHalt = fetchMock.mock.calls.length;
		await vi.advanceTimersByTimeAsync(5_000);
		expect(fetchMock.mock.calls.length).toBe(callsAfterHalt);

		handle.stop();
	});

	it('stops only the forbidden DB when a 403 is a permission denial with a valid session', async () => {
		handleAuthFailure.mockResolvedValue('permission-denied');
		// A real long-poll holds the request open; model that with a timer so the healthy
		// poller does not spin on microtasks under fake timers.
		const fetchMock = vi.fn(
			(url: string) =>
				new Promise<Response>((resolve) => {
					if (url.includes('/db_denied/')) {
						resolve(new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }));
						return;
					}
					setTimeout(
						() =>
							resolve(
								new Response(JSON.stringify({ results: [], last_seq: '1' }), { status: 200 })
							),
						200
					);
				})
		);
		vi.stubGlobal('fetch', fetchMock);

		const handle = startChangesSubscriber(['db_denied', 'db_ok']);
		await vi.advanceTimersByTimeAsync(1_000);

		const deniedCalls = () =>
			fetchMock.mock.calls.filter(([url]) => (url as string).includes('/db_denied/')).length;
		const okCalls = () =>
			fetchMock.mock.calls.filter(([url]) => (url as string).includes('/db_ok/')).length;
		expect(deniedCalls()).toBe(1);
		expect(okCalls()).toBeGreaterThan(1);

		handle.stop();
	});

	it('keeps polling after a backoff when the 403 cannot be verified (offline)', async () => {
		handleAuthFailure.mockResolvedValue('ignored');
		const fetchMock = vi
			.fn()
			.mockResolvedValue(new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }));
		vi.stubGlobal('fetch', fetchMock);

		const handle = startChangesSubscriber(['testdb']);
		await vi.advanceTimersByTimeAsync(0);
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		await vi.advanceTimersByTimeAsync(2_100);
		expect(fetchMock.mock.calls.length).toBeGreaterThan(1);

		handle.stop();
	});
});

describe('startChangesSubscriber deleted-doc handling', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		emit.mockReset();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('derives docType from the _id prefix when a delete tombstone has no `type` field', async () => {
		// CouchDB's deleted-doc tombstone is only { _id, _rev, _deleted } — no
		// other fields survive — so docType must fall back to the "{type}:{rest}"
		// _id convention instead of silently dropping the change.
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						results: [
							{
								seq: '5',
								id: 'meal_plan:2026-12-16:lunch',
								changes: [{ rev: '2-deleted' }],
								deleted: true,
								doc: { _id: 'meal_plan:2026-12-16:lunch', _rev: '2-deleted', _deleted: true }
							}
						],
						last_seq: '5'
					}),
					{ status: 200 }
				)
			)
			// Hang forever after the first poll so the subscriber's non-delaying
			// success loop doesn't spin the mock unbounded times.
			.mockImplementation(() => new Promise(() => {}));
		vi.stubGlobal('fetch', fetchMock);

		const handle = startChangesSubscriber(['testdb']);
		await vi.advanceTimersByTimeAsync(0);
		await vi.waitFor(() => expect(emit).toHaveBeenCalledTimes(1));

		expect(emit).toHaveBeenCalledWith({
			db: 'testdb',
			docType: 'meal_plan',
			docId: 'meal_plan:2026-12-16:lunch'
		});

		handle.stop();
	});
});
