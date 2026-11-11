<script lang="ts">
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import PaginationControls from '$lib/components/pagination-controls.svelte';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { MealPeriod } from '../../domain/food-supplies';
	import { coverageStatusLabel } from '../model/meal-coverage-csv';
	import type { CoverageViewRow, pageSlice } from '../model/meal-coverage-view';
	import MealCoverageBadges from './MealCoverageBadges.svelte';

	interface Props {
		paged: ReturnType<typeof pageSlice<CoverageViewRow>>;
		total: number;
		pageSize: number;
		servedMeals: readonly MealPeriod[];
		zoneName: (code: string | null) => string;
		onPageChange: (page: number) => void;
	}

	let { paged, total, pageSize, servedMeals, zoneName, onPageChange }: Props = $props();
</script>

<div class="overflow-x-auto">
	<Table.Root class="w-full text-left text-sm text-slate-700">
		<Table.Caption class="sr-only">รายชื่อผู้พักพิงที่ยังไม่มีบันทึกรับอาหารครบ</Table.Caption>
		<Table.Header class="border-b border-slate-200 bg-slate-50/75 text-xs text-slate-600">
			<Table.Row>
				<Table.Head scope="col" class="px-4 py-3 font-semibold">ชื่อ</Table.Head>
				<Table.Head scope="col" class="px-3 py-3 font-semibold">โซน</Table.Head>
				<Table.Head scope="col" class="px-3 py-3 font-semibold">มื้ออาหาร</Table.Head>
				<Table.Head scope="col" class="px-3 py-3 font-semibold">สถานะ</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body class="divide-y divide-slate-100">
			{#each paged.items as row (row.id)}
				<Table.Row class="hover:bg-slate-50/80">
					<Table.Cell class="px-4 py-3 font-medium text-slate-900">{row.name}</Table.Cell>
					<Table.Cell class="px-3 py-3 text-slate-600">{zoneName(row.zone)}</Table.Cell>
					<Table.Cell class="px-3 py-3">
						<MealCoverageBadges
							received={row.received}
							{servedMeals}
							householdRecorded={row.householdRecorded}
						/>
					</Table.Cell>
					<Table.Cell class="px-3 py-3 whitespace-nowrap">
						{#if row.received.length === 0}
							<span
								class="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-900"
							>
								<CircleAlert class="size-3.5" aria-hidden="true" />
								{coverageStatusLabel(row)}
							</span>
						{:else}
							<span
								class="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-900"
							>
								<TriangleAlert class="size-3.5" aria-hidden="true" />
								{coverageStatusLabel(row)}
							</span>
						{/if}
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
</div>
<div
	class="flex flex-col items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 sm:flex-row"
>
	<p class="text-sm text-slate-500">
		แสดง <span class="font-semibold text-slate-800 tabular-nums">{paged.start}–{paged.end}</span>
		จาก <span class="font-semibold text-slate-800 tabular-nums">{total}</span> คน
	</p>
	<PaginationControls bind:page={() => paged.page, onPageChange} count={total} perPage={pageSize} />
</div>
