<script lang="ts">
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_SHELTERS_I18N } from '$lib/constants/i18n';
	import { langState } from '$lib/states/i18n.svelte';
	import { emptyListReason, type ActiveFilterChip } from '../domain/active-filters';
	import ActiveFilterChips from './active-filter-chips.svelte';
	import ShelterListEmpty from './shelter-list-empty.svelte';

	/**
	 * The chips and the empty state on the map, for when the desktop list panel is collapsed
	 * (#1419): the filters can always be switched off from what is on screen.
	 */
	let {
		chips,
		resultCount,
		radiusKm = '',
		onRemove,
		onClearAll,
		onExpandRadius,
		onClearPosition,
		class: className = ''
	}: {
		chips: ActiveFilterChip[];
		resultCount: number;
		radiusKm?: string;
		onRemove: (chip: ActiveFilterChip) => void;
		onClearAll: () => void;
		onExpandRadius: () => void;
		onClearPosition: () => void;
		class?: string;
	} = $props();

	const t = $derived(getTranslation(PUBLIC_SHELTERS_I18N, langState.current));
</script>

<section
	data-testid="map-filter-overlay"
	aria-label={t.activeFiltersLabel}
	class={[
		'pointer-events-auto flex max-h-full w-full max-w-md flex-col gap-2 overflow-y-auto rounded-2xl border border-border/80 bg-card/95 p-3 shadow-lg backdrop-blur-md',
		className
	]}
>
	<ActiveFilterChips {chips} {onRemove} {onClearAll} />
	{#if resultCount === 0}
		<ShelterListEmpty
			reason={emptyListReason(chips)}
			{radiusKm}
			{onExpandRadius}
			{onClearPosition}
			onClearFilters={onClearAll}
			framed={false}
		/>
	{/if}
</section>
