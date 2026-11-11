<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Minus from '@lucide/svelte/icons/minus';
	import type { MealPeriod } from '../../domain/food-supplies';
	import { COVERAGE_MEALS } from '../../domain/food-supplies/meal-coverage';
	import { getMealPeriodLabel } from '../model/ticket-status';

	let { received }: { received: readonly MealPeriod[] } = $props();
</script>

<ul class="flex gap-1.5 whitespace-nowrap">
	{#each COVERAGE_MEALS as meal (meal)}
		{@const recorded = received.includes(meal)}
		<li
			class="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium {recorded
				? 'border-emerald-200 bg-emerald-50 text-emerald-900'
				: 'border-slate-200 bg-slate-100 text-slate-500'}"
		>
			{#if recorded}
				<Check class="size-3.5" aria-hidden="true" />
			{:else}
				<Minus class="size-3.5" aria-hidden="true" />
			{/if}
			{getMealPeriodLabel(meal)}
			<span class="sr-only">{recorded ? 'มีบันทึก' : 'ยังไม่มีบันทึก'}</span>
		</li>
	{/each}
</ul>
