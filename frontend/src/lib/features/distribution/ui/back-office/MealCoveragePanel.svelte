<script lang="ts">
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Loader from '@lucide/svelte/icons/loader';
	import { Input } from '$lib/components/ui/input/index.js';
	import { useEvacuees, useMovements } from '$lib/features/people';
	import { useDistributionLogsWithSkipped } from '../../application/queries';
	import type { MealPeriod } from '../../domain/food-supplies';
	import { getMealPeriodLabel } from '../model/ticket-status';
	import {
		MIN_MEALS_PER_DAY,
		summarizeMealCoverage
	} from '../../domain/food-supplies/meal-coverage';
	import { coverageResidents, previousThaiDay } from '../model/meal-coverage-view';

	interface Props {
		shelterCode?: string;
	}

	let { shelterCode }: Props = $props();

	// Today is excluded on purpose: its meals are not over yet, so everyone would look short.
	const latestDay = previousThaiDay();
	let day = $state(latestDay);

	const evacueesQuery = useEvacuees();
	const movementsQuery = useMovements();
	const logsQuery = useDistributionLogsWithSkipped(() => shelterCode);

	const isLoading = $derived(
		evacueesQuery.isLoading || movementsQuery.isLoading || logsQuery.isLoading
	);
	const isError = $derived(evacueesQuery.isError || movementsQuery.isError || logsQuery.isError);
	const skippedCount = $derived(logsQuery.data?.skipped.length ?? 0);

	const rows = $derived(
		summarizeMealCoverage({
			day,
			residents: coverageResidents({
				day,
				evacuees: evacueesQuery.data ?? [],
				movements: movementsQuery.data ?? []
			}),
			logs: logsQuery.data?.items ?? []
		})
	);
	const mealsLabel = (meals: readonly MealPeriod[]) =>
		meals.length ? meals.map((m) => getMealPeriodLabel(m)).join(', ') : '—';
</script>

<section class="space-y-4" aria-labelledby="meal-coverage-title">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h2 id="meal-coverage-title" class="text-base font-bold text-slate-900">
				ผู้พักพิงที่ยังไม่มีบันทึกรับอาหารครบ {MIN_MEALS_PER_DAY} มื้อ
			</h2>
			<p class="text-xs text-slate-500">
				นับมื้อเช้า กลางวัน เย็น จากบันทึกการแจกของผู้ที่อยู่ในศูนย์ตลอดทั้งวัน
				มื้อที่แจกโดยไม่สแกนจะไม่ถูกนับ
			</p>
		</div>
		<label class="flex items-center gap-2 text-xs font-semibold text-slate-600">
			วันที่
			<Input type="date" bind:value={day} max={latestDay} class="h-9 w-40 bg-white" />
		</label>
	</div>

	{#if skippedCount > 0}
		<div
			class="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"
			role="alert"
		>
			<AlertTriangle class="size-4 shrink-0" />
			มีบันทึกการแจก {skippedCount} รายการที่อ่านไม่ได้ จำนวนมื้ออาจต่ำกว่าความจริง
		</div>
	{/if}

	{#if isLoading}
		<div class="flex items-center gap-2 p-6 text-sm text-slate-500">
			<Loader class="size-4 animate-spin" /> กำลังโหลด…
		</div>
	{:else if isError}
		<div class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
			โหลดข้อมูลไม่สำเร็จ ลองรีเฟรชหน้านี้อีกครั้ง
		</div>
	{:else if rows.length === 0}
		<div class="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
			ทุกคนที่อยู่ในศูนย์ตลอดวันมีบันทึกรับอาหารอย่างน้อย {MIN_MEALS_PER_DAY} มื้อ
		</div>
	{:else}
		<p class="text-xs font-semibold text-slate-700">{rows.length} คนยังไม่มีบันทึกรับอาหารครบ</p>
		<div class="overflow-x-auto rounded-lg border border-slate-200 bg-white">
			<table class="w-full text-left text-sm">
				<thead class="bg-slate-50 text-xs text-slate-600">
					<tr>
						<th class="px-3 py-2 font-semibold">ชื่อ</th>
						<th class="px-3 py-2 font-semibold">มื้อที่มีบันทึก</th>
						<th class="px-3 py-2 font-semibold">มื้อที่ยังไม่มีบันทึก</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as row (row.id)}
						<tr class="border-t border-slate-100">
							<td class="px-3 py-2 font-medium text-slate-900">{row.name}</td>
							<td class="px-3 py-2 text-slate-700">{mealsLabel(row.received)}</td>
							<td class="px-3 py-2 text-slate-700">{mealsLabel(row.missing)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>
