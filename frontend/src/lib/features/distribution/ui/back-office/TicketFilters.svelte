<script lang="ts">
	import type { RequisitionTicketStatus, RequisitionType } from '../../domain/food-supplies';
	import { TICKET_STATUS_LABELS, getRequisitionTypeLabel } from '../model/ticket-status';
	import DatePicker from '$lib/components/date-picker.svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import Search from '@lucide/svelte/icons/search';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';

	interface Props {
		search: string;
		destination: string | 'all';
		destinations: readonly string[];
		requisitionType?: RequisitionType | 'all';
		onSearchChange: (value: string) => void;
		onDestinationChange: (destination: string | 'all') => void;
		onTypeChange?: (type: RequisitionType | 'all') => void;
		onResetFilters?: () => void;
		/** Statuses selectable under the active workflow group. */
		statusOptions?: readonly RequisitionTicketStatus[];
		statuses?: readonly RequisitionTicketStatus[];
		onStatusesChange?: (statuses: RequisitionTicketStatus[]) => void;
		createdFrom?: string;
		createdTo?: string;
		onCreatedFromChange?: (value: string) => void;
		onCreatedToChange?: (value: string) => void;
		/** Whether the "needs follow-up" toggle is shown (user has an actionable role). */
		followUpAvailable?: boolean;
		followUp?: boolean;
		onFollowUpChange?: (value: boolean) => void;
	}

	let {
		search,
		destination,
		destinations,
		requisitionType = 'all',
		onSearchChange,
		onDestinationChange,
		onTypeChange,
		onResetFilters,
		statusOptions = [],
		statuses = [],
		onStatusesChange,
		createdFrom = '',
		createdTo = '',
		onCreatedFromChange,
		onCreatedToChange,
		followUpAvailable = false,
		followUp = false,
		onFollowUpChange
	}: Props = $props();

	const hasActiveFilters = $derived(
		search.trim().length > 0 ||
			destination !== 'all' ||
			requisitionType !== 'all' ||
			statuses.length > 0 ||
			createdFrom !== '' ||
			createdTo !== '' ||
			followUp
	);

	function toggleStatus(status: RequisitionTicketStatus, checked: boolean) {
		const next = checked
			? [...statuses.filter((s) => s !== status), status]
			: statuses.filter((s) => s !== status);
		onStatusesChange?.(next);
	}
</script>

<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
	<!-- Search input -->
	<div class="relative max-w-md min-w-[240px] flex-1">
		<Search class="absolute top-2.5 left-3 h-4 w-4 text-slate-400" aria-hidden="true" />
		<Input
			type="text"
			id="ticket-search-input"
			value={search}
			oninput={(e) => onSearchChange(e.currentTarget.value)}
			placeholder="ค้นหาเลขที่ตั๋ว, ผู้ร้องขอ, จุดหมาย..."
			aria-label="ค้นหาเลขที่ตั๋ว, ผู้ร้องขอ, จุดหมาย"
			class="h-10 w-full rounded-lg pl-9 text-sm shadow-2xs placeholder:text-slate-400"
		/>
	</div>

	<!-- Dropdown filters -->
	<div class="flex flex-wrap items-center gap-2">
		<!-- Requisition Type Filter -->
		<div class="flex items-center gap-1.5">
			<label for="requisition-type-filter" class="shrink-0 text-xs font-semibold text-slate-600">
				ประเภท:
			</label>
			<Select.Root
				type="single"
				value={requisitionType}
				onValueChange={(val) => {
					if (val && onTypeChange) onTypeChange(val as RequisitionType | 'all');
				}}
			>
				<Select.Trigger
					id="requisition-type-filter"
					aria-label="กรองตามประเภท"
					class="h-10 min-w-[130px] rounded-lg text-sm shadow-2xs"
				>
					<span class="truncate">
						{requisitionType === 'all' ? 'ทุกประเภท' : getRequisitionTypeLabel(requisitionType)}
					</span>
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="all" label="ทุกประเภท" />
					<Select.Item value="food" label="อาหาร" />
					<Select.Item value="supplies" label="พัสดุ" />
				</Select.Content>
			</Select.Root>
		</div>

		<!-- Destination Location Filter -->
		<div class="flex items-center gap-1.5">
			<label for="destination-filter" class="shrink-0 text-xs font-semibold text-slate-600">
				จุดหมาย:
			</label>
			<Select.Root
				type="single"
				value={destination}
				onValueChange={(val) => {
					if (val) onDestinationChange(val);
				}}
			>
				<Select.Trigger
					id="destination-filter"
					aria-label="กรองตามจุดหมาย"
					class="h-10 min-w-[140px] rounded-lg text-sm shadow-2xs"
				>
					<span class="truncate">
						{destination === 'all' ? 'ทุกจุดหมาย' : destination}
					</span>
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="all" label="ทุกจุดหมาย" />
					{#each destinations as dest (dest)}
						<Select.Item value={dest} label={dest} />
					{/each}
				</Select.Content>
			</Select.Root>
		</div>

		<!-- Multi-select status filter -->
		{#if onStatusesChange}
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							type="button"
							variant="outline"
							aria-label="กรองตามสถานะ"
							class="h-10 gap-1.5 rounded-lg text-sm font-normal shadow-2xs"
						>
							<span>สถานะ{statuses.length > 0 ? ` (${statuses.length})` : ''}</span>
							<ChevronDown class="h-4 w-4 text-slate-400" aria-hidden="true" />
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="start" class="min-w-[200px]">
					{#each statusOptions as status (status)}
						<DropdownMenu.CheckboxItem
							checked={statuses.includes(status)}
							closeOnSelect={false}
							onCheckedChange={(checked) => toggleStatus(status, checked)}
						>
							{TICKET_STATUS_LABELS[status]}
						</DropdownMenu.CheckboxItem>
					{/each}
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		{/if}

		<!-- Created date range -->
		{#if onCreatedFromChange}
			<div class="flex items-center gap-1.5">
				<label for="created-from-filter" class="shrink-0 text-xs font-semibold text-slate-600">
					ตั้งแต่วันที่
				</label>
				<DatePicker
					id="created-from-filter"
					class="!h-10 w-[150px]"
					bind:value={() => createdFrom, (v) => onCreatedFromChange?.(v)}
				/>
			</div>
		{/if}
		{#if onCreatedToChange}
			<div class="flex items-center gap-1.5">
				<label for="created-to-filter" class="shrink-0 text-xs font-semibold text-slate-600">
					ถึงวันที่
				</label>
				<DatePicker
					id="created-to-filter"
					class="!h-10 w-[150px]"
					bind:value={() => createdTo, (v) => onCreatedToChange?.(v)}
				/>
			</div>
		{/if}

		<!-- Needs follow-up toggle (role-based) -->
		{#if followUpAvailable && onFollowUpChange}
			<Button
				type="button"
				variant={followUp ? 'default' : 'outline'}
				aria-pressed={followUp}
				onclick={() => onFollowUpChange(!followUp)}
				class="h-10 rounded-lg text-sm shadow-2xs"
			>
				ต้องติดตาม
			</Button>
		{/if}

		<!-- Reset Filters Button -->
		{#if hasActiveFilters && onResetFilters}
			<Button type="button" variant="outline" onclick={onResetFilters} class="text-xs font-medium">
				<RotateCcw class="h-3.5 w-3.5 text-slate-400" />
				ล้างตัวกรอง
			</Button>
		{/if}
	</div>
</div>
