<script lang="ts">
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Clock from '@lucide/svelte/icons/clock';
	import type { BulkReturnPoolOverviewRow } from '../../domain/food-supplies';
	import { LATE_BADGE_CLASS } from '../model/bulk-return-pool-v3';
	import {
		WORK_QUEUE_COPY,
		flaggedPools,
		formatWaitingAge,
		waitingForReceive,
		type WorkQueueKind
	} from '../model/bulk-return-work-queue';

	/** Compact work queues above the bulk return pool board (#660). */
	interface Props {
		rows: readonly BulkReturnPoolOverviewRow[];
		queues: readonly WorkQueueKind[];
		now: Date;
		onOpenPool: (poolId: string) => void;
	}

	let { rows, queues, now, onOpenPool }: Props = $props();

	const waiting = $derived(queues.includes('waiting_receive') ? waitingForReceive(rows, now) : []);
	const flagged = $derived(queues.includes('flagged') ? flaggedPools(rows) : []);

	const rowClass =
		'flex min-h-11 w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none';
</script>

{#if queues.length > 0}
	<div class="grid grid-cols-1 gap-3 lg:grid-cols-2" data-testid="bulk-return-work-queues">
		{#if queues.includes('waiting_receive')}
			<section
				class="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3"
				aria-labelledby="bulk-queue-waiting"
			>
				<h3
					id="bulk-queue-waiting"
					class="flex items-center gap-2 text-sm font-bold text-slate-900"
				>
					<Clock class="h-4 w-4 text-slate-500" aria-hidden="true" />
					{WORK_QUEUE_COPY.waitingTitle}
					<span class="tabular-nums">{waiting.length}</span>
				</h3>
				{#if waiting.length === 0}
					<p class="text-sm text-slate-500">{WORK_QUEUE_COPY.waitingEmpty}</p>
				{:else}
					<ul class="space-y-1.5">
						{#each waiting as item (item.row.pool._id)}
							<li>
								<button
									type="button"
									onclick={() => onOpenPool(item.row.pool._id)}
									class="{rowClass} border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
								>
									<span class="font-semibold break-words text-slate-900">{item.row.pool.name}</span>
									<span class="text-xs text-slate-600">
										{WORK_QUEUE_COPY.agePrefix}
										<span class="font-semibold tabular-nums">{formatWaitingAge(item.ageMs)}</span>
									</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/if}

		{#if queues.includes('flagged')}
			<section
				class="space-y-2 rounded-xl border border-amber-200 bg-amber-50/50 p-3"
				aria-labelledby="bulk-queue-flagged"
			>
				<h3
					id="bulk-queue-flagged"
					class="flex items-center gap-2 text-sm font-bold text-amber-900"
				>
					<AlertTriangle class="h-4 w-4 text-amber-600" aria-hidden="true" />
					{WORK_QUEUE_COPY.flaggedTitle}
					<span class="tabular-nums">{flagged.length}</span>
				</h3>
				{#if flagged.length === 0}
					<p class="text-sm text-slate-500">{WORK_QUEUE_COPY.flaggedEmpty}</p>
				{:else}
					<ul class="space-y-1.5">
						{#each flagged as item (item.row.pool._id)}
							<li>
								<button
									type="button"
									onclick={() => onOpenPool(item.row.pool._id)}
									class="{rowClass} border-amber-200 bg-white hover:bg-amber-50"
								>
									<span class="font-semibold break-words text-slate-900">{item.row.pool.name}</span>
									<span class="flex flex-wrap items-center gap-1.5">
										{#each item.reasons as r (r.reason)}
											<span
												class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold {LATE_BADGE_CLASS}"
											>
												{WORK_QUEUE_COPY.reasonLabels[r.reason]}
												<span class="ml-1 tabular-nums">{r.count}</span>
											</span>
										{/each}
									</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/if}
	</div>
{/if}
