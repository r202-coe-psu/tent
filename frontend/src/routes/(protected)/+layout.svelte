<script lang="ts">
	import { page } from '$app/state';
	import ConnectionBanner from '$lib/components/ConnectionBanner.svelte';
	import StaffAccountMenu from '$lib/components/staff-account-menu.svelte';
	import { invalidateQueriesAfterReauth, startStaffCouchSync } from '$lib/db/staff-couch-sync';
	import { authStore } from '$lib/stores/auth.svelte';
	import { resolve } from '$app/paths';
	import { SessionExpiredBar } from '$lib/features/login';
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
</script>

<ConnectionBanner />

<div class="flex min-h-[var(--app-shell-height)] flex-col pb-[var(--testing-banner-height)]">
	{#if !page.url.pathname.startsWith('/back-office') && !page.url.pathname.startsWith('/system-management') && !page.url.pathname.startsWith('/onsite')}
		<header
			class="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between border-b bg-background px-6"
		>
			<div class="flex items-center gap-6">
				<a href={resolve('/portal')} class="font-semibold">Smart Shelter</a>
			</div>
			<div class="flex items-center gap-2">
				<StaffAccountMenu />
			</div>
		</header>
	{/if}

	<SessionExpiredBar />

	<main class="flex flex-1 flex-col">
		{@render children()}
	</main>
</div>
