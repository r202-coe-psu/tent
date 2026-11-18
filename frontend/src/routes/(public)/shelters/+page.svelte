<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { SvelteURLSearchParams } from 'svelte/reactivity';

	// Icons
	import Building2 from '@lucide/svelte/icons/building-2';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import Filter from '@lucide/svelte/icons/filter';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Map from '@lucide/svelte/icons/map';
	import List from '@lucide/svelte/icons/list';
	import House from '@lucide/svelte/icons/house';
	import Tent from '@lucide/svelte/icons/tent';

	import {
		PublicShelterMetricCard,
		ShelterFilterPanel,
		ShelterListPanel,
		ShelterMap,
		ShelterMobileFilterSheet,
		ShelterMobileList,
		ShelterMobileSelectedCard,
		PublicPageShell,
		requestUserPosition,
		canRequestGeolocation,
		isHostHouseKind,
		siteKindLabel,
		siteKindTiles,
		useSiteKinds,
		toParkingMapPoints,
		rankByUserOrigin,
		type PublicShelterCardModel
	} from '$lib/features/public-portal';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_SHELTERS_I18N } from '$lib/constants/i18n';
	import { langState } from '$lib/states/i18n.svelte';

	let { data }: { data: PageData } = $props();

	let liveUserLat = $state('');
	let liveUserLng = $state('');
	let selectedShelterId = $state<string | null>(null);
	let listContainerEl: HTMLElement | null = $state(null);

	// Floating UI panels state (desktop)
	let showFilterPanel = $state(true);
	let showListPanel = $state(true);

	// Mobile UI states
	let isMobile = $state(false);
	let mobileViewMode = $state<'map' | 'list'>('map');
	let mobileFilterOpen = $state(false);

	const t = $derived(getTranslation(PUBLIC_SHELTERS_I18N, langState.current));
	const siteKindsQuery = useSiteKinds();
	const siteKindStatTiles = $derived(
		siteKindTiles(data?.summary?.counts_by_site_kind ?? {}, siteKindsQuery.data)
	);

	onMount(() => {
		if (typeof window !== 'undefined') {
			const mql = window.matchMedia('(max-width: 1023px)');
			isMobile = mql.matches;
			const handler = (e: MediaQueryListEvent) => {
				isMobile = e.matches;
			};
			mql.addEventListener('change', handler);

			if (!liveUserLat || !liveUserLng) {
				if (canRequestGeolocation()) {
					requestUserPosition()
						.then((pos) => {
							liveUserLat = pos.lat;
							liveUserLng = pos.lng;
						})
						.catch(() => {
							// Geolocation unavailable or user denied
						});
				}
			}

			return () => mql.removeEventListener('change', handler);
		}
	});

	// A search origin picked after load (GPS, map pin) re-measures and re-orders the list.
	let displayShelters = $derived(
		rankByUserOrigin((data?.shelters ?? []) as PublicShelterCardModel[], liveUserLat, liveUserLng)
	);

	// Pins follow the result list: a shelter filtered out takes its parking pins with it (CR-253 FR-30).
	const parkingPins = $derived(toParkingMapPoints(displayShelters));

	let mapRadiusKm = $derived.by(() => {
		const d = parseFloat(data?.filters?.distance ?? '');
		return Number.isFinite(d) && d > 0 ? d : undefined;
	});

	let selectedShelter = $derived(
		displayShelters.find(
			(s) => s.id === selectedShelterId || (s.code && s.code === selectedShelterId)
		) || null
	);

	$effect(() => {
		if (data?.filters?.user_lat) liveUserLat = data.filters.user_lat.toString();
		if (data?.filters?.user_lng) liveUserLng = data.filters.user_lng.toString();
	});

	// Keep selection in sync: clear selection if the selected shelter is no longer in display list
	$effect(() => {
		if (
			selectedShelterId &&
			!displayShelters.some((s) => s.id === selectedShelterId || s.code === selectedShelterId)
		) {
			selectedShelterId = null;
		}
	});

	function handleSelectShelter(shelterId: string) {
		selectedShelterId = shelterId || null;

		if (typeof window !== 'undefined' && listContainerEl) {
			const targetEl =
				document.getElementById(`shelter-card-${shelterId}`) ||
				(document.querySelector(`[data-shelter-id="${shelterId}"]`) as HTMLElement | null) ||
				(document.querySelector(`[data-shelter-code="${shelterId}"]`) as HTMLElement | null);

			if (targetEl) {
				const containerRect = listContainerEl.getBoundingClientRect();
				const targetRect = targetEl.getBoundingClientRect();
				const relativeTop = targetRect.top - containerRect.top;
				const currentScroll = listContainerEl.scrollTop;

				listContainerEl.scrollTo({
					top: currentScroll + relativeTop - 12,
					behavior: 'smooth'
				});
			}
		}
	}

	function openBooking(shelterCode: string) {
		const target = shelterCode
			? `${resolve('/pre-register')}?shelter=${encodeURIComponent(shelterCode)}`
			: resolve('/pre-register');
		void goto(target);
	}

	/** Map pin / GPS origin → sync filter panel + reload list with radius. */
	function applySearchOrigin(lat: number, lng: number) {
		liveUserLat = lat.toFixed(6);
		liveUserLng = lng.toFixed(6);
		const params = new SvelteURLSearchParams(page.url.searchParams);
		params.set('user_lat', liveUserLat);
		params.set('user_lng', liveUserLng);
		if (!params.get('distance')) {
			params.set('distance', data?.filters?.distance || '5');
		}
		void goto(resolve(`/shelters?${params.toString()}`), { keepFocus: true, noScroll: true });
	}
</script>

<svelte:head>
	<title>{t.pageTitle}</title>
</svelte:head>

<PublicPageShell class="space-y-3 sm:space-y-4" maxWidth="max-w-[1600px]">
	<!-- Mobile Top Control Bar (< lg) -->
	<div class="flex items-center justify-between gap-2 lg:hidden">
		<!-- View Switcher Tabs -->
		<div class="inline-flex rounded-xl border border-border/80 bg-muted/60 p-1 shadow-2xs">
			<button
				type="button"
				class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all {mobileViewMode ===
				'map'
					? 'bg-card text-primary shadow-xs'
					: 'text-muted-foreground hover:text-foreground'}"
				onclick={() => (mobileViewMode = 'map')}
			>
				<Map class="h-3.5 w-3.5" />
				<span>{t.mapView}</span>
			</button>
			<button
				type="button"
				class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all {mobileViewMode ===
				'list'
					? 'bg-card text-primary shadow-xs'
					: 'text-muted-foreground hover:text-foreground'}"
				onclick={() => (mobileViewMode = 'list')}
			>
				<List class="h-3.5 w-3.5" />
				<span>{t.listView} ({displayShelters.length})</span>
			</button>
		</div>

		<!-- Mobile Filter Trigger Button -->
		<button
			type="button"
			class="flex items-center gap-1.5 rounded-xl border border-border/80 bg-card px-3.5 py-2 text-xs font-bold text-foreground shadow-2xs transition-all active:scale-95"
			onclick={() => (mobileFilterOpen = true)}
		>
			<Filter class="h-3.5 w-3.5 text-primary" />
			<span>{t.filterBtn}</span>
		</button>
	</div>

	<!-- Metric Cards (Desktop always; Mobile only when viewing list) -->
	<div
		class="{mobileViewMode === 'map'
			? 'hidden lg:grid'
			: 'grid'} grid-cols-2 gap-3 sm:gap-4 md:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] lg:gap-6"
	>
		<PublicShelterMetricCard
			title={t.totalShelters}
			value={data?.summary?.shelters_total ?? 0}
			unit={t.locationsUnit}
			icon={ClipboardList}
			iconClass="border-accent-purple shadow-accent-purple/15 text-accent-purple"
		/>

		<PublicShelterMetricCard
			title={t.openShelters}
			value={data?.summary?.shelters_open ?? 0}
			unit={t.locationsUnit}
			icon={Building2}
			iconClass="border-success shadow-success/15 text-success"
		/>

		<!-- Wait for the kind list so the tiles appear together instead of popping in one by one. -->
		{#if siteKindsQuery.isPending}
			<Skeleton class="h-24 rounded-2xl sm:h-28" />
			<Skeleton class="h-24 rounded-2xl sm:h-28" />
		{:else}
			{#each siteKindStatTiles as tile (tile.code)}
				<PublicShelterMetricCard
					title={siteKindLabel(tile.code, siteKindsQuery.data, langState.current)}
					value={tile.count}
					unit={t.locationsUnit}
					icon={isHostHouseKind(tile.code) ? House : Tent}
					iconClass={isHostHouseKind(tile.code)
						? 'border-sky-300 shadow-sky-300/15 text-sky-700'
						: 'border-primary shadow-primary/15 text-primary'}
				/>
			{/each}
		{/if}
	</div>

	<!-- Map Container (Always visible on Desktop; on Mobile visible when mobileViewMode === 'map') -->
	<div
		class="relative {mobileViewMode === 'list'
			? 'hidden lg:block'
			: 'block'} h-[calc(100dvh-10.5rem)] min-h-[460px] w-full overflow-hidden rounded-2xl border border-border/80 bg-muted shadow-xs sm:h-[calc(100vh-14rem)] sm:min-h-[720px]"
	>
		<!-- Full Map Canvas (Background) -->
		<div class="absolute inset-0 z-0 h-full w-full">
			<ShelterMap
				shelters={displayShelters}
				parkingPoints={parkingPins}
				userLocation={liveUserLat && liveUserLng
					? { lat: liveUserLat, lng: liveUserLng }
					: undefined}
				radiusKm={mapRadiusKm}
				selectedId={selectedShelterId}
				disablePopup={isMobile}
				onSelectShelter={handleSelectShelter}
				onLocationPick={applySearchOrigin}
			/>
		</div>

		<!-- Desktop Floating Filter Panel (Left) -->
		{#if showFilterPanel}
			<div class="absolute top-4 left-4 z-20 hidden max-h-[calc(100%-2rem)] w-80 lg:block xl:w-88">
				<ShelterFilterPanel
					filters={data?.filters || {}}
					availableTypes={data?.available_types || []}
					action="/shelters"
					bind:userLat={liveUserLat}
					bind:userLng={liveUserLng}
					class="h-full max-h-[calc(100vh-17rem)]"
					onClose={() => (showFilterPanel = false)}
				/>
			</div>
		{:else}
			<button
				type="button"
				class="absolute top-4 left-4 z-20 hidden items-center gap-2 rounded-xl border border-border/80 bg-card/95 px-3.5 py-2.5 text-xs font-bold text-foreground shadow-md backdrop-blur-md transition-all hover:bg-card lg:flex"
				onclick={() => (showFilterPanel = true)}
			>
				<Filter class="h-4 w-4 text-primary" />
				<span>{t.searchAndFilter}</span>
				<ChevronRight class="h-3.5 w-3.5 text-muted-foreground" />
			</button>
		{/if}

		<!-- Desktop Floating Shelter List Panel (Right) -->
		<ShelterListPanel
			shelters={displayShelters}
			selectedId={selectedShelterId}
			bind:open={showListPanel}
			bind:listEl={listContainerEl}
			onSelect={handleSelectShelter}
			onPreRegister={openBooking}
		/>

		<!-- Mobile Bottom Compact Selected Card (Map Mode Only, < lg) -->
		{#if selectedShelter && isMobile && mobileViewMode === 'map'}
			<ShelterMobileSelectedCard
				shelter={selectedShelter}
				onClose={() => (selectedShelterId = null)}
				onPreRegister={openBooking}
			/>
		{/if}
	</div>

	<!-- Mobile Shelter List View (when mobileViewMode === 'list', < lg) -->
	{#if mobileViewMode === 'list'}
		<ShelterMobileList
			shelters={displayShelters}
			selectedId={selectedShelterId}
			sortedByDistance={Boolean(liveUserLat && liveUserLng)}
			onSelect={(shelterId) => {
				handleSelectShelter(shelterId);
				mobileViewMode = 'map';
			}}
			onPreRegister={openBooking}
			onViewMap={() => (mobileViewMode = 'map')}
		/>
	{/if}

	<!-- Mobile Full-Screen / Sheet Filter Modal (< lg) -->
	<ShelterMobileFilterSheet
		bind:open={mobileFilterOpen}
		filters={data?.filters || {}}
		availableTypes={data?.available_types || []}
		bind:userLat={liveUserLat}
		bind:userLng={liveUserLng}
	/>
</PublicPageShell>
