<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_SHELTERS_I18N } from '$lib/constants/i18n';
	import { langState } from '$lib/states/i18n.svelte';
	import { activeFilterCount, type ActiveFilterChip } from '../domain/active-filters';

	let {
		chips,
		onRemove,
		onClearAll,
		class: className = ''
	}: {
		chips: ActiveFilterChip[];
		onRemove: (chip: ActiveFilterChip) => void;
		onClearAll: () => void;
		class?: string;
	} = $props();

	const t = $derived(getTranslation(PUBLIC_SHELTERS_I18N, langState.current));
	// Only the default radius on screen: "clear all" would leave it as it is.
	const canClearAll = $derived(activeFilterCount(chips) > 0);
</script>

{#if chips.length > 0}
	<div
		role="group"
		aria-label={t.activeFiltersLabel}
		class={['flex min-w-0 flex-wrap items-center gap-1.5', className]}
	>
		{#each chips as chip (chip.key)}
			<button
				type="button"
				class="inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border border-primary/30 bg-primary/5 py-1 pr-1.5 pl-2.5 text-xs font-medium text-primary-dark transition-colors hover:border-primary/50 hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
				aria-label={t.removeChip.replace('{label}', chip.label)}
				title={t.removeChip.replace('{label}', chip.label)}
				onclick={() => onRemove(chip)}
			>
				<span class="truncate">{chip.label}</span>
				<X class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
			</button>
		{/each}
		{#if canClearAll}
			<button
				type="button"
				class="rounded-full px-2 py-1 text-xs font-semibold text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
				onclick={onClearAll}
			>
				{t.clearAll}
			</button>
		{/if}
	</div>
{/if}
