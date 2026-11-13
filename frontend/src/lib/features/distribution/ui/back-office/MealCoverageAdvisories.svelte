<script lang="ts">
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { Alert, AlertDescription } from '$lib/components/ui/alert/index.js';
	import type { MealPeriod } from '../../domain/food-supplies';
	import { mealList } from '../model/meal-coverage-csv';

	interface Props {
		skippedCount: number;
		unscanned: readonly MealPeriod[];
	}

	let { skippedCount, unscanned }: Props = $props();

	const alertClass = 'border-amber-200/80 bg-amber-50 text-amber-900';
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
			ไม่มีบันทึกสแกนมื้อ{mealList(unscanned)}ของวันที่เลือกเลย อาจแจกโดยไม่สแกน
			จำนวนผู้ที่ยังไม่มีบันทึกจึงอาจสูงกว่าความจริง
		</AlertDescription>
	</Alert>
{/if}
