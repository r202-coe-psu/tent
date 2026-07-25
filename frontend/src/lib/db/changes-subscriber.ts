import { browser } from '$app/environment';
import { COUCH_URL } from './couch';
import { eventChannel, type DataChangeEvent } from './event-channel';
import { CouchAuthError } from '$lib/utils/errors';
import { endpointStore } from '$lib/stores/endpoint.svelte';
import { authStore } from '$lib/stores/auth.svelte';

interface ChangesResponse {
	results: Array<{
		seq: string;
		id: string;
		changes: Array<{ rev: string }>;
		doc?: { type?: string };
	}>;
	last_seq: string;
}

export interface ChangesSubscriberHandle {
	stop(): void;
}

/** CouchDB longpoll timeout — keep low so idle polls release browser connections quickly. */
const LONGPOLL_TIMEOUT_MS = 5_000;

/** Stagger DB pollers so they do not occupy the per-origin connection pool all at once. */
const POLL_STAGGER_MS = 400;

/** CouchDB is up but the database has not been provisioned yet (fresh install). */
const MISSING_DB_BACKOFF_MS = 15_000;

/** Transient network or 5xx errors — retry quickly. */
const ERROR_BACKOFF_MS = 2_000;

function isMissingDatabase(status: number): boolean {
	return status === 404;
}

/** Classify `_changes` poll HTTP status for endpoint/backoff policy. */
export function classifyChangesPollStatus(
	status: number
): 'ok' | 'missing_db' | 'auth_error' | 'error' {
	if (status === 401 || status === 403) return 'auth_error';
	if (isMissingDatabase(status)) return 'missing_db';
	if (status >= 200 && status < 300) return 'ok';
	return 'error';
}

/**
 * Long-poll CouchDB `_changes` on the active central endpoint and emit to the
 * app-level event channel. Not TanStack refetchInterval — canonical live-update
 * mechanism (CR-033 decision B).
 *
 * On 401/403 the entire subscriber hard-stops (abort all pollers) and sets
 * `needsReauth`. The root layout restarts the feed only after a successful login.
 */
export function startChangesSubscriber(dbNames: string[]): ChangesSubscriberHandle {
	if (!browser) return { stop: () => {} };

	const abort = new AbortController();
	const sinceByDb = new Map<string, string>();
	const staggerTimers: ReturnType<typeof setTimeout>[] = [];

	const haltOnAuthError = () => {
		authStore.markNeedsReauth();
		abort.abort();
	};

	for (const [index, dbName] of dbNames.entries()) {
		sinceByDb.set(dbName, 'now');
		const timer = setTimeout(() => {
			if (!abort.signal.aborted) void pollDb(dbName, sinceByDb, abort.signal, haltOnAuthError);
		}, index * POLL_STAGGER_MS);
		staggerTimers.push(timer);
	}

	return {
		stop: () => {
			for (const timer of staggerTimers) clearTimeout(timer);
			abort.abort();
		}
	};
}

async function pollDb(
	dbName: string,
	sinceByDb: Map<string, string>,
	signal: AbortSignal,
	haltOnAuthError: () => void
): Promise<void> {
	while (!signal.aborted) {
		try {
			const since = sinceByDb.get(dbName) ?? 'now';
			const url = `${COUCH_URL}/${dbName}/_changes?feed=longpoll&since=${encodeURIComponent(since)}&include_docs=true&timeout=${LONGPOLL_TIMEOUT_MS}`;
			const res = await fetch(url, { credentials: 'include', signal });

			if (signal.aborted) return;

			const outcome = classifyChangesPollStatus(res.status);
			if (outcome === 'auth_error') {
				throw new CouchAuthError(res.status as 401 | 403);
			}
			if (outcome === 'missing_db') {
				// Fresh installs may only have `_users` until an admin provisions databases.
				endpointStore.markConnected();
				await sleep(MISSING_DB_BACKOFF_MS, signal);
				continue;
			}
			if (outcome === 'error') {
				endpointStore.markDisconnected();
				await sleep(ERROR_BACKOFF_MS, signal);
				continue;
			}

			endpointStore.markConnected();
			const data = (await res.json()) as ChangesResponse;
			sinceByDb.set(dbName, data.last_seq);

			for (const change of data.results) {
				// A deleted doc's tombstone carries only _id/_rev/_deleted — no `type`
				// field survives — so a hard delete would otherwise never invalidate
				// its query and the row would linger in the UI until a full reload.
				// Every doc's _id follows the "{type}:{rest}" convention (the same one
				// allDocsByType range-queries on), so fall back to that prefix.
				const docType = change.doc?.type ?? change.id.split(':')[0];
				if (!docType) continue;
				const event: DataChangeEvent = { db: dbName, docType, docId: change.id };
				eventChannel.emit(event);
			}
		} catch (err) {
			if (signal.aborted) return;
			if (err instanceof CouchAuthError) {
				haltOnAuthError();
				return;
			}
			endpointStore.markDisconnected();
			await sleep(ERROR_BACKOFF_MS, signal);
		}
	}
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
	if (signal.aborted) return Promise.resolve();
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, ms);
		signal.addEventListener(
			'abort',
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true }
		);
	});
}
