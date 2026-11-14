<script lang="ts">
	import HandHeart from '@lucide/svelte/icons/hand-heart';
	import * as Card from '$lib/components/ui/card/index.js';
	import type { DistributorPortions } from '../../domain/food-supplies/meal-coverage';
	import { distributorName } from '../model/meal-coverage-csv';

	interface Props {
		distributors: readonly DistributorPortions[];
	}

	let { distributors }: Props = $props();

	const TOP = 5;
	const shown = $derived(distributors.slice(0, TOP));
	const rest = $derived(distributors.slice(TOP));
	const max = $derived(Math.max(1, ...distributors.map((d) => d.portions)));
	const restPortions = $derived(rest.reduce((sum, d) => sum + d.portions, 0));
</script>

<Card.Root class="h-full gap-4 rounded-xl border-slate-200/80 bg-white py-4 shadow-2xs sm:py-5">
	<Card.Header class="px-4 sm:px-5">
		<Card.Title class="flex items-center gap-2 text-base font-semibold text-slate-900">
			<HandHeart class="size-4 text-primary" aria-hidden="true" />
			ผู้แจกอาหาร
		</Card.Title>
		<Card.Description class="text-sm text-slate-500">
			จำนวนชุดที่แต่ละคนบันทึกแจกในวันที่เลือก
		</Card.Description>
	</Card.Header>
	<Card.Content class="px-4 sm:px-5">
		{#if distributors.length === 0}
			<p class="text-sm text-slate-500">ยังไม่มีบันทึกการแจกของวันนี้</p>
		{:else}
			<ol class="space-y-3">
				{#each shown as d, i (d.by)}
					<li class="space-y-1">
						<div class="flex items-center justify-between gap-2 text-sm">
							<span class="flex min-w-0 items-center gap-2">
								<span
									class="flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 tabular-nums"
								>
									{i + 1}
								</span>
								<span class="truncate font-medium text-slate-900">{distributorName(d.by)}</span>
							</span>
							<span class="shrink-0 font-semibold text-slate-900 tabular-nums">
								{d.portions} <span class="font-normal text-slate-500">ชุด</span>
							</span>
						</div>
						<div class="h-2 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
							<div
								class="h-full rounded-full bg-[#0284C7]"
								style="width: {(d.portions / max) * 100}%"
							></div>
						</div>
					</li>
				{/each}
			</ol>
			{#if rest.length > 0}
				<p class="mt-3 text-sm text-slate-500 tabular-nums">
					และอีก {rest.length} คน รวม {restPortions} ชุด
				</p>
			{/if}
		{/if}
	</Card.Content>
</Card.Root>
