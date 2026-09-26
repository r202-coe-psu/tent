<script lang="ts">
	import type { RequisitionType } from '../../domain/food-supplies';
	import { getRequisitionTypeLabel } from '../model/ticket-status';
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
	}

	let {
		search,
		destination,
		destinations,
		requisitionType = 'all',
		onSearchChange,
		onDestinationChange,
		onTypeChange,
		onResetFilters
	}: Props = $props();

	const hasActiveFilters = $derived(
		search.trim().length > 0 || destination !== 'all' || requisitionType !== 'all'
	);
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

		<!-- Reset Filters Button -->
		{#if hasActiveFilters && onResetFilters}
			<Button type="button" variant="outline" onclick={onResetFilters} class="text-xs font-medium">
				<RotateCcw class="h-3.5 w-3.5 text-slate-400" />
				ล้างตัวกรอง
			</Button>
		{/if}
	</div>
</div>
