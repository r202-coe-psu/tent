<script lang="ts">
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import { Button } from '$lib/components/ui/button';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_SHELTERS_I18N } from '$lib/constants/i18n';
	import { langState } from '$lib/states/i18n.svelte';
	import type { EmptyListReason } from '../domain/active-filters';

	let {
		reason,
		radiusKm = '',
		onExpandRadius,
		onClearPosition,
		onClearFilters,
		framed = true,
		class: className = ''
	}: {
		/** What narrowed the list to nothing; see `emptyListReason`. */
		reason: EmptyListReason;
		radiusKm?: string;
		onExpandRadius: () => void;
		onClearPosition: () => void;
		onClearFilters: () => void;
		/** Dashed card of its own; off when it sits inside another card. */
		framed?: boolean;
		class?: string;
	} = $props();

	const t = $derived(getTranslation(PUBLIC_SHELTERS_I18N, langState.current));
	const title = $derived(
		reason === 'radius'
			? t.emptyRadius.replace('{km}', radiusKm)
			: reason === 'filtered'
				? t.emptyFiltered
				: t.noShelters
	);
</script>

<div
	class={[
		'flex flex-col items-center justify-center text-center text-muted-foreground',
		framed ? 'rounded-xl border border-dashed border-border bg-card p-6' : 'p-1',
		className
	]}
>
	<AlertTriangle class="mb-2 h-7 w-7 text-muted-foreground/50" aria-hidden="true" />
	<p class="text-sm font-semibold text-foreground">{title}</p>
	{#if reason === 'none'}
		<p class="mt-1 text-xs">{t.tryChangeFilter}</p>
	{:else}
		<div class="mt-3 flex flex-wrap justify-center gap-2">
			{#if reason === 'radius'}
				<Button type="button" size="sm" class="rounded-lg" onclick={onExpandRadius}>
					{t.expandRadius}
				</Button>
				<Button
					type="button"
					size="sm"
					variant="outline"
					class="rounded-lg"
					onclick={onClearPosition}
				>
					{t.clearPosition}
				</Button>
			{:else}
				<Button type="button" size="sm" class="rounded-lg" onclick={onClearFilters}>
					{t.clearFilters}
				</Button>
			{/if}
		</div>
	{/if}
</div>
