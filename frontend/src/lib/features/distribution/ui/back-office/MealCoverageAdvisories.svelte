<script lang="ts">
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import type { MealPeriod } from '../../domain/food-supplies';
	import { mealList } from '../model/meal-coverage-csv';

	interface Props {
		skippedCount: number;
		unscannedMeals: readonly MealPeriod[];
	}

	let { skippedCount, unscannedMeals }: Props = $props();

	const boxClass =
		'flex items-start gap-2 rounded-xl border border-amber-200/80 bg-amber-50 p-3 text-sm text-amber-900';
</script>

{#if skippedCount > 0}
	<div class={boxClass} role="alert">
		<AlertTriangle class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
		มีบันทึกการแจก {skippedCount} รายการที่อ่านไม่ได้ จำนวนมื้ออาจต่ำกว่าความจริง
	</div>
{/if}

{#if unscannedMeals.length > 0}
	<div class={boxClass} role="status">
		<AlertTriangle class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
		ไม่มีบันทึกสแกนมื้อ{mealList(unscannedMeals)}ของวันที่เลือกเลย อาจแจกโดยไม่สแกน
		จำนวนผู้ที่ยังไม่มีบันทึกจึงอาจสูงกว่าความจริง
	</div>
{/if}
