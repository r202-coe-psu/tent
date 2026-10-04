<script lang="ts">
	import { useDistributionLogs } from '../../application/queries';
	import { summarizeTicketLoans } from '../model/loan-return';
	import { qtyGt } from '$lib/utils/qty';
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import Undo2 from '@lucide/svelte/icons/undo-2';

	interface Props {
		ticketId: string;
		items: readonly { item_id: string; item_name: string }[];
		shelterCode?: string;
		class?: string;
	}

	let { ticketId, items, shelterCode, class: className = '' }: Props = $props();

	const logsQuery = useDistributionLogs(
		() => ({ ticket_id: ticketId, is_returnable: true }),
		() => shelterCode,
		() => Boolean(ticketId)
	);

	const summary = $derived(summarizeTicketLoans(ticketId, logsQuery.data ?? []));
	const hasLoans = $derived(summary.items.length > 0);
	const hasOutstanding = $derived(qtyGt(summary.outstandingQty, '0'));

	function itemName(itemId: string): string {
		return items.find((i) => i.item_id === itemId)?.item_name ?? itemId;
	}
</script>

{#if hasLoans}
	<div class="rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs sm:p-5 {className}">
		<div class="flex items-center justify-between border-b border-slate-100 pb-2.5">
			<h4 class="text-sm font-bold text-slate-900">สถานะของยืม-คืน</h4>
			{#if hasOutstanding}
				<span
					class="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-2xs font-bold text-amber-900"
				>
					<Undo2 class="h-3 w-3" aria-hidden="true" />
					ยังมีของค้างคืน
				</span>
			{:else}
				<span
					class="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-2xs font-bold text-emerald-900"
				>
					<PackageCheck class="h-3 w-3" aria-hidden="true" />
					ของยืมคืนครบแล้ว
				</span>
			{/if}
		</div>

		<p class="mt-2 text-2xs text-slate-500">
			รอบแจกจ่ายของตั๋วนี้เสร็จสิ้นแล้ว แต่พัสดุยืม-คืนติดตามแยกจากสถานะตั๋ว —
			ระบบจะติดตามการคืนต่อที่นี่จนกว่าจะครบ
		</p>

		<div class="mt-3 space-y-2.5">
			{#each summary.items as item (item.itemId)}
				{@const itemHasOutstanding = qtyGt(item.outstandingQty, '0')}
				<div class="rounded-lg border border-slate-200/80 bg-slate-50/60 p-3">
					<p class="text-xs font-bold text-slate-900">{itemName(item.itemId)}</p>
					<div class="mt-1.5 grid grid-cols-3 gap-2 text-center">
						<div>
							<p class="text-3xs font-semibold tracking-wide text-slate-500 uppercase">
								ให้ยืมแล้ว
							</p>
							<p class="text-sm font-bold text-slate-800 tabular-nums">{item.loanedQty}</p>
						</div>
						<div>
							<p class="text-3xs font-semibold tracking-wide text-slate-500 uppercase">คืนแล้ว</p>
							<p class="text-sm font-bold text-emerald-700 tabular-nums">{item.returnedQty}</p>
						</div>
						<div class="rounded-md {itemHasOutstanding ? 'bg-amber-100/60' : ''}">
							<p
								class="text-3xs font-bold tracking-wide uppercase {itemHasOutstanding
									? 'text-amber-800'
									: 'text-slate-500'}"
							>
								ยังไม่คืน
							</p>
							<p
								class="text-sm font-extrabold tabular-nums {itemHasOutstanding
									? 'text-amber-900'
									: 'text-slate-700'}"
							>
								{item.outstandingQty}
							</p>
						</div>
					</div>
				</div>
			{/each}
		</div>
	</div>
{/if}
