<script lang="ts">
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { Alert, AlertDescription } from '$lib/components/ui/alert/index.js';
	import { formatThaiDate } from '$lib/utils/date';
	import type { MealPeriod } from '../../domain/food-supplies';
	import type { UnscannedMeal } from '../../domain/food-supplies/meal-coverage';
	import { mealList } from '../model/meal-coverage-csv';

	interface Props {
		skippedCount: number;
		/** Served meals with no distribution log at all, per day. */
		unscanned: readonly UnscannedMeal[];
		/** The report covers one day: the sentence names no day. */
		single: boolean;
	}

	let { skippedCount, unscanned, single }: Props = $props();

	const alertClass = 'border-amber-200/80 bg-amber-50 text-amber-900';
	const MAX_DAYS_LISTED = 7;

	// `unscanned` comes day by day, so the meals of a day are next to each other.
	const byDay = $derived(
		unscanned.reduce<{ day: string; meals: MealPeriod[] }[]>((groups, { day, meal }) => {
			const last = groups.at(-1);
			if (last?.day === day) last.meals.push(meal);
			else groups.push({ day, meals: [meal] });
			return groups;
		}, [])
	);
	const listed = $derived(byDay.slice(0, MAX_DAYS_LISTED));
	const hiddenDays = $derived(byDay.length - listed.length);
</script>

{#if skippedCount > 0}
	<Alert class={alertClass} role="alert">
		<TriangleAlert aria-hidden="true" />
		<AlertDescription class="text-amber-900">
			มีบันทึกการแจก <span class="tabular-nums">{skippedCount}</span> รายการที่อ่านไม่ได้ จำนวนมื้ออาจต่ำกว่าความจริง
		</AlertDescription>
	</Alert>
{/if}

{#if unscanned.length > 0}
	<Alert class={alertClass} role="status">
		<TriangleAlert aria-hidden="true" />
		<AlertDescription class="text-amber-900">
			{#if single}
				ไม่มีบันทึกการแจกมื้อ{mealList(unscanned.map((u) => u.meal))}ของวันที่เลือกเลย
				อาจแจกโดยไม่สแกน จำนวนผู้ที่ยังไม่มีบันทึกจึงอาจสูงกว่าความจริง
			{:else}
				<span class="block">
					มื้อที่ให้บริการแต่ไม่มีบันทึกการแจกเลยในวันนั้น อาจแจกโดยไม่สแกน
					จำนวนผู้ที่ยังไม่มีบันทึกจึงอาจสูงกว่าความจริง
				</span>
				<ul class="mt-1 list-disc pl-5">
					{#each listed as item (item.day)}
						<li>{formatThaiDate(item.day)}: {mealList(item.meals)}</li>
					{/each}
				</ul>
				{#if hiddenDays > 0}
					<span class="mt-1 block tabular-nums">และอีก {hiddenDays} วัน</span>
				{/if}
			{/if}
		</AlertDescription>
	</Alert>
{/if}
