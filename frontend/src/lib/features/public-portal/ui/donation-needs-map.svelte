<script lang="ts">
	import type { Snippet } from 'svelte';
	import X from '@lucide/svelte/icons/x';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_DONATIONS_I18N } from '$lib/constants/i18n';
	import {
		buildDonationMap,
		type DonationMapShelter,
		type DonationNeedsEntry
	} from '../domain/donation-map';
	import { toUiShelterStatus } from '../domain/mappers';
	import { usePublicShelters } from '../application/queries';
	import ShelterMap from './shelter-map.svelte';

	let {
		shelters,
		selectedCode,
		onSelect,
		card
	}: {
		/** Shelters currently on the needs board (after search and filters). */
		shelters: DonationNeedsEntry[];
		selectedCode: string | null;
		onSelect: (code: string | null) => void;
		/** What opens under the map for the tapped shelter. */
		card: Snippet<[DonationMapShelter]>;
	} = $props();

	const t = $derived(getTranslation(PUBLIC_DONATIONS_I18N, langState.current));
	const sheltersQuery = usePublicShelters(() => ({}));

	let mapFailed = $state(false);

	const onMap = $derived(
		buildDonationMap(shelters, sheltersQuery.data?.shelters ?? [], null).onMap
	);
	const mapShelters = $derived(
		onMap.map((shelter) => ({
			id: shelter.code,
			code: shelter.code,
			name: shelter.name,
			status: toUiShelterStatus(shelter.status),
			site_kind: shelter.siteKind,
			geo: shelter.geo,
			distance: null
		}))
	);
	const selected = $derived(onMap.find((shelter) => shelter.code === selectedCode) ?? null);

	const showMap = $derived(onMap.length > 0 && !mapFailed && !sheltersQuery.isError);
	const showUnavailable = $derived(sheltersQuery.isError || mapFailed);
</script>

{#if showMap}
	<div class="space-y-3">
		<div
			class="relative h-64 w-full overflow-hidden rounded-xl border-2 border-slate-200 bg-slate-100 sm:h-80"
			role="region"
			aria-label={t.needsMapLabel}
			data-testid="donation-needs-map"
		>
			<ShelterMap
				shelters={mapShelters}
				selectedId={selectedCode}
				disablePopup
				showLegend={false}
				cooperativeGestures
				onSelectShelter={(code) => onSelect(code || null)}
				onLoadError={() => (mapFailed = true)}
			/>
		</div>
		{#if selected}
			<div class="relative" data-testid="donation-needs-map-card">
				<button
					type="button"
					onclick={() => onSelect(null)}
					class="absolute top-2 right-2 z-10 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-white/90 text-slate-500 shadow-xs hover:bg-slate-100"
					aria-label={t.needsMapCloseCard}
				>
					<X class="h-4 w-4" />
				</button>
				{@render card(selected)}
			</div>
		{:else}
			<p class="text-xs font-medium text-slate-500">{t.needsMapHint}</p>
		{/if}
	</div>
{:else if showUnavailable}
	<p class="rounded-xl border border-slate-200 bg-white p-3 text-xs font-medium text-slate-600">
		{t.needsMapUnavailable}
	</p>
{/if}
