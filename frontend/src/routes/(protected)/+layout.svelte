<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import ConnectionBanner from '$lib/components/ConnectionBanner.svelte';
	import StaffAccountMenu from '$lib/components/staff-account-menu.svelte';
	import { invalidateQueriesAfterReauth, startStaffCouchSync } from '$lib/db/staff-couch-sync';
	import { authStore } from '$lib/stores/auth.svelte';
	import { endpointStore } from '$lib/stores/endpoint.svelte';
	import { resolve } from '$app/paths';
	import { LANDING_ROUTE } from '$lib/guards/auth';
	import { discardReturnPath, isUserSwitch, takeReturnPath } from '$lib/auth/session-expiry';
	import { SessionExpiredModal } from '$lib/features/login';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();

	/** Set while session is expired so we refetch errored queries on reauth. */
	let pendingReauthRecovery = false;

	$effect(() => {
		if (authStore.needsReauth) {
			pendingReauthRecovery = true;
			return;
		}
		if (!authStore.isAuthenticated) return;

		if (pendingReauthRecovery) {
			pendingReauthRecovery = false;
			invalidateQueriesAfterReauth(data.queryClient);
		}

		const sync = startStaffCouchSync(data.queryClient);
		return () => sync.stop();
	});

	/**
	 * A different user taking over the session (cross-tab login, re-auth as someone else):
	 * drop the previous user's cached data and land on the portal, never on their page.
	 * `lastUserName` is a plain latch the effect reads and writes — nothing renders from it.
	 */
	let lastUserName = authStore.user?.name ?? null;
	$effect(() => {
		const next = authStore.user;
		const prev = lastUserName === null ? null : { name: lastUserName };
		lastUserName = next?.name ?? null;
		if (!isUserSwitch(prev, next)) return;
		untrack(() => {
			discardReturnPath();
			void data.queryClient.resetQueries();
			void goto(resolve(LANDING_ROUTE), { replaceState: true });
		});
	});

	/**
	 * MFA / force-setup / OAuth detours after re-auth always end at the portal. When the
	 * session-expired modal stashed the original page for this user, go back to it (once).
	 */
	$effect(() => {
		const user = authStore.user;
		if (!user || authStore.needsReauth) return;
		if (page.url.pathname !== LANDING_ROUTE) return;
		const path = takeReturnPath(user.name);
		// Same-origin path, validated by safeReturnPath.
		if (path) void goto(path, { replaceState: true });
	});

	/** Browser connectivity signals feed the offline banner; coming back online re-checks the session. */
	function handleOnline() {
		void endpointStore.forceRetry();
	}
	function handleOffline() {
		endpointStore.markDisconnected();
	}
</script>

<svelte:window ononline={handleOnline} onoffline={handleOffline} />

<ConnectionBanner />

<div class="flex min-h-[var(--app-shell-height)] flex-col pb-[var(--testing-banner-height)]">
	{#if !page.url.pathname.startsWith('/back-office') && !page.url.pathname.startsWith('/system-management') && !page.url.pathname.startsWith('/onsite')}
		<header
			class="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between border-b bg-background px-6"
		>
			<div class="flex items-center gap-6">
				<a href={resolve('/portal')} class="flex min-w-0 items-center gap-2.5">
					<img
						src="/logo.png"
						alt="PSU Smart Shelter"
						class="h-8 w-8 shrink-0 rounded-lg object-contain"
					/>
					<span class="truncate text-sm font-semibold tracking-tight sm:text-base"
						>PSU Smart Shelter</span
					>
				</a>
			</div>
			<div class="flex items-center gap-2">
				<StaffAccountMenu />
			</div>
		</header>
	{/if}

	<main class="flex flex-1 flex-col">
		{@render children()}
	</main>
</div>

<SessionExpiredModal />
