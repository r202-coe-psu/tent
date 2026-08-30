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

	import {
		PublicShelterMetricCard,
		PublicShelterCard,
		ShelterFilterPanel,
		ShelterMap,
		PublicHeroMetrics,
		PublicPageShell,
		type PublicShelterCardModel
	} from '$lib/features/public-portal';
	import { BookingModal } from '$lib/features/public-register';

	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_SHELTERS_I18N } from '$lib/constants/i18n';
	import { langState } from '$lib/states/i18n.svelte';

	let { data }: { data: PageData } = $props();

	let liveUserLat = $state('');
	let liveUserLng = $state('');
	let bookingOpen = $state(false);
	let bookingShelterCode = $state('');

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

	$effect(() => {
		if (data?.filters?.user_lat) liveUserLat = data.filters.user_lat.toString();
		if (data?.filters?.user_lng) liveUserLng = data.filters.user_lng.toString();
	});

	function openBooking(shelterCode: string) {
		bookingShelterCode = shelterCode;
		bookingOpen = true;
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

<PublicPageShell class="space-y-8">
	<!-- Header / Hero Section -->
	<PublicHeroMetrics
		title={t.heroTitle}
		description={t.heroDesc}
		badgeText={t.heroBadge}
		badgeIcon={Building2}
		showLivePing={false}
		bgClass="bg-primary-dark"
		showSearch={false}
	/>

	<!-- Metric Cards (capacity directory — no occupancy aggregates per CR-017) -->
	<div class="grid grid-cols-2 gap-4 md:grid-cols-4 lg:gap-6">
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

	<!-- Main Content: Filters, Map, and List -->
	<div class="grid grid-cols-1 gap-6 lg:grid-cols-12">
		<!-- Left: Filters (3 columns on desktop) -->
		<div class="flex flex-col gap-5 lg:col-span-3">
			<ShelterFilterPanel
				filters={data?.filters || {}}
				availableTypes={data?.available_types || []}
				action="/shelters"
				bind:userLat={liveUserLat}
				bind:userLng={liveUserLng}
			/>
		</div>

		<!-- Middle: Map (5 columns on desktop) -->
		<div class="h-100 min-h-125 lg:col-span-5 lg:h-auto">
			<div
				class="relative z-0 h-full w-full overflow-hidden rounded-2xl border border-border bg-muted shadow-inner"
			>
				<ShelterMap
					shelters={displayShelters}
					userLocation={liveUserLat && liveUserLng
						? { lat: liveUserLat, lng: liveUserLng }
						: undefined}
					radiusKm={mapRadiusKm}
					onLocationPick={applySearchOrigin}
				/>
			</div>
		</div>

		<!-- Right: Shelter List (4 columns on desktop) -->
		<div class="flex h-100 min-h-125 flex-col gap-4 lg:col-span-4 lg:h-auto">
			<div class="flex items-center justify-between rounded-t-2xl bg-card px-1 py-1">
				<h3 class="font-bold text-foreground">
					{t.listTitle}
					<span class="ml-1 text-sm font-medium text-muted-foreground"
						>{displayShelters.length} {t.locationsUnit}</span
					>
				</h3>
			</div>

			<div
				class="custom-scrollbar flex flex-col gap-4 overflow-y-auto pr-2"
				style="max-height: 700px;"
			>
				{#each displayShelters as shelter, i (shelter.id || shelter.code || i)}
					<PublicShelterCard
						{shelter}
						{getStatusColor}
						{getStatusText}
						onPreRegister={openBooking}
					/>
				{:else}
					<div
						class="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border p-8 text-center text-muted-foreground"
					>
						<AlertTriangle class="mb-2 h-8 w-8 text-muted-foreground/50" />
						<p class="font-medium">{t.noShelters}</p>
						<p class="text-sm">{t.tryChangeFilter}</p>
					</div>
				{/each}
			</div>
		</div>
	</div>
</PublicPageShell>

<BookingModal bind:open={bookingOpen} shelterCode={bookingShelterCode} />

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
