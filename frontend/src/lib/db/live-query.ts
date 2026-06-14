import type { QueryClient } from '@tanstack/svelte-query';

/**
 * Reusable primitive #2 — turn a PouchDB changes feed into TanStack Query
 * invalidations. Reactivity comes from replication, NOT polling: never reach
 * for `refetchInterval` on live data (CONTRIBUTING.md §4). A local write, a
 * remote sync, and another tab all flow through the same feed.
 *
 * `keysForType` maps a changed doc's `type` to the query keys to invalidate;
 * return `[]` to ignore a type.
 */
export interface LiveQueryHandle {
	stop(): void;
}

export function startLiveQuery(
	db: PouchDB.Database,
	queryClient: QueryClient,
	keysForType: (type: string) => readonly (readonly unknown[])[]
): LiveQueryHandle {
	const feed = db.changes({ live: true, since: 'now', include_docs: true });

	feed.on('change', (change) => {
		const type = (change.doc as { type?: string } | undefined)?.type;
		if (!type) return;
		for (const queryKey of keysForType(type)) {
			queryClient.invalidateQueries({ queryKey });
		}
	});

	// Deliberate console.warn — the sanctioned exception for PouchDB plumbing.
	feed.on('error', (err) => console.warn('[PouchDB] changes feed error', err));

	return { stop: () => feed.cancel() };
}
