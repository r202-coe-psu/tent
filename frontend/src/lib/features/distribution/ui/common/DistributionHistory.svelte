<script lang="ts">
	import History from '@lucide/svelte/icons/history';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import Loader from '@lucide/svelte/icons/loader';
	import { Button } from '$lib/components/ui/button/index.js';
	import { useDistributionLogs } from '../../application/queries';
	import type { DistributionLog, RequisitionTicket } from '../../domain/food-supplies';
	import { getLoanStatusBadge } from '../model/loan-return';
	import RecipientName from './RecipientName.svelte';

	interface Props {
		ticket: RequisitionTicket;
		shelterCode?: string;
	}

	let { ticket, shelterCode }: Props = $props();

	/** Rows shown before "แสดงทั้งหมด". */
	const PAGE = 20;

	let open = $state(false);
	let showAll = $state(false);

	const logsQuery = useDistributionLogs(
		() => ({ ticket_id: ticket._id }),
		() => shelterCode
	);
	const logs = $derived(
		[...(logsQuery.data ?? [])].sort((a, b) => b.distributed_at.localeCompare(a.distributed_at))
	);
	const visibleLogs = $derived(showAll ? logs : logs.slice(0, PAGE));

	function itemName(log: DistributionLog): string {
		return ticket.items.find((i) => i.item_id === log.item_id)?.item_name ?? log.item_id;
	}

	function formatTime(iso: string): string {
		return new Date(iso).toLocaleString('th-TH', {
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

<section class="rounded-2xl border border-slate-200/80 bg-white shadow-2xs">
	<button
		type="button"
		onclick={() => (open = !open)}
		aria-expanded={open}
		class="flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl px-5 py-3 text-left focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none"
	>
		<span class="flex items-center gap-2 text-base font-semibold text-slate-800">
			<History class="size-4 text-slate-500" aria-hidden="true" />
			ประวัติการแจกของตั๋วนี้
			<span
				class="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700 tabular-nums"
			>
				{logs.length}
			</span>
		</span>
		{#if open}
			<ChevronUp class="size-4 text-slate-500" aria-hidden="true" />
		{:else}
			<ChevronDown class="size-4 text-slate-500" aria-hidden="true" />
		{/if}
	</button>

	{#if open}
		<div class="border-t border-slate-100 px-5 py-4">
			{#if logsQuery.isPending}
				<p class="flex items-center gap-2 text-sm text-slate-500">
					<Loader class="size-4 animate-spin" aria-hidden="true" /> กำลังโหลดประวัติ...
				</p>
			{:else if logs.length === 0}
				<p class="text-sm text-slate-500">ยังไม่มีการแจกจากตั๋วนี้</p>
			{:else}
				<ul class="divide-y divide-slate-100">
					{#each visibleLogs as log (log._id)}
						<li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
							<span class="w-28 shrink-0 text-xs text-slate-500 tabular-nums">
								{formatTime(log.distributed_at)}
							</span>
							<span
								class="min-w-0 flex-1 truncate font-medium {log.status === 'voided'
									? 'text-slate-400 line-through'
									: 'text-slate-900'}"
							>
								<RecipientName recipientType={log.recipient_type} recipientId={log.recipient_id} />
							</span>
							<span class="text-slate-700">
								{itemName(log)} × <span class="font-semibold tabular-nums">{log.qty}</span>
							</span>
							<span class="flex flex-wrap gap-1">
								{#if log.status === 'voided'}
									<span
										class="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-600"
										>ยกเลิกแล้ว</span
									>
								{/if}
								{#if log.is_returnable && log.status !== 'voided'}
									{@const badge = getLoanStatusBadge(log)}
									<span
										class="rounded-full border px-2 py-0.5 text-xs font-semibold {badge.badgeClass}"
										>{badge.label}</span
									>
								{/if}
								{#if log.is_override}
									<span
										class="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900"
										title={log.override_reason}>กรณีพิเศษ</span
									>
								{/if}
								{#if log.is_expired_warning}
									<span
										class="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-900"
										>เกินเวลาปลอดภัย</span
									>
								{/if}
							</span>
							{#if log.is_override && log.override_reason}
								<p class="w-full pl-31 text-xs text-slate-500">เหตุผล: {log.override_reason}</p>
							{/if}
						</li>
					{/each}
				</ul>
				{#if logs.length > PAGE}
					<Button
						type="button"
						variant="ghost"
						class="mt-2 min-h-11 w-full text-sm font-semibold"
						onclick={() => (showAll = !showAll)}
					>
						{showAll ? 'แสดงน้อยลง' : `แสดงทั้งหมด (${logs.length})`}
					</Button>
				{/if}
			{/if}
		</div>
	{/if}
</section>
