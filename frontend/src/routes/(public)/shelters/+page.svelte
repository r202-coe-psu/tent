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

	import {
		PublicShelterMetricCard,
		PublicShelterCard,
		ShelterFilterPanel,
		ShelterMap,
		PublicPageShell,
		type PublicShelterCardModel
	} from '$lib/features/public-portal';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_SHELTERS_I18N } from '$lib/constants/i18n';
	import { langState } from '$lib/states/i18n.svelte';

	let { data }: { data: PageData } = $props();

	let liveUserLat = $state('');
	let liveUserLng = $state('');
	let selectedShelterId = $state<string | null>(null);
	let listContainerEl: HTMLElement | null = $state(null);

	// Floating UI panels state
	let showFilterPanel = $state(true);
	let showListPanel = $state(true);
	let mobileFilterOpen = $state(false);
	let mobileListOpen = $state(false);

	const t = $derived(getTranslation(PUBLIC_SHELTERS_I18N, langState.current));

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

	// Auto-select first shelter on initial load so popup appears immediately
	$effect(() => {
		if (displayShelters.length > 0) {
			if (!hasAutoSelected) {
				const first = displayShelters[0];
				selectedShelterId = first.id || first.code || null;
				hasAutoSelected = true;
			} else if (
				selectedShelterId &&
				!displayShelters.some((s) => s.id === selectedShelterId || s.code === selectedShelterId)
			) {
				const first = displayShelters[0];
				selectedShelterId = first.id || first.code || null;
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

<PublicPageShell class="space-y-4" maxWidth="max-w-[1600px]">
	<!-- Metric Cards (capacity directory — no occupancy aggregates per CR-017) -->
	<div class="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4 lg:gap-6">
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

	<!-- Full Map Container with Overlaid UI -->
	<div
		class="relative h-[calc(100vh-14rem)] min-h-[640px] w-full overflow-hidden rounded-2xl border border-border/80 bg-muted shadow-xs sm:min-h-[720px]"
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
				onSelectShelter={handleSelectShelter}
				onLocationPick={applySearchOrigin}
			/>
		</div>

		<!-- Mobile / Tablet Top Action Pills (< lg) -->
		<div
			class="pointer-events-none absolute top-3 right-3 left-3 z-20 flex items-center justify-between gap-2 lg:hidden"
		>
			<button
				type="button"
				class="pointer-events-auto flex items-center gap-1.5 rounded-full border border-border/80 bg-card/95 px-3.5 py-2 text-xs font-bold text-foreground shadow-md backdrop-blur-md transition-all active:scale-95"
				onclick={() => {
					mobileFilterOpen = !mobileFilterOpen;
					if (mobileFilterOpen) mobileListOpen = false;
				}}
			>
				<Filter class="h-3.5 w-3.5 text-primary" />
				<span>ตัวกรอง</span>
			</button>

			<button
				type="button"
				class="pointer-events-auto flex items-center gap-1.5 rounded-full border border-border/80 bg-card/95 px-3.5 py-2 text-xs font-bold text-foreground shadow-md backdrop-blur-md transition-all active:scale-95"
				onclick={() => {
					mobileListOpen = !mobileListOpen;
					if (mobileListOpen) mobileFilterOpen = false;
				}}
			>
				<Building2 class="h-3.5 w-3.5 text-primary" />
				<span>ศูนย์พักพิง ({displayShelters.length})</span>
			</button>
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

		<!-- Mobile / Tablet Drawer Overlays (< lg) -->
		{#if mobileFilterOpen}
			<!-- Backdrop -->
			<button
				type="button"
				class="absolute inset-0 z-30 bg-black/40 backdrop-blur-xs lg:hidden"
				onclick={() => (mobileFilterOpen = false)}
				aria-label="Close filter drawer"
			></button>
			<div class="absolute inset-y-3 right-3 left-3 z-40 flex max-w-sm flex-col lg:hidden">
				<ShelterFilterPanel
					filters={data?.filters || {}}
					availableTypes={data?.available_types || []}
					action="/shelters"
					bind:userLat={liveUserLat}
					bind:userLng={liveUserLng}
					class="h-full"
					onClose={() => (mobileFilterOpen = false)}
				/>
			</div>
		{/if}

		{#if mobileListOpen}
			<!-- Backdrop -->
			<button
				type="button"
				class="absolute inset-0 z-30 bg-black/40 backdrop-blur-xs lg:hidden"
				onclick={() => (mobileListOpen = false)}
				aria-label="Close shelter list drawer"
			></button>
			<div
				class="absolute inset-y-3 right-3 left-3 z-40 flex flex-col rounded-2xl border border-border/80 bg-card p-4 shadow-xl sm:left-auto sm:w-96 lg:hidden"
			>
				<div class="mb-3 flex items-center justify-between border-b border-border/60 pb-2">
					<div class="flex items-center gap-2">
						<Building2 class="h-4 w-4 text-primary" />
						<h3 class="text-sm font-bold text-foreground">{t.listTitle}</h3>
						<span class="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
							{displayShelters.length}
						</span>
					</div>
					<button
						type="button"
						class="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
						onclick={() => (mobileListOpen = false)}
					>
						<X class="h-4 w-4" />
					</button>
				</div>
				<div class="custom-scrollbar flex-1 space-y-3 overflow-y-auto pr-1">
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
									mobileListOpen = false;
								}}
								onPreRegister={openBooking}
							/>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Mobile Bottom Preview Card for Selected Shelter (< lg) -->
		{#if selectedShelter && !mobileListOpen && !mobileFilterOpen}
			<div
				class="pointer-events-auto absolute right-3 bottom-3 left-3 z-20 mx-auto max-w-md lg:hidden"
			>
				<div class="relative overflow-hidden rounded-2xl shadow-xl">
					<PublicShelterCard
						shelter={selectedShelter}
						{getStatusColor}
						{getStatusText}
						isSelected={true}
						onSelect={() => handleSelectShelter(selectedShelter.id || selectedShelter.code)}
						onPreRegister={openBooking}
					/>
					<button
						type="button"
						class="absolute top-3 right-3 rounded-full border border-border/80 bg-background/90 p-1.5 text-muted-foreground shadow-sm backdrop-blur-xs hover:text-foreground"
						onclick={() => (selectedShelterId = null)}
						aria-label="Close preview"
					>
						<X class="h-3.5 w-3.5" />
					</button>
				</div>
			</div>
		{/if}
	</div>
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
