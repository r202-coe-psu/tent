<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Clock from '@lucide/svelte/icons/clock';
	import Minus from '@lucide/svelte/icons/minus';
	import Users from '@lucide/svelte/icons/users';
	import type { MealPeriod } from '../../domain/food-supplies';
	import { COVERAGE_MEALS } from '../../domain/food-supplies/meal-coverage';
	import { mealList } from '../model/meal-coverage-csv';
	import { getMealPeriodLabel } from '../model/ticket-status';

	interface Props {
		received: readonly MealPeriod[];
		/** Meals already served; the others are "not yet" rather than "no record". */
		servedMeals?: readonly MealPeriod[];
		householdRecorded?: readonly MealPeriod[];
	}

	let { received, servedMeals = COVERAGE_MEALS, householdRecorded = [] }: Props = $props();
</script>

<div class="space-y-1.5">
	<ul class="flex flex-wrap gap-1.5 whitespace-nowrap">
		{#each COVERAGE_MEALS as meal (meal)}
			{@const recorded = received.includes(meal)}
			{@const notYet = !recorded && !servedMeals.includes(meal)}
			<li
				class="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold {recorded
					? 'border-emerald-200 bg-emerald-50 text-emerald-900'
					: notYet
						? 'border-dashed border-slate-300 bg-white text-slate-500'
						: 'border-slate-200 bg-slate-100 text-slate-500'}"
			>
				{#if recorded}
					<Check class="size-3.5" aria-hidden="true" />
				{:else if notYet}
					<Clock class="size-3.5" aria-hidden="true" />
				{:else}
					<Minus class="size-3.5" aria-hidden="true" />
				{/if}
				{getMealPeriodLabel(meal)}
				{#if notYet}
					<span>ยังไม่ถึงมื้อ</span>
				{:else}
					<span class="sr-only">{recorded ? 'มีบันทึก' : 'ยังไม่มีบันทึก'}</span>
				{/if}
			</li>
		{/each}
	</ul>
	{#if householdRecorded.length > 0}
		<p
			class="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-xs font-semibold text-sky-900"
		>
			<Users class="size-3.5" aria-hidden="true" />
			ครัวเรือนมีบันทึกรับ: {mealList(householdRecorded)}
		</p>
	{/if}
</div>
