<script lang="ts">
	import type { PageData } from './$types';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { SvelteURLSearchParams } from 'svelte/reactivity';

	// Icons
	import Building2 from '@lucide/svelte/icons/building-2';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
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

	import {
		PublicShelterMetricCard,
		PublicShelterCard,
		ShelterFilterPanel,
		ShelterMap,
		PublicPageShell,
		type PublicShelterCardModel
	} from '$lib/features/public-portal';
	import { Button } from '$lib/components/ui/button';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_SHELTERS_I18N, PUBLIC_SHELTER_CARD_I18N } from '$lib/constants/i18n';
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
	const cardT = $derived(getTranslation(PUBLIC_SHELTER_CARD_I18N, langState.current));

	$effect(() => {
		if (typeof window !== 'undefined') {
			const mql = window.matchMedia('(max-width: 1023px)');
			isMobile = mql.matches;
			const handler = (e: MediaQueryListEvent) => {
				isMobile = e.matches;
			};
			mql.addEventListener('change', handler);
			return () => mql.removeEventListener('change', handler);
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

	let hasAutoSelected = $state(false);

	// Auto-select first shelter on initial load only on desktop
	$effect(() => {
		if (displayShelters.length > 0) {
			if (!hasAutoSelected) {
				hasAutoSelected = true;
				if (!isMobile) {
					const first = displayShelters[0];
					selectedShelterId = first.id || first.code || null;
				}
			} else if (
				selectedShelterId &&
				!displayShelters.some((s) => s.id === selectedShelterId || s.code === selectedShelterId)
			) {
				selectedShelterId = isMobile
					? null
					: displayShelters[0]?.id || displayShelters[0]?.code || null;
			}
		} else {
			selectedShelterId = null;
		}
	});

	function handleSelectShelter(shelterId: string) {
		selectedShelterId = shelterId;

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
		goto(target as `/${string}`);
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

	function getStatusColor(status: string) {
		switch (status) {
			case 'OPEN':
				return 'bg-transparent text-success border-border/80';
			case 'FULL':
				return 'bg-transparent text-danger border-border/80';
			case 'PREPARE':
				return 'bg-transparent text-warning border-border/80';
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
			default:
				return t.statusClosed;
		}
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
			: 'grid'} grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4 lg:gap-6"
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
				<span>ค้นหาและตัวกรอง</span>
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
						title="ย่อรายการศูนย์"
					>
						<ChevronRight class="h-4 w-4" />
					</button>
				</div>

				<div
					bind:this={listContainerEl}
					class="custom-scrollbar flex flex-1 flex-col gap-3 overflow-y-auto p-3"
					style="max-height: calc(100vh - 21rem);"
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
						<div
							class="flex flex-col items-center justify-center rounded-xl border border-dashed border-border p-6 text-center text-muted-foreground"
						>
							<AlertTriangle class="mb-2 h-7 w-7 text-muted-foreground/50" />
							<p class="text-xs font-medium">{t.noShelters}</p>
							<p class="text-2xs mt-1">{t.tryChangeFilter}</p>
						</div>
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
							<span
								class="inline-flex items-center rounded-full border px-2 py-0.5 text-2xs font-bold {getStatusColor(
									selectedShelter.status
								)}"
							>
								<span class="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-current"></span>
								{getStatusText(selectedShelter.status)}
							</span>
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
								{cardT.maxCapacity}
								{selectedShelter.capacity ?? 0}
								{cardT.people}
							</span>
						</div>
					</div>

					<!-- Actions row -->
					<div class="mt-2.5 flex gap-1.5">
						{#if selectedShelter.status !== 'CLOSED' && selectedShelter.code}
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
								href={`https://www.google.com/maps/dir/?api=1&destination=${selectedShelter.geo.lat},${selectedShelter.geo.lng}`}
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
		<div class="space-y-3 pb-16 lg:hidden">
			<div class="flex items-center justify-between px-1 text-xs text-muted-foreground">
				<span class="font-bold text-foreground">
					{displayShelters.length}
					{t.locationsUnit}
				</span>
				{#if liveUserLat && liveUserLng}
					<span>เรียงตามระยะทางใกล้สุด</span>
				{/if}
			</div>

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
				<div
					class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card p-8 text-center text-muted-foreground"
				>
					<AlertTriangle class="mb-2.5 h-8 w-8 text-muted-foreground/50" />
					<p class="text-sm font-semibold">{t.noShelters}</p>
					<p class="mt-1 text-xs">{t.tryChangeFilter}</p>
				</div>
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
						<h3 class="text-sm font-bold text-foreground">ค้นหาและตัวกรอง</h3>
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
						class="h-auto max-h-none border-0 bg-transparent p-0 shadow-none"
						onClose={() => (mobileFilterOpen = false)}
					/>
				</div>
			</div>
		</div>
	{/if}
</PublicPageShell>

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
