import type { QueryClient } from '@tanstack/svelte-query';
import { eventChannel } from './event-channel';

export interface SubscribeDataChangesHandle {
	stop(): void;
}

/**
 * Wire TanStack Query invalidation to the canonical app-level event channel.
 */
export function subscribeDataChanges(
	queryClient: QueryClient,
	dbName: string | (() => string),
	keysForType: (type: string) => readonly (readonly unknown[])[]
): SubscribeDataChangesHandle {
	const unsubscribe = eventChannel.subscribe((event) => {
		const db = typeof dbName === 'function' ? dbName() : dbName;
		if (event.db !== db) return;
		for (const queryKey of keysForType(event.docType)) {
			queryClient.invalidateQueries({ queryKey });
		}
	});
	return { stop: unsubscribe };
}

/** Emit after a successful mutation so the writer's UI updates immediately. */
export function emitDataChange(db: string, docType: string, docId: string): void {
	eventChannel.emit({ db, docType, docId });
}
