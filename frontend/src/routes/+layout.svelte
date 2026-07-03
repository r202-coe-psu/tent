<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { QueryClientProvider } from '@tanstack/svelte-query';
	import { Toaster } from '$lib/components/ui/sonner/index.js';
	import { PUBLIC_APP_TITLE } from '$env/static/public';
	import { SvelteQueryDevtools } from '@tanstack/svelte-query-devtools';
	import { startNamedSync, stopNamedSync } from '$lib/db/pouch';
	import { authStore } from '$lib/stores/auth.svelte';
	import { startPeopleLiveQuery } from '$lib/features/people';
	import { getShelterDb } from '$lib/db/shelter';
	import { SHELTER_REGISTRY_DB, startSheltersLiveQuery } from '$lib/features/shelters';

	let { children, data } = $props();

	// Shelter data sync + changes-feed reactivity follow the auth lifecycle:
	// start once authenticated, tear down on logout. One active remote, one feed
	// — both bound to the SAME shelter db (CONTRIBUTING.md §4). The registry
	// db carries the shelter master doc + audit log; it syncs alongside.
	$effect(() => {
		if (!authStore.isAuthenticated) return;
		// Resolve the shelter db name from the user's roles at effect-run time,
		// so sh003 syncs shelter_sh003, sh001 syncs shelter_sh001, etc.
		const shelterDb = getShelterDb();
		startNamedSync(shelterDb, () => authStore.markNeedsReauth());
		startNamedSync(SHELTER_REGISTRY_DB, () => authStore.markNeedsReauth());
		const peopleLive = startPeopleLiveQuery(data.queryClient);
		const sheltersLive = startSheltersLiveQuery(data.queryClient);
		return () => {
			peopleLive.stop();
			sheltersLive.stop();
			stopNamedSync(shelterDb);
			stopNamedSync(SHELTER_REGISTRY_DB);
		};
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>
		{PUBLIC_APP_TITLE}
	</title>
</svelte:head>

<Toaster position="bottom-center" richColors />

<QueryClientProvider client={data.queryClient}>
	{@render children?.()}
	<SvelteQueryDevtools />
</QueryClientProvider>
