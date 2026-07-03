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
	import { SHELTER_REGISTRY_DB, startSheltersLiveQuery } from '$lib/features/shelters';
	import { startCatalogLiveQuery } from '$lib/features/catalog';
	import { startSopRatioLiveQuery } from '$lib/features/sop-ratios';

	let { children, data } = $props();

	// Shelter data sync + changes-feed reactivity follow the auth lifecycle:
	// start once authenticated, tear down on logout. One active remote, one feed
	// — both bound to the SAME shelter db (CONTRIBUTING.md §4). The registry
	// db carries the shelter master doc + audit log; it syncs alongside.
	$effect(() => {
		if (!authStore.isAuthenticated) return;
		startNamedSync(SHELTER_DB, () => authStore.markNeedsReauth());
		startNamedSync(SHELTER_REGISTRY_DB, () => authStore.markNeedsReauth());
		startNamedSync('catalog', () => authStore.markNeedsReauth());
		const peopleLive = startPeopleLiveQuery(data.queryClient);
		const sheltersLive = startSheltersLiveQuery(data.queryClient);
		const catalogLive = startCatalogLiveQuery(data.queryClient);
		return () => {
			peopleLive.stop();
			sheltersLive.stop();
			catalogLive.stop();
		const sopRatioLive = startSopRatioLiveQuery(data.queryClient);
		return () => {
			peopleLive.stop();
			sheltersLive.stop();
			sopRatioLive.stop();
			stopNamedSync(SHELTER_DB);
			stopNamedSync(SHELTER_REGISTRY_DB);
			stopNamedSync('catalog');
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
