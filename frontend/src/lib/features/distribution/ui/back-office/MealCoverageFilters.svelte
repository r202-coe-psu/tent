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
		/** Records a person needs; names the "not enough" option. */
		threshold: number;
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
		threshold,
		onExport,
		onQueryChange,
		onFilterChange,
		onZoneChange
	}: Props = $props();

	const FILTER_LABELS = $derived<Record<CoverageFilter, string>>({
		all: 'ทุกสถานะ',
		complete: 'ได้รับครบ',
		incomplete: `ยังไม่ถึง ${threshold} มื้อ`,
		partial: 'มีบันทึก 1 มื้อ',
		none: 'ยังไม่มีบันทึกเลย'
	});
	const FILTERS = $derived(
		(Object.keys(FILTER_LABELS) as CoverageFilter[]).filter((f) => showPartial || f !== 'partial')
	);

	const zoneText = $derived(
		zone === ALL_ZONES ? 'ทุกโซน' : (zones.find((z) => z.value === zone)?.label ?? zone)
	);
	const fieldLabel = 'text-sm font-semibold text-slate-700';
	const triggerClass =
		'h-11 w-full rounded-lg bg-white px-2.5 text-sm shadow-2xs data-[size=default]:h-11 sm:h-10 sm:data-[size=default]:h-10';
</script>

<div
	class="grid grid-cols-1 gap-3 border-b border-slate-200/80 px-4 py-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end"
>
	<div class="min-w-0 space-y-1.5 sm:col-span-2 lg:col-span-1">
		<Label for="meal-coverage-search" class={fieldLabel}>ค้นหา</Label>
		<div class="relative">
			<Search
				class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
				aria-hidden="true"
			/>
			<Input
				id="meal-coverage-search"
				type="search"
				placeholder="ชื่อผู้พักพิง"
				bind:value={() => query, onQueryChange}
				class="h-11 w-full rounded-lg bg-white pl-9 sm:h-10"
			/>
		</div>
	</div>

	<div class="min-w-0 space-y-1.5">
		<Label for="meal-coverage-status" class={fieldLabel}>สถานะ</Label>
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

	<div class="min-w-0 space-y-1.5">
		<Label for="meal-coverage-zone" class={fieldLabel}>โซน</Label>
		<Select.Root
			type="single"
			value={zone}
			disabled={zones.length === 0}
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

	<div class="flex items-center justify-between gap-3 sm:col-span-2 lg:col-span-1 lg:justify-end">
		<p class="text-sm whitespace-nowrap text-slate-500 tabular-nums">
			พบ <span class="font-semibold text-slate-800">{shown}</span> จาก {total} คน
		</p>
		<Button
			variant="outline"
			class="h-11 rounded-lg sm:h-10"
			disabled={shown === 0}
			onclick={onExport}
		>
			<Download class="size-4" aria-hidden="true" />
			ส่งออก CSV
		</Button>
	</div>
</div>
