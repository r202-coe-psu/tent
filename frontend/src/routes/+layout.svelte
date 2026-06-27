<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { QueryClientProvider } from '@tanstack/svelte-query';
	import { Toaster } from '$lib/components/ui/sonner/index.js';
	import { PUBLIC_APP_TITLE } from '$env/static/public';
	import { SvelteQueryDevtools } from '@tanstack/svelte-query-devtools';
	import { startNamedSync, stopNamedSync } from '$lib/db/pouch';
	import { authStore } from '$lib/stores/auth.svelte';
	import { SHELTER_DB, startPeopleLiveQuery } from '$lib/features/people';
	import { startOperationsLiveQuery } from '$lib/features/operations';
	import { startKitchenLiveQuery } from '$lib/features/kitchen';
	import { SHELTER_REGISTRY_DB, startSheltersLiveQuery } from '$lib/features/shelters';

	let { children, data } = $props();

	// Shelter data sync + changes-feed reactivity follow the auth lifecycle:
	// start once authenticated, tear down on logout. One active remote, one feed
	// — both bound to the SAME shelter db (CONTRIBUTING.md §4). The registry
	// db carries the shelter master doc + audit log; it syncs alongside.
	$effect(() => {
		if (!authStore.isAuthenticated) return;
		
		// Synchronize databases
		startNamedSync(SHELTER_DB, () => authStore.markNeedsReauth());
		startNamedSync('catalog', () => authStore.markNeedsReauth());
		startNamedSync(SHELTER_REGISTRY_DB, () => authStore.markNeedsReauth());
		
		// Start changes feed live-queries
		const livePeople = startPeopleLiveQuery(data.queryClient);
		const liveOperations = startOperationsLiveQuery(data.queryClient);
		const liveKitchen = startKitchenLiveQuery(data.queryClient);
		const liveShelters = startSheltersLiveQuery(data.queryClient);
		
		return () => {
			livePeople.stop();
			liveOperations.stop();
			liveKitchen.stop();
			liveShelters.stop();
			stopNamedSync(SHELTER_DB);
			stopNamedSync('catalog');
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
