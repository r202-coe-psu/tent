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
	import { startOperationsLiveQuery } from '$lib/features/operations';
	import { startKitchenLiveQuery } from '$lib/features/kitchen';
	import { SHELTER_REGISTRY_DB, startSheltersLiveQuery } from '$lib/features/shelters';
	import { startCatalogLiveQuery } from '$lib/features/supply';
	import { startSopRatioLiveQuery } from '$lib/features/sop-ratios';

	import { page } from '$app/stores';

	let { children, data } = $props();

	// Shared DBs (registry + catalog) follow auth only — avoid restarting sync when
	// the active shelter changes.
	$effect(() => {
		if (!authStore.isAuthenticated || $page.url.pathname.startsWith('/public')) return;
		// Resolve the shelter db name from the user's roles at effect-run time,
		// so sh003 syncs shelter_sh003, sh001 syncs shelter_sh001, etc.
		const shelterDb = getShelterDb();
		startNamedSync(shelterDb, () => authStore.markNeedsReauth());
		startNamedSync(SHELTER_REGISTRY_DB, () => authStore.markNeedsReauth());
		startNamedSync('catalog', () => authStore.markNeedsReauth());
		return () => {
			stopNamedSync('catalog');
			stopNamedSync(SHELTER_REGISTRY_DB);
		};
	});

	// Shelter db sync follows auth + active shelter scope (CONTRIBUTING.md §4).
	$effect(() => {
		if (!authStore.isAuthenticated) return;
		const shelterDb = getShelterDb();
		startNamedSync(shelterDb, () => authStore.markNeedsReauth());
		return () => stopNamedSync(shelterDb);
	});

	// Registry/catalog live queries follow auth only — not the active shelter.
	$effect(() => {
		if (!authStore.isAuthenticated) return;

		const liveShelters = startSheltersLiveQuery(data.queryClient);
		const liveCatalog = startCatalogLiveQuery(data.queryClient);

		return () => {
			liveShelters.stop();
			liveCatalog.stop();
		};
	});

	// Shelter-scoped live queries restart when the active shelter changes.
	$effect(() => {
		if (!authStore.isAuthenticated) return;
		getShelterDb();

		const livePeople = startPeopleLiveQuery(data.queryClient);
		const liveOperations = startOperationsLiveQuery(data.queryClient);
		const liveKitchen = startKitchenLiveQuery(data.queryClient);
		const sopRatioLive = startSopRatioLiveQuery(data.queryClient);

		return () => {
			livePeople.stop();
			liveOperations.stop();
			liveKitchen.stop();
			sopRatioLive.stop();
		};
	});

	// Drop cached queries on logout only — never on shelter switch (that was
	// cancelling in-flight shelter-list fetches after listDefaultCode resolved).
	$effect(() => {
		if (authStore.isAuthenticated) return;
		data.queryClient.clear();
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
