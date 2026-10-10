import { MutationCache, QueryCache, QueryClient } from '@tanstack/svelte-query';
import { classifyAuthFailure, shouldRetryQuery } from '$lib/auth/session-expiry';

/** What the app decided about an auth-shaped failure (mirrors `authStore.handleAuthFailure`). */
export type AuthFailureResolution = 'expired' | 'permission-denied' | 'ignored';

export interface AppQueryClientOptions {
	/** Resolve a 401/403 (confirms 403 / BFF 401 against `/_session`); opens the login modal when expired. */
	onAuthFailure: (err: unknown) => Promise<AuthFailureResolution>;
	/** A user-triggered mutation failed because the session expired — it was NOT retried. */
	onMutationExpired: () => void;
	/** A user-triggered mutation was refused for a signed-in user. */
	onMutationPermissionDenied?: () => void;
}

function isAuthShaped(err: unknown): boolean {
	const kind = classifyAuthFailure(err);
	return kind === 'session-expired' || kind === 'unverified-auth';
}

/**
 * App-wide TanStack client. Auth failures from ANY query or mutation reach
 * `onAuthFailure` here, so BFF `/api/*` 401s (which carry no Couch session signal) are
 * detected too. Mutations are never retried — a write must not silently replay after
 * re-login; the user is told to redo it.
 */
export function createAppQueryClient(options: AppQueryClientOptions): QueryClient {
	return new QueryClient({
		queryCache: new QueryCache({
			onError: (error) => {
				if (!isAuthShaped(error)) return;
				void options.onAuthFailure(error);
			}
		}),
		mutationCache: new MutationCache({
			onError: (error) => {
				if (!isAuthShaped(error)) return;
				void options.onAuthFailure(error).then((outcome) => {
					if (outcome === 'expired') options.onMutationExpired();
					else if (outcome === 'permission-denied') options.onMutationPermissionDenied?.();
				});
			}
		}),
		defaultOptions: {
			queries: {
				staleTime: 60 * 1000,
				retry: shouldRetryQuery
			},
			mutations: { retry: 0 }
		}
	});
}
