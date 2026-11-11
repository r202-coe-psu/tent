<script lang="ts">
	import Download from '@lucide/svelte/icons/download';
	import Search from '@lucide/svelte/icons/search';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { ALL_ZONES, type CoverageFilter } from '../model/meal-coverage-view';

	interface Props {
		query: string;
		filter: CoverageFilter;
		zone: string;
		zones: readonly { value: string; label: string }[];
		shown: number;
		total: number;
		/** Whether a "one meal" status exists (it does not when only one record is needed). */
		showPartial: boolean;
		onExport: () => void;
		onQueryChange: (query: string) => void;
		onFilterChange: (filter: CoverageFilter) => void;
		onZoneChange: (zone: string) => void;
	}

	let {
		query,
		filter,
		zone,
		zones,
		shown,
		total,
		showPartial,
		onExport,
		onQueryChange,
		onFilterChange,
		onZoneChange
	}: Props = $props();

	const FILTER_LABELS: Record<CoverageFilter, string> = {
		all: 'ทุกสถานะ',
		none: 'ยังไม่มีบันทึกเลย',
		partial: 'มีบันทึก 1 มื้อ'
	};
	const FILTERS = $derived(
		(Object.keys(FILTER_LABELS) as CoverageFilter[]).filter((f) => showPartial || f !== 'partial')
	);

	const zoneText = $derived(
		zone === ALL_ZONES ? 'ทุกโซน' : (zones.find((z) => z.value === zone)?.label ?? zone)
	);
	const triggerClass =
		'h-11 min-w-36 rounded-lg bg-white px-2.5 text-sm shadow-2xs data-[size=default]:h-11 sm:h-10 sm:data-[size=default]:h-10';
</script>

<div
	class="flex flex-col gap-3 border-b border-slate-200/80 px-4 py-3 lg:flex-row lg:items-center lg:justify-between"
>
	<div class="flex flex-wrap items-center gap-3">
		<div class="relative w-full sm:w-64">
			<Label for="meal-coverage-search" class="sr-only">ค้นหาชื่อผู้พักพิง</Label>
			<Search
				class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
				aria-hidden="true"
			/>
			<Input
				id="meal-coverage-search"
				type="search"
				placeholder="ค้นหาชื่อผู้พักพิง"
				bind:value={() => query, onQueryChange}
				class="h-11 bg-white pl-9 sm:h-10"
			/>
		</div>

		<div class="flex items-center gap-1.5">
			<Label for="meal-coverage-status" class="shrink-0 text-sm font-semibold text-slate-700">
				สถานะ
			</Label>
			<Select.Root
				type="single"
				value={filter}
				onValueChange={(v) => {
					if (v) onFilterChange(v as CoverageFilter);
				}}
			>
				<Select.Trigger id="meal-coverage-status" class={triggerClass}>
					<span class="truncate">{FILTER_LABELS[filter]}</span>
				</Select.Trigger>
				<Select.Content>
					{#each FILTERS as f (f)}
						<Select.Item value={f} label={FILTER_LABELS[f]} />
					{/each}
				</Select.Content>
			</Select.Root>
		</div>

		{#if zones.length > 0}
			<div class="flex items-center gap-1.5">
				<Label for="meal-coverage-zone" class="shrink-0 text-sm font-semibold text-slate-700">
					โซน
				</Label>
				<Select.Root
					type="single"
					value={zone}
					onValueChange={(v) => {
						if (v) onZoneChange(v);
					}}
				>
					<Select.Trigger id="meal-coverage-zone" class={triggerClass}>
						<span class="truncate">{zoneText}</span>
					</Select.Trigger>
					<Select.Content>
						<Select.Item value={ALL_ZONES} label="ทุกโซน" />
						{#each zones as z (z.value)}
							<Select.Item value={z.value} label={z.label} />
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
		{/if}
	</div>
	<div class="flex flex-wrap items-center gap-3">
		<p class="text-sm text-slate-500 tabular-nums">
			พบ <span class="font-semibold text-slate-800">{shown}</span> จาก {total} คน
		</p>
		<Button variant="outline" class="h-11 sm:h-10" disabled={shown === 0} onclick={onExport}>
			<Download class="size-4" aria-hidden="true" />
			ส่งออก CSV
		</Button>
	</div>
</div>
