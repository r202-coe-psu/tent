<script lang="ts">
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import type { MealPeriod } from '../../domain/food-supplies';
	import { mealList } from '../model/meal-coverage-csv';

	interface Props {
		skippedCount: number;
		unscanned: readonly MealPeriod[];
	}

	let { skippedCount, unscanned }: Props = $props();

	const boxClass =
		'flex items-start gap-2 rounded-xl border border-amber-200/80 bg-amber-50 p-3 text-sm text-amber-900';
</script>

{#if skippedCount > 0}
	<div class={boxClass} role="alert">
		<TriangleAlert class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
		มีบันทึกการแจก <span class="tabular-nums">{skippedCount}</span> รายการที่อ่านไม่ได้ จำนวนมื้ออาจต่ำกว่าความจริง
	</div>
{/if}

{#if unscanned.length > 0}
	<div class={boxClass} role="status">
		<TriangleAlert class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
		ไม่มีบันทึกสแกนมื้อ{mealList(unscanned)}ของวันที่เลือกเลย อาจแจกโดยไม่สแกน
		จำนวนผู้ที่ยังไม่มีบันทึกจึงอาจสูงกว่าความจริง
	</div>
{/if}
