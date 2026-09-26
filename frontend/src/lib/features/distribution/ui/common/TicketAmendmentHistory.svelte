<script lang="ts">
	import { buildAmendmentHistoryRows } from '../model/ticket-amendment-history';
	import type { TicketAmendment } from '../../domain/food-supplies';
	import History from '@lucide/svelte/icons/history';

	interface Props {
		amendments: readonly TicketAmendment[] | undefined;
		items: readonly { item_id: string; item_name: string }[];
		class?: string;
	}

	let { amendments, items, class: className = '' }: Props = $props();

	const rows = $derived(buildAmendmentHistoryRows(amendments, items));

	function formatDateTime(isoString: string): string {
		try {
			return new Intl.DateTimeFormat('th-TH', {
				year: 'numeric',
				month: 'short',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit'
			}).format(new Date(isoString));
		} catch {
			return isoString;
		}
	}
</script>

{#if rows.length > 0}
	<div class="rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs sm:p-5 {className}">
		<div class="flex items-center gap-2 border-b border-slate-100 pb-2.5">
			<History class="h-4 w-4 text-slate-500" aria-hidden="true" />
			<h4 class="text-sm font-bold text-slate-900">ประวัติการแก้ไขใบเบิกจ่าย</h4>
		</div>

		<div class="mt-3 space-y-2.5">
			{#each rows as row (row.amendmentId)}
				<div class="rounded-lg border border-slate-200/80 bg-slate-50/60 p-3">
					<div class="flex items-center justify-between gap-2">
						<p class="text-xs font-bold text-slate-900">{row.itemName}</p>
						<span
							class="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-2xs font-bold text-indigo-900 tabular-nums"
						>
							+{row.addedQty}
						</span>
					</div>

					{#if row.reason}
						<p class="mt-1.5 text-xs text-slate-600">เหตุผล: {row.reason}</p>
					{/if}

					<p class="mt-1.5 text-2xs text-slate-500">
						แก้ไขโดย: <span class="font-semibold text-slate-700">{row.amendedBy}</span>
						<span class="text-slate-300">•</span>
						<span class="tabular-nums">{formatDateTime(row.amendedAt)}</span>
					</p>
				</div>
			{/each}
		</div>
	</div>
{/if}
