<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import { afterNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { navigating, page } from '$app/state';
	import { SvelteURLSearchParams } from 'svelte/reactivity';

	// Icons
	import Building2 from '@lucide/svelte/icons/building-2';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import Filter from '@lucide/svelte/icons/filter';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import X from '@lucide/svelte/icons/x';
	import Map from '@lucide/svelte/icons/map';
	import List from '@lucide/svelte/icons/list';
	import Navigation from '@lucide/svelte/icons/navigation';
	import Eye from '@lucide/svelte/icons/eye';
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import Users from '@lucide/svelte/icons/users';
	import House from '@lucide/svelte/icons/house';
	import Tent from '@lucide/svelte/icons/tent';

	import {
		PublicShelterMetricCard,
		PublicShelterCard,
		ExternalShelterChip,
		ShelterFilterPanel,
		ShelterMap,
		requestUserPosition,
		canRequestGeolocation,
		isHostHouseKind,
		siteKindLabel,
		siteKindTiles,
		useSiteKinds,
		toParkingMapPoints,
		ActiveFilterChips,
		MapFilterOverlay,
		ShelterListEmpty,
		activeFilterChips,
		activeFilterCount,
		emptyListReason,
		nextRadiusKm,
		paramsWithoutAllFilters,
		paramsWithoutFilter,
		paramsWithoutPosition,
		paramsWithRadius,
		shelterTypeLabel,
		showMapFilterOverlay,
		type ActiveFilterChip,
		type ActiveFilterLabels,
		type PublicShelterCardModel
	} from '$lib/features/public-portal';
	import { Button } from '$lib/components/ui/button';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { getTranslation } from '$lib/utils/i18n';
	import { directionsUrl } from '$lib/utils/maps';
	import {
		PUBLIC_FILTER_PANEL_I18N,
		PUBLIC_SHELTERS_I18N,
		PUBLIC_SHELTER_CARD_I18N
	} from '$lib/constants/i18n';
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
	// xl and up: the strip between the two floating panels is wide enough for the whole legend.
	let isXl = $state(false);
	let mobileViewMode = $state<'map' | 'list'>('map');
	let mobileFilterOpen = $state(false);

	const t = $derived(getTranslation(PUBLIC_SHELTERS_I18N, langState.current));
	const cardT = $derived(getTranslation(PUBLIC_SHELTER_CARD_I18N, langState.current));
	const siteKindsQuery = useSiteKinds();
	const siteKindStatTiles = $derived(
		data?.summary ? siteKindTiles(data.summary.counts_by_site_kind, siteKindsQuery.data) : []
	);

	onMount(() => {
		if (typeof window !== 'undefined') {
			const mql = window.matchMedia('(max-width: 1023px)');
			isMobile = mql.matches;
			const handler = (e: MediaQueryListEvent) => {
				isMobile = e.matches;
			};
			mql.addEventListener('change', handler);
			const xl = window.matchMedia('(min-width: 1280px)');
			isXl = xl.matches;
			const xlHandler = (e: MediaQueryListEvent) => {
				isXl = e.matches;
			};
			xl.addEventListener('change', xlHandler);

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

			return () => {
				mql.removeEventListener('change', handler);
				xl.removeEventListener('change', xlHandler);
			};
		}
	});

	function calcDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
		const R = 6371; // km
		const dLat = ((lat2 - lat1) * Math.PI) / 180;
		const dLon = ((lon2 - lon1) * Math.PI) / 180;
		const a =
			Math.sin(dLat / 2) * Math.sin(dLat / 2) +
			Math.cos((lat1 * Math.PI) / 180) *
				Math.cos((lat2 * Math.PI) / 180) *
				Math.sin(dLon / 2) *
				Math.sin(dLon / 2);
		const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
		return R * c;
	}

	let displayShelters = $derived.by(() => {
		const mapped = ((data?.shelters ?? []) as PublicShelterCardModel[]).map((s) => {
			if (liveUserLat && liveUserLng && s?.geo?.lat != null && s?.geo?.lng != null) {
				const uLat = parseFloat(liveUserLat);
				const uLng = parseFloat(liveUserLng);
				if (!isNaN(uLat) && !isNaN(uLng)) {
					const dist = calcDistance(uLat, uLng, s.geo.lat, s.geo.lng);
					return { ...s, distance: parseFloat(dist.toFixed(1)) };
				}
			}
			return s;
		});

		if (!(liveUserLat && liveUserLng)) return mapped;

		return [...mapped].sort((a, b) => {
			const da = a.geo ? (a.distance ?? Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY;
			const db = b.geo ? (b.distance ?? Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY;
			return da - db;
		});
	});

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
		// A cleared radius (`distance=`) stays cleared; a URL without one gets the default.
		if (!params.has('distance')) {
			params.set('distance', data?.filters?.distance || '5');
		}
		void goto(resolve(`/shelters?${params.toString()}`), { keepFocus: true, noScroll: true });
	}

	// ── Active filters (#1419): chips above the list, a count on the filter buttons ──
	const filterT = $derived(getTranslation(PUBLIC_FILTER_PANEL_I18N, langState.current));
	const statusLabels = $derived<Record<string, string>>({
		open: filterT.statusOpen,
		full: filterT.statusFull,
		prepare: filterT.statusPrepare,
		standby: filterT.statusPrepare,
		closed: filterT.statusClosed,
		unknown: filterT.statusUnknown
	});
	const chipLabels = $derived<ActiveFilterLabels>({
		radius: (km) => t.chipRadius.replace('{km}', km),
		search: (q) => t.chipSearch.replace('{q}', q),
		status: (value) => t.chipStatus.replace('{label}', statusLabels[value] ?? value),
		type: (label) =>
			t.chipType.replace('{label}', shelterTypeLabel(label, undefined, langState.current)),
		province: (name) => t.chipProvince.replace('{name}', name),
		district: (name) => t.chipDistrict.replace('{name}', name),
		subdistrict: (name) => t.chipSubdistrict.replace('{name}', name),
		hideFull: t.chipHideFull,
		parking: {
			car: t.chipParkingCar,
			motorcycle: t.chipParkingMotorcycle,
			boat: t.chipParkingBoat
		},
		hiddenGroup: { evacuation: t.chipHideEvacuation, external: t.chipHideExternal }
	});
	const filterChips = $derived(activeFilterChips(data?.filters ?? {}, chipLabels));
	const filterCount = $derived(activeFilterCount(filterChips));
	const emptyReason = $derived(emptyListReason(filterChips));
	const radiusKm = $derived(String(data?.filters?.distance ?? ''));
	const filterCountText = $derived(t.activeFilterCount.replace('{n}', String(filterCount)));
	// Desktop, list panel collapsed: the chips / empty state go on the map instead.
	const showMapOverlay = $derived(
		!isMobile &&
			showMapFilterOverlay({
				listPanelOpen: showListPanel,
				chipCount: filterChips.length,
				resultCount: displayShelters.length
			})
	);

	// lg–xl with both panels open leaves little room for the legend (~220px at 1024, ~420px at 1280;
	// #1461): collapse it to a toggle.
	const legendCompact = $derived(!isMobile && !isXl && showFilterPanel && showListPanel);

	/** A filter's load is in flight: the list dims until the new result lands. */
	const listBusy = $derived(navigating.to?.url.pathname === page.url.pathname);
	let resultsAnnouncement = $state('');
	// Screen readers hear the new count after a filter change, not on the first render.
	afterNavigate((nav) => {
		if (nav.type === 'enter' || nav.from?.url.pathname !== nav.to?.url.pathname) return;
		resultsAnnouncement = t.resultsAnnounce.replace('{n}', String(displayShelters.length));
	});

	function navigateFilters(params: URLSearchParams) {
		void goto(resolve(`/shelters?${params.toString()}`), { keepFocus: true, noScroll: true });
	}

	function removeFilter(chip: ActiveFilterChip) {
		navigateFilters(paramsWithoutFilter(page.url.searchParams, chip));
	}

	function clearAllFilters() {
		navigateFilters(paramsWithoutAllFilters(page.url.searchParams, filterChips));
	}

	function expandRadius() {
		navigateFilters(paramsWithRadius(page.url.searchParams, nextRadiusKm(radiusKm)));
	}

	/** Forget the search origin: the URL and the live position (bound into the filter panel). */
	function clearPosition() {
		liveUserLat = '';
		liveUserLng = '';
		navigateFilters(paramsWithoutPosition(page.url.searchParams));
	}

	function getStatusColor(status: string) {
		switch (status) {
			case 'OPEN':
				return 'bg-transparent text-success border-border/80';
			case 'FULL':
				return 'bg-transparent text-danger border-border/80';
			case 'PREPARE':
				return 'bg-transparent text-warning border-border/80';
			case 'UNKNOWN':
				// CR-252 FR-20: Slate/Neutral, distinct from the yellow of standby
				return 'border-slate-300 bg-slate-100 text-slate-700';
			default:
				return 'bg-transparent text-muted-foreground border-border/80';
		}
	}

	function getStatusText(status: string) {
		switch (status) {
			case 'OPEN':
				return t.statusOpen;
			case 'FULL':
				return t.statusFull;
			case 'PREPARE':
				return t.statusPrepare;
			case 'UNKNOWN':
				return t.statusUnknown;
			default:
				return t.statusClosed;
		}
	}
</script>

<svelte:head>
	<title>{t.pageTitle}</title>
</svelte:head>

{#snippet filterCountBadge(onPrimary = false)}
	{#if filterCount > 0}
		<span
			aria-hidden="true"
			class={[
				'inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 pt-[1.5px] text-2xs leading-none font-bold tabular-nums',
				onPrimary ? 'bg-primary-foreground text-primary' : 'bg-primary text-primary-foreground'
			]}>{filterCount}</span
		>
		<span class="sr-only">({filterCountText})</span>
	{/if}
{/snippet}

{#snippet emptyList()}
	<ShelterListEmpty
		reason={emptyReason}
		{radiusKm}
		onExpandRadius={expandRadius}
		onClearPosition={clearPosition}
		onClearFilters={clearAllFilters}
	/>
{/snippet}

<p data-testid="results-announcer" class="sr-only" aria-live="polite">{resultsAnnouncement}</p>

<!--
	One viewport, no page scroll (#1419): the column is exactly as tall as what is left under the
	fixed navbar, the map takes whatever the control bar / metric cards leave, and the mobile list
	scrolls inside its own box.
-->
<div
	class="mx-auto flex h-[calc(100dvh-var(--public-navbar-offset,4rem)-var(--testing-banner-height,0px))] w-full max-w-[1600px] flex-col gap-3 overflow-hidden px-3 py-3 sm:px-6 lg:px-8"
>
	<!-- Mobile Top Control Bar (< lg) -->
	<div class="flex shrink-0 items-center justify-between gap-2 lg:hidden">
		<!-- View Switcher Tabs -->
		<div class="inline-flex rounded-xl border border-border/80 bg-muted/60 p-1 shadow-2xs">
			<button
				type="button"
				class="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold whitespace-nowrap transition-all {mobileViewMode ===
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
				class="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold whitespace-nowrap transition-all {mobileViewMode ===
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
			data-testid="mobile-filter-btn"
			data-active={filterCount > 0 ? 'true' : undefined}
			class={[
				'flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold whitespace-nowrap shadow-2xs transition-all active:scale-95',
				filterCount > 0
					? 'border-primary bg-primary text-primary-foreground'
					: 'border-border/80 bg-card text-foreground'
			]}
			onclick={() => (mobileFilterOpen = true)}
		>
			<Filter
				class={['h-3.5 w-3.5', filterCount > 0 ? 'text-primary-foreground' : 'text-primary']}
			/>
			<span>{t.filterBtn}</span>
			{@render filterCountBadge(filterCount > 0)}
		</button>
	</div>

	<!-- Map view: the filters in use, one scrolling row (the list view shows its own chips) -->
	{#if mobileViewMode === 'map' && filterChips.length > 0}
		<ActiveFilterChips
			chips={filterChips}
			onRemove={removeFilter}
			onClearAll={clearAllFilters}
			scroll
			class="shrink-0 lg:hidden"
		/>
	{/if}

	<!-- Metric Cards (desktop only — the mobile page is the map or the list, nothing above it) -->
	<div
		class="hidden shrink-0 grid-cols-2 gap-3 sm:gap-4 md:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] lg:grid lg:gap-6"
	>
		<PublicShelterMetricCard
			title={t.totalShelters}
			value={data?.summary?.shelters_total ?? '–'}
			unit={t.locationsUnit}
			icon={ClipboardList}
			iconClass="border-accent-purple shadow-accent-purple/15 text-accent-purple"
		/>

		<PublicShelterMetricCard
			title={t.openShelters}
			value={data?.summary?.shelters_open ?? '–'}
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
			: 'block'} min-h-0 w-full flex-1 overflow-hidden rounded-2xl border border-border/80 bg-muted shadow-xs"
	>
		<!-- Full Map Canvas (Background). No z-index here: the map isolates itself, and the opened
			legend must be able to rise above the floating panels (#1461). -->
		<div class="absolute inset-0 h-full w-full">
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
				{legendCompact}
				legendClass={[
					// keep the legend between the floating panels (left-4 + w-80/88, right-4 + w-88/96)
					showFilterPanel && 'lg:left-[22rem] xl:left-[24rem]',
					showListPanel && 'lg:right-[24rem] xl:right-[26rem]'
				]}
			/>
		</div>

		<!-- Desktop Floating Filter Panel (Left) -->
		{#if showFilterPanel}
			<div
				class="absolute top-4 left-4 z-20 hidden max-h-[calc(100%-2rem)] w-80 flex-col lg:flex xl:w-88"
			>
				<ShelterFilterPanel
					filters={data?.filters || {}}
					availableTypes={data?.available_types || []}
					action="/shelters"
					bind:userLat={liveUserLat}
					bind:userLng={liveUserLng}
					class="min-h-0 flex-1"
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
				{@render filterCountBadge()}
				<ChevronRight class="h-3.5 w-3.5 text-muted-foreground" />
			</button>
		{/if}

		<!-- Desktop Floating Shelter List Panel (Right) -->
		{#if showListPanel}
			<div
				class="absolute top-4 right-4 z-20 hidden max-h-[calc(100%-2rem)] w-88 flex-col overflow-hidden rounded-2xl border border-border/80 bg-card/95 shadow-lg backdrop-blur-md transition-all duration-300 lg:flex xl:w-96"
			>
				<div
					class="flex items-center justify-between border-b border-border/60 bg-muted/40 px-4 py-3"
				>
					<div class="flex items-center gap-2">
						<Building2 class="h-4 w-4 text-primary" />
						<h3 class="text-sm font-bold text-foreground">{t.listTitle}</h3>
						<span class="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
							{displayShelters.length}
							{t.locationsUnit}
						</span>
					</div>
					<button
						type="button"
						class="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
						onclick={() => (showListPanel = false)}
						title={t.collapseList}
					>
						<ChevronRight class="h-4 w-4" />
					</button>
				</div>

				<ActiveFilterChips
					chips={filterChips}
					onRemove={removeFilter}
					onClearAll={clearAllFilters}
					class="shrink-0 border-b border-border/60 px-3 py-2"
				/>

				<div
					bind:this={listContainerEl}
					aria-busy={listBusy}
					class={[
						'custom-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 transition-opacity duration-200',
						listBusy && 'opacity-50'
					]}
				>
					{#each displayShelters as shelter, i (shelter.id || shelter.code || i)}
						{@const shelterKey = shelter.id || shelter.code || String(i)}
						<div
							id={`shelter-card-${shelterKey}`}
							data-shelter-id={shelter.id}
							data-shelter-code={shelter.code}
							class="transition-all duration-200"
						>
							<PublicShelterCard
								{shelter}
								{getStatusColor}
								{getStatusText}
								isSelected={selectedShelterId === shelter.id ||
									Boolean(shelter.code && selectedShelterId === shelter.code)}
								onSelect={() => handleSelectShelter(shelter.id || shelter.code)}
								onPreRegister={openBooking}
							/>
						</div>
					{:else}
						{@render emptyList()}
					{/each}
				</div>
			</div>
		{:else}
			<button
				type="button"
				class="absolute top-4 right-4 z-20 hidden items-center gap-2 rounded-xl border border-border/80 bg-card/95 px-3.5 py-2.5 text-xs font-bold text-foreground shadow-md backdrop-blur-md transition-all hover:bg-card lg:flex"
				onclick={() => (showListPanel = true)}
			>
				<ChevronLeft class="h-3.5 w-3.5 text-muted-foreground" />
				<Building2 class="h-4 w-4 text-primary" />
				<span>{t.listTitle}</span>
				<span class="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
					{displayShelters.length}
				</span>
			</button>
		{/if}

		<!-- Desktop, list panel collapsed: chips + empty state on the map, below the pin control -->
		{#if showMapOverlay}
			<div
				class={[
					'pointer-events-none absolute inset-x-3 top-[5.5rem] bottom-16 z-20 hidden justify-center lg:flex',
					showFilterPanel && 'lg:left-[22rem] xl:left-[24rem]'
				]}
			>
				<MapFilterOverlay
					class="h-fit"
					chips={filterChips}
					resultCount={displayShelters.length}
					{radiusKm}
					onRemove={removeFilter}
					onClearAll={clearAllFilters}
					onExpandRadius={expandRadius}
					onClearPosition={clearPosition}
				/>
			</div>
		{/if}

		<!-- Mobile Bottom Compact Selected Card (Map Mode Only, < lg) -->
		{#if selectedShelter && isMobile && mobileViewMode === 'map'}
			<div
				class="pointer-events-auto absolute right-3 bottom-3 left-3 z-20 mx-auto max-w-md animate-in duration-200 slide-in-from-bottom-3 lg:hidden"
			>
				<div
					class="relative rounded-2xl border border-border/80 bg-card/95 p-3.5 shadow-xl backdrop-blur-md"
				>
					<!-- Top row: Status + Distance + Close -->
					<div class="flex items-center justify-between gap-2 border-b border-border/50 pb-2">
						<div class="flex items-center gap-2">
							{#if selectedShelter.is_external}
								<ExternalShelterChip
									label={t.statusUnknown}
									href={selectedShelter.external_url}
									linkLabel={`${cardT.externalLink} ${cardT.externalLinkNewTab}`}
								/>
							{:else}
								<span
									class="inline-flex items-center rounded-full border px-2 py-0.5 text-2xs font-bold {getStatusColor(
										selectedShelter.status
									)}"
								>
									<span class="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-current"></span>
									{getStatusText(selectedShelter.status)}
								</span>
							{/if}
							{#if selectedShelter.distance != null && !isNaN(selectedShelter.distance) && selectedShelter.distance > 0}
								<span
									class="inline-flex items-center gap-1 text-2xs font-semibold text-muted-foreground"
								>
									<Navigation class="h-3 w-3" />
									{selectedShelter.distance}
									{cardT.km}
								</span>
							{/if}
						</div>
						<button
							type="button"
							class="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground hover:text-foreground"
							onclick={() => (selectedShelterId = null)}
							aria-label="Close"
						>
							<X class="h-3.5 w-3.5" />
						</button>
					</div>

					<!-- Content row: Title & Capacity -->
					<div class="mt-2">
						<h4 class="line-clamp-1 text-sm font-bold text-foreground">
							{selectedShelter.name}
						</h4>
						<div class="mt-0.5 flex items-center justify-between text-2xs text-muted-foreground">
							<span class="line-clamp-1">
								{selectedShelter.district
									? `${cardT.districtPrefix}${selectedShelter.district}`
									: ''}
								{selectedShelter.province
									? `, ${cardT.provincePrefix}${selectedShelter.province}`
									: ''}
							</span>
							<span class="shrink-0 font-semibold text-foreground">
								<Users class="mr-0.5 inline-block h-3 w-3 text-muted-foreground" />
								{#if selectedShelter.is_external && !((selectedShelter.capacity ?? 0) > 0)}
									{cardT.contactAtShelter}
								{:else}
									{cardT.maxCapacity}
									{selectedShelter.capacity ?? 0}
									{cardT.people}
								{/if}
							</span>
						</div>
					</div>

					<!-- Actions row -->
					<div class="mt-2.5 flex gap-1.5">
						{#if !selectedShelter.is_external && selectedShelter.status !== 'CLOSED' && selectedShelter.accepts_pre_registration && selectedShelter.code}
							<Button
								type="button"
								size="sm"
								class="h-9 flex-1 rounded-xl bg-primary text-2xs font-bold text-primary-foreground shadow-xs"
								onclick={() => openBooking(selectedShelter.code)}
							>
								<ClipboardCheck class="mr-1 h-3.5 w-3.5" />
								{cardT.preRegister}
							</Button>
						{/if}
						<Button
							href={`/shelters/${selectedShelter.id}`}
							variant="outline"
							size="sm"
							class="h-9 flex-1 rounded-xl border-border text-2xs font-bold text-foreground hover:bg-muted"
						>
							<Eye class="mr-1 h-3.5 w-3.5" />
							{cardT.viewDetails}
						</Button>
						{#if selectedShelter.geo?.lat != null && selectedShelter.geo?.lng != null}
							<Button
								href={directionsUrl(selectedShelter.geo)}
								target="_blank"
								rel="noopener noreferrer"
								size="sm"
								class="h-9 w-9 shrink-0 rounded-xl bg-primary-dark p-0 text-primary-foreground hover:bg-primary"
								aria-label={cardT.navigate}
								title={cardT.navigate}
							>
								<Navigation class="h-3.5 w-3.5" />
							</Button>
						{/if}
					</div>
				</div>
			</div>
		{/if}
	</div>

	<!-- Mobile Shelter List View (when mobileViewMode === 'list', < lg) -->
	{#if mobileViewMode === 'list'}
		<div
			aria-busy={listBusy}
			class={[
				'min-h-0 flex-1 space-y-3 overflow-y-auto pb-16 transition-opacity duration-200 lg:hidden',
				listBusy && 'opacity-50'
			]}
		>
			<div class="flex items-center justify-between px-1 text-xs text-muted-foreground">
				<span class="font-bold text-foreground">
					{t.listTitle}
					{displayShelters.length}
					{t.locationsUnit}
				</span>
				{#if liveUserLat && liveUserLng}
					<span>{t.sortedByDistance}</span>
				{/if}
			</div>

			<ActiveFilterChips
				chips={filterChips}
				onRemove={removeFilter}
				onClearAll={clearAllFilters}
				class="px-1"
			/>

			{#each displayShelters as shelter, i (shelter.id || shelter.code || i)}
				{@const shelterKey = shelter.id || shelter.code || String(i)}
				<div id={`shelter-card-mobile-${shelterKey}`} class="transition-all duration-200">
					<PublicShelterCard
						{shelter}
						{getStatusColor}
						{getStatusText}
						isSelected={selectedShelterId === shelter.id ||
							Boolean(shelter.code && selectedShelterId === shelter.code)}
						onSelect={() => {
							handleSelectShelter(shelter.id || shelter.code);
							mobileViewMode = 'map';
						}}
						onPreRegister={openBooking}
					/>
				</div>
			{:else}
				{@render emptyList()}
			{/each}

			<!-- Mobile Floating Action to switch back to map -->
			<div class="fixed bottom-4 left-1/2 z-30 -translate-x-1/2">
				<button
					type="button"
					class="flex items-center gap-2 rounded-full border border-border/80 bg-primary px-5 py-2.5 text-xs font-bold text-primary-foreground shadow-lg backdrop-blur-md transition-all active:scale-95"
					onclick={() => (mobileViewMode = 'map')}
				>
					<Map class="h-4 w-4" />
					<span>{t.viewOnMap}</span>
				</button>
			</div>
		</div>
	{/if}

	<!-- Mobile Full-Screen / Sheet Filter Modal (< lg) -->
	{#if mobileFilterOpen}
		<div
			class="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-xs lg:hidden"
		>
			<!-- Backdrop tap to close -->
			<button
				type="button"
				class="absolute inset-0 cursor-default"
				onclick={() => (mobileFilterOpen = false)}
				aria-label="Close filter drawer"
			></button>

			<!-- Sheet Modal Content -->
			<div
				class="relative z-10 flex max-h-[85vh] w-full animate-in flex-col rounded-t-3xl border-t border-border bg-card shadow-2xl duration-300 slide-in-from-bottom"
			>
				<div class="flex items-center justify-between border-b border-border/60 px-4 py-3">
					<div class="flex items-center gap-2">
						<Filter class="h-4 w-4 text-primary" />
						<h3 class="text-sm font-bold text-foreground">{t.searchAndFilter}</h3>
					</div>
					<button
						type="button"
						class="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground hover:text-foreground"
						onclick={() => (mobileFilterOpen = false)}
						aria-label="Close filter drawer"
					>
						<X class="h-4 w-4" />
					</button>
				</div>
				<div class="flex-1 overflow-y-auto p-4">
					<ShelterFilterPanel
						filters={data?.filters || {}}
						availableTypes={data?.available_types || []}
						action="/shelters"
						bind:userLat={liveUserLat}
						bind:userLng={liveUserLng}
						idPrefix="mobile-"
						class="h-auto max-h-none border-0 bg-transparent p-0 shadow-none"
						onClose={() => (mobileFilterOpen = false)}
					/>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	/* Custom scrollbar for the list */
	.custom-scrollbar::-webkit-scrollbar {
		width: 4px;
	}
	.custom-scrollbar::-webkit-scrollbar-track {
		background: transparent;
	}
	.custom-scrollbar::-webkit-scrollbar-thumb {
		background-color: #cbd5e1;
		border-radius: 10px;
	}
	.custom-scrollbar:hover::-webkit-scrollbar-thumb {
		background-color: #94a3b8;
	}
</style>
