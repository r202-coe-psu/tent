<script lang="ts">
	import type { RequisitionTicketStatus } from '../../domain/food-supplies';
	import { REQUISITION_TICKET_STATUSES, TICKET_STATUS_LABELS } from '../model/ticket-status';
	import Search from '@lucide/svelte/icons/search';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';

	interface Props {
		search: string;
		detailedStatus: RequisitionTicketStatus | 'all';
		destination: string | 'all';
		destinations: readonly string[];
		onSearchChange: (value: string) => void;
		onStatusChange: (status: RequisitionTicketStatus | 'all') => void;
		onDestinationChange: (destination: string | 'all') => void;
		onResetFilters?: () => void;
	}

	let {
		search,
		detailedStatus,
		destination,
		destinations,
		onSearchChange,
		onStatusChange,
		onDestinationChange,
		onResetFilters
	}: Props = $props();

	const hasActiveFilters = $derived(
		search.trim().length > 0 || detailedStatus !== 'all' || destination !== 'all'
	);
</script>

<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
	<!-- Search input -->
	<div class="relative max-w-md min-w-[240px] flex-1">
		<Search class="absolute top-2.5 left-3 h-4 w-4 text-slate-400" aria-hidden="true" />
		<input
			type="text"
			id="ticket-search-input"
			value={search}
			oninput={(e) => onSearchChange(e.currentTarget.value)}
			placeholder="ค้นหาเลขที่ตั๋ว, ผู้ร้องขอ, จุดหมาย..."
			aria-label="ค้นหาเลขที่ตั๋ว, ผู้ร้องขอ, จุดหมาย"
			class="h-10 w-full rounded-lg border border-slate-200/80 bg-white pr-3 pl-9 text-sm text-slate-800 shadow-2xs placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none"
		/>
	</div>

	<!-- Dropdown filters -->
	<div class="flex flex-wrap items-center gap-2">
		<!-- Detailed Canonical Status Filter -->
		<div class="flex items-center gap-1.5">
			<label for="detailed-status-filter" class="shrink-0 text-xs font-semibold text-slate-600">
				สถานะ:
			</label>
			<select
				id="detailed-status-filter"
				value={detailedStatus}
				onchange={(e) => onStatusChange(e.currentTarget.value as RequisitionTicketStatus | 'all')}
				class="h-10 rounded-lg border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-800 shadow-2xs focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none"
			>
				<option value="all">ทุกสถานะ (ทั้งหมด 9 สถานะ)</option>
				{#each REQUISITION_TICKET_STATUSES as status (status)}
					<option value={status}>
						{TICKET_STATUS_LABELS[status]} ({status})
					</option>
				{/each}
			</select>
		</div>

		<!-- Destination Location Filter -->
		<div class="flex items-center gap-1.5">
			<label for="destination-filter" class="shrink-0 text-xs font-semibold text-slate-600">
				จุดหมาย:
			</label>
			<select
				id="destination-filter"
				value={destination}
				onchange={(e) => onDestinationChange(e.currentTarget.value)}
				class="h-10 rounded-lg border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-800 shadow-2xs focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none"
			>
				<option value="all">ทุกจุดหมาย</option>
				{#each destinations as dest (dest)}
					<option value={dest}>{dest}</option>
				{/each}
			</select>
		</div>

		<!-- Reset Filters Button -->
		{#if hasActiveFilters && onResetFilters}
			<button
				type="button"
				onclick={onResetFilters}
				class="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 shadow-2xs transition-colors hover:bg-slate-50 hover:text-slate-900"
			>
				<RotateCcw class="h-3.5 w-3.5 text-slate-400" />
				ล้างตัวกรอง
			</button>
		{/if}
	</div>
</div>
