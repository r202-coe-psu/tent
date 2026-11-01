<script lang="ts">
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import History from '@lucide/svelte/icons/history';
	import { formatThaiDateTime } from '$lib/utils/date';
	import type { PoolTimelineEvent, PoolTimelineEventKind } from '../../domain/food-supplies';
	import {
		getPoolStatusBadgeClass,
		resolveItemDisplay,
		returnerDisplayName,
		type PoolCatalogItem
	} from '../model/bulk-return-pool-v3';
	import {
		formatSkippedDocIds,
		isTimelineSkippedCoveredByShelter
	} from '../model/bulk-return-skipped-docs';
	import {
		POOL_TIMELINE_SKIPPED_BADGE_SR_HINT,
		POOL_TIMELINE_SKIPPED_NOTICE_PREFIX,
		POOL_TIMELINE_SKIPPED_NOTICE_SUFFIX,
		poolTimelineEmptyLabel,
		poolTimelineSkippedBadge,
		TIMELINE_NO_EFFECT_BADGE_CLASS,
		TIMELINE_NO_EFFECT_LABEL
	} from '../model/bulk-return-timeline-copy';

	interface Props {
		/** Timeline events, oldest first (undefined while loading). */
		events: readonly PoolTimelineEvent[] | undefined;
		catalog: readonly PoolCatalogItem[];
		returnerNames?: ReadonlyMap<string, string>;
		/** Pool id -> pool name for the moved in / out labels. */
		poolNameById: ReadonlyMap<string, string>;
		isLoading?: boolean;
		isError?: boolean;
		/** Malformed event docs of this pool the read left out (the timeline may be incomplete). */
		skipped?: readonly { _id: string }[];
		/**
		 * Shelter-level skipped docs already listed on this page (undefined until loaded); the
		 * timeline banner is hidden when it covers every timeline skipped id.
		 */
		shelterSkipped?: readonly { _id: string }[];
	}

	let {
		events,
		catalog,
		returnerNames,
		poolNameById,
		isLoading = false,
		isError = false,
		skipped = [],
		shelterSkipped
	}: Props = $props();

	let open = $state(false);

	const skippedCount = $derived(skipped.length);
	const skippedIds = $derived(formatSkippedDocIds(skipped));
	const showSkipped = $derived(!isLoading && !isError && skippedCount > 0);
	// Badge stays; the banner is dropped when the shelter-level banner already lists every id.
	const showSkippedBanner = $derived(
		showSkipped && !isTimelineSkippedCoveredByShelter(skipped, shelterSkipped)
	);

	const KIND_LABELS: Record<PoolTimelineEventKind, string> = {
		opened: 'เปิดกอง',
		entry_added: 'รับของเข้ากอง',
		moved_in: 'ย้ายเข้ามาจากกอง',
		moved_out: 'ย้ายออกไปกอง',
		voided: 'ยกเลิกรายการ',
		loan_reopened: 'เปิดยอดยืมกลับ',
		submitted: 'ส่งเข้าคลัง',
		received: 'ตรวจรับเข้าคลัง',
		cancelled: 'ยกเลิกกอง'
	};

	// สีของแต่ละเหตุการณ์ — เหตุการณ์สถานะกองใช้สีเดียวกับป้ายสถานะ, เหตุการณ์รายการใช้สีของตัวเอง
	const KIND_TONES: Record<PoolTimelineEventKind, { badge: string; dot: string }> = {
		opened: { badge: getPoolStatusBadgeClass('OPEN'), dot: 'bg-emerald-500' },
		entry_added: { badge: 'border border-teal-200 bg-teal-50 text-teal-900', dot: 'bg-teal-500' },
		moved_in: {
			badge: 'border border-violet-200 bg-violet-50 text-violet-900',
			dot: 'bg-violet-500'
		},
		moved_out: {
			badge: 'border border-violet-200 bg-violet-50 text-violet-900',
			dot: 'bg-violet-500'
		},
		voided: { badge: 'border border-red-200 bg-red-50 text-red-800', dot: 'bg-red-500' },
		loan_reopened: { badge: 'border border-rose-200 bg-rose-50 text-rose-800', dot: 'bg-rose-500' },
		submitted: { badge: getPoolStatusBadgeClass('SUBMITTED'), dot: 'bg-sky-500' },
		received: { badge: getPoolStatusBadgeClass('RECEIVED'), dot: 'bg-slate-700' },
		cancelled: {
			badge: getPoolStatusBadgeClass('CANCELLED'),
			dot: 'bg-white ring-2 ring-slate-400 ring-inset'
		}
	};

	function labelOf(event: PoolTimelineEvent): string {
		const base = KIND_LABELS[event.kind];
		if (event.kind !== 'moved_in' && event.kind !== 'moved_out') return base;
		const other = event.other_pool_id;
		return `${base} ${other ? (poolNameById.get(other) ?? other) : ''}`.trim();
	}

	function returnerOf(event: PoolTimelineEvent): string | null {
		if (!event.returner_type) return null;
		return returnerDisplayName(
			{ returner_type: event.returner_type, returner_id: event.returner_id ?? null },
			returnerNames
		);
	}
</script>

<section aria-labelledby="pool-timeline-heading" class="space-y-2">
	<h3 id="pool-timeline-heading" class="text-base font-semibold text-slate-800">
		<button
			type="button"
			class="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg text-left"
			aria-expanded={open}
			onclick={() => (open = !open)}
		>
			<span class="flex items-center gap-2">
				<History class="h-4 w-4" aria-hidden="true" />
				ประวัติของกอง
				<span class="text-sm font-normal text-slate-500 tabular-nums">
					({events?.length ?? 0})
				</span>
				{#if showSkipped}
					<span
						data-testid="bulk-return-timeline-skipped-badge"
						class="inline-flex items-center gap-1"
					>
						<AlertTriangle class="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />
						<span class="text-xs font-medium text-amber-800 tabular-nums">
							{poolTimelineSkippedBadge(skippedCount)}
						</span>
						<span class="sr-only">{POOL_TIMELINE_SKIPPED_BADGE_SR_HINT}</span>
					</span>
				{/if}
			</span>
			<ChevronDown
				class="h-4 w-4 shrink-0 text-slate-500 transition-transform {open ? 'rotate-180' : ''}"
				aria-hidden="true"
			/>
		</button>
	</h3>

	{#if open}
		<div id="pool-timeline-list" class="space-y-2">
			{#if showSkippedBanner}
				<div
					role="status"
					data-testid="bulk-return-timeline-skipped-docs"
					class="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-900"
				>
					<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
					<p class="min-w-0 [overflow-wrap:anywhere]">
						{POOL_TIMELINE_SKIPPED_NOTICE_PREFIX}
						<span class="tabular-nums">{skippedCount}</span>
						{POOL_TIMELINE_SKIPPED_NOTICE_SUFFIX}
						{#if skippedIds}({skippedIds}){/if}
					</p>
				</div>
			{/if}
			{#if isLoading}
				<p role="status" class="text-sm text-slate-600">กำลังโหลดประวัติของกอง…</p>
			{:else if isError}
				<p role="status" class="text-sm text-red-700">โหลดประวัติของกองไม่สำเร็จ</p>
			{:else if !events || events.length === 0}
				<!-- Defensive: the production timeline always has an `opened` event. -->
				<p role="status" class="text-sm text-slate-600">{poolTimelineEmptyLabel(skippedCount)}</p>
			{:else}
				<ol class="space-y-0 border-l-2 border-slate-200 pl-4">
					{#each events as event (event.kind + ':' + event.id)}
						{@const item = event.item_id ? resolveItemDisplay(event.item_id, catalog) : null}
						{@const returner = returnerOf(event)}
						<li class="relative space-y-0.5 pb-4 text-sm last:pb-0">
							<span
								class="absolute top-1.5 -left-[1.4rem] h-2.5 w-2.5 rounded-full {KIND_TONES[
									event.kind
								].dot}"
								aria-hidden="true"
							></span>
							<p>
								<span
									class="inline-flex max-w-full items-center rounded-full px-2.5 py-0.5 text-xs font-semibold break-words {KIND_TONES[
										event.kind
									].badge}"
								>
									{labelOf(event)}
								</span>
								{#if event.no_effect}
									<span
										class="ml-1 inline-flex max-w-full items-center rounded-full px-2.5 py-0.5 text-xs font-semibold break-words {TIMELINE_NO_EFFECT_BADGE_CLASS}"
									>
										{TIMELINE_NO_EFFECT_LABEL}
									</span>
								{/if}
							</p>
							{#if item}
								<p class="break-words text-slate-700">
									{item.name}
									<span class="font-semibold tabular-nums">{event.qty} {item.unit}</span>
								</p>
							{/if}
							{#if returner}
								<p class="text-slate-600">
									ผู้คืน: <span class="font-medium text-slate-800">{returner}</span>
								</p>
							{/if}
							{#if event.notes}
								<p class="text-xs break-words text-slate-500">หมายเหตุ: {event.notes}</p>
							{/if}
							<p class="text-xs text-slate-500">
								{#if event.by}โดย {event.by} ·{/if}
								<span class="tabular-nums">{formatThaiDateTime(event.at)}</span>
							</p>
						</li>
					{/each}
				</ol>
			{/if}
		</div>
	{/if}
</section>
