<script lang="ts">
	import History from '@lucide/svelte/icons/history';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import Loader from '@lucide/svelte/icons/loader';
	import Search from '@lucide/svelte/icons/search';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { useEvacueeNames } from '$lib/features/people';
	import { useVolunteerNames } from '$lib/features/volunteers';
	import { useDistributionLogs } from '../../application/queries';
	import type { DistributionLog, RequisitionTicket } from '../../domain/food-supplies';
	import {
		HISTORY_FILTER_ORDER,
		HISTORY_FILTERS,
		HISTORY_PAGE_SIZE,
		filterHistory,
		historyRecipientIds,
		historyRecipientNames,
		summarizeHistory,
		type HistoryFilter
	} from '../model/distribution-history';
	import { getLoanStatusBadge } from '../model/loan-return';

	interface Props {
		ticket: RequisitionTicket;
		shelterCode?: string;
	}

	let { ticket, shelterCode }: Props = $props();

	let open = $state(false);
	let filter = $state<HistoryFilter>('all');
	let query = $state('');
	let visibleCount = $state(HISTORY_PAGE_SIZE);

	const logsQuery = useDistributionLogs(
		() => ({ ticket_id: ticket._id }),
		() => shelterCode
	);
	const logs = $derived(logsQuery.data ?? []);

	// Empty id lists disable the name queries, so nothing is fetched while the panel is closed.
	const recipientIds = $derived(
		open ? historyRecipientIds(logs) : { evacueeIds: [], volunteerIds: [] }
	);
	const evacueeNamesQuery = useEvacueeNames(
		() => recipientIds.evacueeIds,
		() => shelterCode
	);
	const volunteerNamesQuery = useVolunteerNames(
		() => recipientIds.volunteerIds,
		() => shelterCode
	);
	const names = $derived(
		historyRecipientNames([...(evacueeNamesQuery.data ?? []), ...(volunteerNamesQuery.data ?? [])])
	);

	const summary = $derived(summarizeHistory(logs));
	const matches = $derived(filterHistory(logs, { filter, query, names }));
	const visibleLogs = $derived(matches.slice(0, visibleCount));
	const remaining = $derived(matches.length - visibleLogs.length);
	const chips = $derived(
		HISTORY_FILTER_ORDER.filter((key) => key === 'all' || summary.counts[key] > 0)
	);

	function selectFilter(next: HistoryFilter) {
		filter = next;
		visibleCount = HISTORY_PAGE_SIZE;
	}

	let section: HTMLElement | undefined = $state();

	// Shrinking the list would leave the viewport below the panel, so bring its header back.
	function showLess() {
		visibleCount = HISTORY_PAGE_SIZE;
		section?.scrollIntoView({ block: 'start', behavior: 'smooth' });
	}

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

	// Nearly every row is an evacuee, so only the exceptions get a type badge.
	const RECIPIENT_TYPE_BADGE: Record<
		Exclude<DistributionLog['recipient_type'], 'evacuee'>,
		{ label: string; className: string }
	> = {
		volunteer: { label: 'จิตอาสา', className: 'border-violet-200 bg-violet-50 text-violet-800' },
		outside: { label: 'บุคคลภายนอก', className: 'border-slate-200 bg-slate-50 text-slate-700' }
	};
</script>

<section
	bind:this={section}
	class="scroll-mt-4 rounded-2xl border border-slate-200/80 bg-white shadow-2xs"
>
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
				<p class="text-sm font-medium text-slate-700">
					แจกแล้ว {summary.rows} ครั้ง · {summary.people} คน
				</p>
				<div class="mt-3 flex flex-wrap gap-2">
					{#each chips as key (key)}
						<button
							type="button"
							aria-pressed={filter === key}
							onclick={() => selectFilter(key)}
							class="min-h-9 rounded-full border px-3 text-xs font-semibold focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none {filter ===
							key
								? 'border-slate-900 bg-slate-900 text-white'
								: 'border-slate-200 bg-white text-slate-700'}"
							>{HISTORY_FILTERS[key].label}
							<span class="tabular-nums">{summary.counts[key]}</span></button
						>
					{/each}
				</div>
				<div class="relative mt-3">
					<Search
						class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
						aria-hidden="true"
					/>
					<Input
						type="search"
						bind:value={query}
						oninput={() => (visibleCount = HISTORY_PAGE_SIZE)}
						placeholder="ค้นหาชื่อผู้รับ หรือเหตุผล"
						aria-label="ค้นหาประวัติการแจก"
						class="min-h-11 pl-9"
					/>
				</div>
				{#if matches.length === 0}
					<p class="mt-4 text-sm text-slate-500">ไม่พบรายการที่ตรงกับการค้นหา</p>
				{/if}
				<ul class="mt-2 divide-y divide-slate-100">
					{#each visibleLogs as log (log._id)}
						{@const name = log.recipient_id ? names.get(log.recipient_id) : undefined}
						<li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
							<span class="text-xs text-slate-500 tabular-nums sm:w-28 sm:shrink-0">
								{formatTime(log.distributed_at)}
							</span>
							<!-- On a phone the name gets its own first line; the time and item wrap below it. -->
							<span
								class="order-first flex min-w-0 basis-full items-center gap-2 sm:order-none sm:flex-1 sm:basis-auto"
							>
								{#if log.recipient_type !== 'evacuee'}
									{@const typeBadge = RECIPIENT_TYPE_BADGE[log.recipient_type]}
									<span
										class="shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold {typeBadge.className}"
										>{typeBadge.label}</span
									>
								{/if}
								<span
									class="min-w-0 font-medium break-words sm:truncate {log.status === 'voided'
										? 'text-slate-400 line-through'
										: 'text-slate-900'}"
								>
									{#if log.recipient_type === 'outside'}
										<span class="text-slate-500">ไม่ระบุตัวตน</span>
									{:else if name}
										{name}
									{:else}
										<span class="text-slate-400">{log.recipient_id ?? '—'}</span>
									{/if}
								</span>
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
								<p class="w-full text-xs text-slate-500 sm:pl-31">เหตุผล: {log.override_reason}</p>
							{/if}
						</li>
					{/each}
				</ul>
				{#if remaining > 0 || visibleCount > HISTORY_PAGE_SIZE}
					<div class="mt-2 flex flex-col gap-2 sm:flex-row">
						{#if remaining > 0}
							<Button
								type="button"
								variant="ghost"
								class="min-h-11 flex-1 text-sm font-semibold"
								onclick={() => (visibleCount += HISTORY_PAGE_SIZE)}
							>
								แสดงเพิ่มอีก {Math.min(HISTORY_PAGE_SIZE, remaining)} รายการ (เหลือ {remaining})
							</Button>
						{/if}
						{#if visibleCount > HISTORY_PAGE_SIZE}
							<Button
								type="button"
								variant="ghost"
								class="min-h-11 flex-1 text-sm font-semibold text-slate-600"
								onclick={showLess}
							>
								แสดงน้อยลง
							</Button>
						{/if}
					</div>
				{/if}
			{/if}
		</div>
	{/if}
</section>
