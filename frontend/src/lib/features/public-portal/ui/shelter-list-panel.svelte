<script lang="ts">
	import Building2 from '@lucide/svelte/icons/building-2';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';

	import PublicShelterCard from './public-shelter-card.svelte';
	import type { PublicShelterCardModel } from '../domain/types';
	import { isShelterSelected } from '../domain/shelter-list';
	import { shelterStatusClass, shelterStatusLabel } from '../domain/shelter-status';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_SHELTERS_I18N } from '$lib/constants/i18n';
	import { langState } from '$lib/states/i18n.svelte';

	/**
	 * Desktop (≥ lg) floating shelter list on the right of the `/shelters` map: collapsible, and
	 * hands its scroll container back so the page can bring a picked pin's card into view.
	 */
	let {
		shelters,
		selectedId,
		open = $bindable(true),
		listEl = $bindable(null),
		onSelect,
		onPreRegister
	}: {
		shelters: readonly PublicShelterCardModel[];
		selectedId: string | null;
		open?: boolean;
		listEl?: HTMLElement | null;
		/** A card was picked; gets the shelter's `id` (or its `code` when it has no id). */
		onSelect: (shelterId: string) => void;
		onPreRegister: (shelterCode: string) => void;
	} = $props();

	const t = $derived(getTranslation(PUBLIC_SHELTERS_I18N, langState.current));
	const statusText = (status: string) => shelterStatusLabel(status, t);
</script>

{#if open}
	<div
		class="absolute top-4 right-4 z-20 hidden max-h-[calc(100%-2rem)] w-88 flex-col overflow-hidden rounded-2xl border border-border/80 bg-card/95 shadow-lg backdrop-blur-md transition-all duration-300 lg:flex xl:w-96"
	>
		<div class="flex items-center justify-between border-b border-border/60 bg-muted/40 px-4 py-3">
			<div class="flex items-center gap-2">
				<Building2 class="h-4 w-4 text-primary" />
				<h3 class="text-sm font-bold text-foreground">{t.listTitle}</h3>
				<span class="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
					{shelters.length}
					{t.locationsUnit}
				</span>
			</div>
			<button
				type="button"
				class="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				onclick={() => (open = false)}
				title={t.collapseList}
			>
				<ChevronRight class="h-4 w-4" />
			</button>
		</div>

		<div
			bind:this={listEl}
			class="custom-scrollbar flex flex-1 flex-col gap-3 overflow-y-auto p-3"
			style="max-height: calc(100vh - 21rem);"
		>
			{#each shelters as shelter, i (shelter.id || shelter.code || i)}
				{@const shelterKey = shelter.id || shelter.code || String(i)}
				<div
					id={`shelter-card-${shelterKey}`}
					data-shelter-id={shelter.id}
					data-shelter-code={shelter.code}
					class="transition-all duration-200"
				>
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
		onclick={() => (open = true)}
	>
		<ChevronLeft class="h-3.5 w-3.5 text-muted-foreground" />
		<Building2 class="h-4 w-4 text-primary" />
		<span>{t.listTitle}</span>
		<span class="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
			{shelters.length}
		</span>
	</button>
{/if}

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
