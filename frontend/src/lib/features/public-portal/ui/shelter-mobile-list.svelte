<script lang="ts">
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Map from '@lucide/svelte/icons/map';

	import PublicShelterCard from './public-shelter-card.svelte';
	import type { PublicShelterCardModel } from '../domain/types';
	import { isShelterSelected } from '../domain/shelter-list';
	import { shelterStatusClass, shelterStatusLabel } from '../domain/shelter-status';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_SHELTERS_I18N } from '$lib/constants/i18n';
	import { langState } from '$lib/states/i18n.svelte';

	/** Mobile (< lg) shelter list view of the `/shelters` page, with the button back to the map. */
	let {
		shelters,
		selectedId,
		sortedByDistance,
		onSelect,
		onPreRegister,
		onViewMap
	}: {
		shelters: readonly PublicShelterCardModel[];
		selectedId: string | null;
		/** A search origin is set, so the list is ordered by distance from it. */
		sortedByDistance: boolean;
		/** A card was picked; gets the shelter's `id` (or its `code` when it has no id). */
		onSelect: (shelterId: string) => void;
		onPreRegister: (shelterCode: string) => void;
		onViewMap: () => void;
	} = $props();

	const t = $derived(getTranslation(PUBLIC_SHELTERS_I18N, langState.current));
	const statusText = (status: string) => shelterStatusLabel(status, t);
</script>

<div class="space-y-3 pb-16 lg:hidden">
	<div class="flex items-center justify-between px-1 text-xs text-muted-foreground">
		<span class="font-bold text-foreground">
			{shelters.length}
			{t.locationsUnit}
		</span>
		{#if sortedByDistance}
			<span>{t.sortedByDistance}</span>
		{/if}
	</div>

	{#each shelters as shelter, i (shelter.id || shelter.code || i)}
		{@const shelterKey = shelter.id || shelter.code || String(i)}
		<div id={`shelter-card-mobile-${shelterKey}`} class="transition-all duration-200">
			<PublicShelterCard
				{shelter}
				getStatusColor={shelterStatusClass}
				getStatusText={statusText}
				isSelected={isShelterSelected(shelter, selectedId)}
				onSelect={() => onSelect(shelter.id || shelter.code)}
				{onPreRegister}
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
			onclick={onViewMap}
		>
			<Map class="h-4 w-4" />
			<span>{t.viewOnMap}</span>
		</button>
	</div>
</div>
