<script lang="ts">
	import { parseDate } from '@internationalized/date';
	import { DateRangePicker } from '$lib/components/ui/date-picker';
	import * as Select from '$lib/components/ui/select/index.js';
	import { COVERAGE_RANGE_PRESETS, type CoverageRangePreset } from '../model/meal-coverage-view';

	interface Props {
		preset: CoverageRangePreset;
		/** The picked range of the `custom` preset; empty until one is picked. */
		customRange: { from: string; to: string } | undefined;
		/** Latest selectable day (Thai today). */
		today: string;
		/** The range on screen, so a first switch to `custom` starts from it instead of an empty picker. */
		current: { from: string; to: string } | null;
	}

	let { preset = $bindable(), customRange = $bindable(), today, current }: Props = $props();

	const PRESET_LABELS: Record<CoverageRangePreset, string> = {
		today: 'วันนี้',
		yesterday: 'เมื่อวาน',
		'7d': '7 วันล่าสุด',
		'14d': '14 วันล่าสุด',
		'30d': '30 วันล่าสุด',
		custom: 'กำหนดเอง'
	};

	const maxValue = $derived(parseDate(today));
	// Without a custom range there is nothing for the left column, so the preset takes both.
	const presetSpan = $derived(preset === 'custom' ? '' : 'sm:col-span-2');

	function isPreset(value: string): value is CoverageRangePreset {
		return (COVERAGE_RANGE_PRESETS as readonly string[]).includes(value);
	}

	function selectPreset(value: string) {
		if (!isPreset(value)) return;
		if (value === 'custom' && !customRange && current) customRange = { ...current };
		preset = value;
	}
</script>

<!-- One labelled group: the preset and, for a custom range, the pickers next to it. Below xl the
	group spans the header: two equal columns, dates on the left and the preset on the right. -->
<div
	class="w-full min-w-0 space-y-1.5 xl:w-auto xl:self-end"
	role="group"
	aria-labelledby="meal-coverage-range-label"
>
	<span id="meal-coverage-range-label" class="block text-sm font-semibold text-slate-700">
		ช่วงวันที่
	</span>
	<div
		class="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:flex xl:flex-wrap xl:items-center xl:justify-end"
	>
		<Select.Root type="single" bind:value={() => preset, selectPreset}>
			<Select.Trigger
				id="meal-coverage-range-preset"
				aria-labelledby="meal-coverage-range-label"
				class="h-11 w-full min-w-0 rounded-lg bg-white px-3 shadow-2xs sm:h-10 sm:data-[size=default]:h-10 xl:w-44 {presetSpan}"
			>
				<span class="truncate">{PRESET_LABELS[preset]}</span>
			</Select.Trigger>
			<Select.Content>
				{#each COVERAGE_RANGE_PRESETS as option (option)}
					<Select.Item value={option} label={PRESET_LABELS[option]} />
				{/each}
			</Select.Content>
		</Select.Root>

		{#if preset === 'custom'}
			<DateRangePicker
				id="meal-coverage-range-custom"
				ariaLabel="ช่วงวันที่ของรายงานการรับอาหาร"
				from={customRange?.from}
				to={customRange?.to}
				{maxValue}
				onRangeChange={(next) => (customRange = next)}
				class="h-11 w-full min-w-0 rounded-lg bg-white sm:order-first sm:h-10 xl:order-none xl:w-auto xl:min-w-[16rem]"
			/>
		{/if}
	</div>
</div>
