<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { QueryClientProvider } from '@tanstack/svelte-query';
	import { Toaster } from '$lib/components/ui/sonner/index.js';
	import { PUBLIC_APP_TITLE } from '$env/static/public';
	import { SvelteQueryDevtools } from '@tanstack/svelte-query-devtools';
	import ConnectionBanner from '$lib/components/ConnectionBanner.svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { endpointStore } from '$lib/stores/endpoint.svelte';
	import { startChangesSubscriber } from '$lib/db/changes-subscriber';
	import { getShelterDb } from '$lib/db/shelter';
	import { startPeopleLiveQuery } from '$lib/features/people';
	import { startOperationsLiveQuery } from '$lib/features/operations';
	import { startKitchenLiveQuery } from '$lib/features/kitchen';
	import { SHELTER_REGISTRY_DB, startSheltersLiveQuery } from '$lib/features/shelters';
	import { startCatalogMasterLiveQuery } from '$lib/features/catalog';
	import { startCatalogLiveQuery } from '$lib/features/supply';
	import { startSopRatioLiveQuery } from '$lib/features/sop-ratios';
	import { startDailyCalcLiveQuery } from '$lib/features/resource-calc';
	import { CATALOG_DB } from '$lib/features/supply';
	import { startReferralsLiveQuery } from '$lib/features/referrals';

	let { children, data } = $props();

	$effect(() => {
		if (!authStore.isAuthenticated) return;
		void endpointStore.probe();
	});

	$effect(() => {
		if (!authStore.isAuthenticated) return;

		const shelterDb = getShelterDb();

		// Defer live changes feed until initial page queries can claim connections.
		// Three simultaneous longpolls (25s timeout) were starving the /couch pool on refresh.
		let subscriber: ReturnType<typeof startChangesSubscriber> | null = null;
		const timer = setTimeout(() => {
			subscriber = startChangesSubscriber([SHELTER_REGISTRY_DB, CATALOG_DB, shelterDb]);
		}, 1_500);

		return () => {
			clearTimeout(timer);
			subscriber?.stop();
		};
	});

	$effect(() => {
		if (!authStore.isAuthenticated) return;

		const liveShelters = startSheltersLiveQuery(data.queryClient);
		const liveCatalog = startCatalogLiveQuery(data.queryClient);
		const liveCatalogMaster = startCatalogMasterLiveQuery(data.queryClient);

		return () => {
			liveShelters.stop();
			liveCatalog.stop();
			liveCatalogMaster.stop();
		};
	});

	$effect(() => {
		if (!authStore.isAuthenticated) return;
		getShelterDb();

		const livePeople = startPeopleLiveQuery(data.queryClient);
		const liveOperations = startOperationsLiveQuery(data.queryClient);
		const liveKitchen = startKitchenLiveQuery(data.queryClient);
		const sopRatioLive = startSopRatioLiveQuery(data.queryClient);
		const dailyCalcLive = startDailyCalcLiveQuery(data.queryClient);
		const liveReferrals = startReferralsLiveQuery(data.queryClient);

		return () => {
			livePeople.stop();
			liveOperations.stop();
			liveKitchen.stop();
			sopRatioLive.stop();
			dailyCalcLive.stop();
			liveReferrals.stop();
		};
	});

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

<Toaster position="top-center" richColors />

<QueryClientProvider client={data.queryClient}>
	<ConnectionBanner />
	{@render children?.()}
	<SvelteQueryDevtools />
</QueryClientProvider>
