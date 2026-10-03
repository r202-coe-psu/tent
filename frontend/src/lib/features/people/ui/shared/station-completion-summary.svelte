<script module lang="ts">
	export type StationSummaryFact = { label: string; value: string };
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import CircleCheck from '@lucide/svelte/icons/circle-check';

	/**
	 * Shared "done — what next" card for onsite stations (Station 1 registration, Station 2
	 * screening): what was saved, then the next-step actions.
	 */
	let {
		title,
		subtitle = '',
		facts = [],
		children,
		actions
	}: {
		title: string;
		subtitle?: string;
		facts?: StationSummaryFact[];
		children?: Snippet;
		actions: Snippet;
	} = $props();
</script>

<section
	class="space-y-4 rounded-xl border border-emerald-200 bg-white p-4 shadow-2xs sm:p-5"
	aria-live="polite"
>
	<div class="flex items-start gap-3">
		<div
			class="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"
		>
			<CircleCheck class="size-5" aria-hidden="true" />
		</div>
		<div class="min-w-0">
			<h2 class="text-lg font-bold text-slate-900 sm:text-xl">{title}</h2>
			{#if subtitle}
				<p class="text-sm text-slate-500">{subtitle}</p>
			{/if}
		</div>
	</div>

	{#if facts.length > 0}
		<dl class="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
			{#each facts as fact (fact.label)}
				<div class="flex flex-wrap gap-x-2">
					<dt class="text-slate-500">{fact.label}</dt>
					<dd class="font-semibold text-slate-900 tabular-nums">{fact.value}</dd>
				</div>
			{/each}
		</dl>
	{/if}

	{@render children?.()}

	<div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
		{@render actions()}
	</div>
</section>
