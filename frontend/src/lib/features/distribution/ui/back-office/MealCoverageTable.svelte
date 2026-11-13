<script lang="ts">
	import PaginationControls from '$lib/components/pagination-controls.svelte';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { MealPeriod } from '../../domain/food-supplies';
	import { distributedByLabel } from '../model/meal-coverage-csv';
	import type { CoverageViewRow, pageSlice } from '../model/meal-coverage-view';
	import MealCoverageBadges from './MealCoverageBadges.svelte';
	import MealCoverageStatusBadge from './MealCoverageStatusBadge.svelte';

	interface Props {
		paged: ReturnType<typeof pageSlice<CoverageViewRow>>;
		total: number;
		pageSize: number;
		servedMeals: readonly MealPeriod[];
		/** Records a person needs to be complete: shown as the target in each status. */
		threshold: number;
		zoneName: (code: string | null) => string;
		onOpenPerson?: (id: string) => void;
		onPageChange: (page: number) => void;
	}

	let {
		paged,
		total,
		pageSize,
		servedMeals,
		threshold,
		zoneName,
		onOpenPerson,
		onPageChange
	}: Props = $props();
</script>

{#snippet personName(row: CoverageViewRow)}
	{#if onOpenPerson}
		<button
			type="button"
			class="cursor-pointer rounded-sm text-left underline decoration-slate-300 underline-offset-4 hover:decoration-slate-900 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
			onclick={() => onOpenPerson(row.id)}
		>
			{row.name}
		</button>
	{:else}
		{row.name}
	{/if}
{/snippet}

<!-- Below a laptop width: one card per person; five table columns need the room. -->
<ul class="space-y-3 p-3 lg:hidden">
	{#each paged.items as row (row.id)}
		<li
			class="space-y-3 rounded-xl border p-4 shadow-2xs {row.complete
				? 'border-slate-200/80 bg-white'
				: 'border-amber-200 bg-amber-50/40'}"
		>
			<div class="flex items-start justify-between gap-2">
				<div class="min-w-0">
					<p class="text-base font-bold text-slate-900">{@render personName(row)}</p>
					<p class="mt-0.5 text-sm text-slate-500">{zoneName(row.zone) || '–'}</p>
				</div>
				<MealCoverageStatusBadge {row} {threshold} />
			</div>
			<MealCoverageBadges
				received={row.received}
				{servedMeals}
				householdRecorded={row.householdRecorded}
			/>
			<p class="text-sm text-slate-600">ผู้แจก: {distributedByLabel(row)}</p>
		</li>
	{/each}
</ul>

<div class="hidden overflow-x-auto lg:block">
	<Table.Root class="w-full text-left text-sm text-slate-700">
		<Table.Caption class="sr-only">รายชื่อผู้พักพิงและบันทึกรับอาหาร</Table.Caption>
		<Table.Header class="border-b border-slate-200 bg-slate-50/75 text-xs text-slate-600">
			<Table.Row>
				<Table.Head scope="col" class="px-4 py-3 font-semibold">ชื่อ</Table.Head>
				<Table.Head scope="col" class="px-3 py-3 font-semibold">โซน</Table.Head>
				<Table.Head scope="col" class="px-3 py-3 font-semibold">มื้ออาหาร</Table.Head>
				<Table.Head scope="col" class="px-3 py-3 font-semibold">ผู้แจก</Table.Head>
				<Table.Head scope="col" class="px-3 py-3 font-semibold">สถานะ</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body class="divide-y divide-slate-100">
			{#each paged.items as row (row.id)}
				<Table.Row
					class={row.complete ? 'hover:bg-slate-50/80' : 'bg-amber-50/40 hover:bg-amber-50/70'}
				>
					<Table.Cell class="px-4 py-3 font-medium text-slate-900">
						{@render personName(row)}
					</Table.Cell>
					<Table.Cell class="px-3 py-3 text-slate-600">{zoneName(row.zone)}</Table.Cell>
					<Table.Cell class="px-3 py-3">
						<MealCoverageBadges
							received={row.received}
							{servedMeals}
							householdRecorded={row.householdRecorded}
						/>
					</Table.Cell>
					<Table.Cell class="px-3 py-3 text-slate-600">{distributedByLabel(row)}</Table.Cell>
					<Table.Cell class="px-3 py-3 whitespace-nowrap">
						<MealCoverageStatusBadge {row} {threshold} />
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
