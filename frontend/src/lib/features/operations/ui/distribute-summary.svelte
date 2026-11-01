<script lang="ts">
	import CheckCircle2 from '@lucide/svelte/icons/circle-check';
	import type { BatchSummary } from '../domain/distribute-batch';
	import { qtyGt, subQty } from '$lib/utils/qty';
	import { isLotExpired, lotExpiryLabel, type LotPriorityItem } from '../domain/lot-priority';
	import { lotDisplayName, type StoragePointRef } from '../domain/lot-storage';
	import type { BatchReportLabels } from './distribute-result';

	/**
	 * Every line of the batch on one card (#837 review): what is issued, how much, from which
	 * lots, each lot's expiry and what it keeps — the whole requisition checked before saving.
	 */
	let {
		summary,
		labels,
		unitLabel,
		storagePoints,
		priorityItems
	}: {
		summary: BatchSummary;
		labels: BatchReportLabels;
		unitLabel: (code: string) => string;
		storagePoints: readonly StoragePointRef[];
		priorityItems: ReadonlyMap<string, LotPriorityItem>;
	} = $props();
</script>

<section
	class="space-y-3 rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs"
	aria-labelledby="distribute-summary-title"
>
	<div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
		<h3 id="distribute-summary-title" class="text-base font-semibold text-slate-800">
			สรุปการเบิก
		</h3>
		{#if summary.readyCount > 0}
			<p class="text-sm font-medium text-slate-600 tabular-nums">
				{summary.readyCount} รายการ · {summary.rowCount} แถวในบัญชีสต็อก
			</p>
		{/if}
	</div>

	{#if summary.entries.length === 0}
		<p class="text-sm text-slate-500">
			เลือกสินค้าและใส่จำนวนให้ครบ แล้วสรุปการตัดล็อตจะแสดงที่นี่
		</p>
	{:else}
		<ul class="divide-y divide-slate-200 rounded-lg border border-slate-200" aria-live="polite">
			{#each summary.entries as entry (entry.key)}
				{@const baseUnit = labels.baseUnitLabel(entry.item_id)}
				<li class="space-y-2 px-3 py-3">
					<div class="flex items-start justify-between gap-3">
						<p class="min-w-0 text-sm font-semibold break-words text-slate-900">
							{labels.itemName(entry.item_id)}
						</p>
						{#if entry.kind === 'ready'}
							{@const typedUnit = unitLabel(entry.unit)}
							<p class="shrink-0 text-right text-sm font-bold text-slate-900 tabular-nums">
								−{entry.qty}
								{typedUnit}
								{#if typedUnit !== baseUnit}
									<span class="block text-xs font-medium text-slate-500">
										= {entry.baseQty}
										{baseUnit}
									</span>
								{/if}
							</p>
						{:else}
							<span
								class="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-900"
							>
								<CheckCircle2 class="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
								บันทึกแล้ว <span class="tabular-nums">{entry.landed} {baseUnit}</span>
							</span>
						{/if}
					</div>
					{#if entry.kind === 'ready'}
						<ul class="space-y-1">
							{#each entry.allocations as allocation (allocation.lot_ref)}
								{@const item = priorityItems.get(allocation.lot.item_id)}
								{@const expired = isLotExpired(allocation.lot, Date.now(), item)}
								<li class="space-y-0.5 rounded-lg bg-slate-50 px-3 py-2">
									<div class="flex items-start justify-between gap-3 text-sm text-slate-800">
										<span class="min-w-0 font-medium break-words">
											{lotDisplayName(allocation.lot.lot, storagePoints)}
										</span>
										<span class="shrink-0 font-semibold tabular-nums">
											−{allocation.qty}
											{baseUnit}
										</span>
									</div>
									<p class="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-600 tabular-nums">
										<span class={expired ? 'font-semibold text-red-700' : undefined}>
											{lotExpiryLabel(allocation.lot, item, Date.now())}
										</span>
										<span>
											คงเหลือ {allocation.lot.qty} →
											<span class="whitespace-nowrap">
												{subQty(allocation.lot.qty, allocation.qty)}
												{baseUnit}
											</span>
										</span>
									</p>
								</li>
							{/each}
						</ul>
						{#if qtyGt(entry.landed, 0)}
							<p class="text-xs font-medium text-emerald-800 tabular-nums">
								บันทึกไปแล้ว {entry.landed}
								{baseUnit} ในใบเบิกนี้
							</p>
						{/if}
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>
