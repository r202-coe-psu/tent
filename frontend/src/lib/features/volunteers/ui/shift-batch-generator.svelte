<script lang="ts">
	/**
	 * Batch Generator — shifts over a date range on chosen weekdays. Produces
	 * plain `JobShift` rows through `generateBatchShifts` (pure, unit-tested) and
	 * hands them to the card list, which appends them as cards (#624).
	 */
	import { toast } from 'svelte-sonner';
	import Zap from '@lucide/svelte/icons/zap';
	import Check from '@lucide/svelte/icons/check';
	import DatePicker from '$lib/components/date-picker.svelte';
	import TimePicker from '$lib/components/time-picker.svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { errorMessage } from '$lib/utils/errors';
	import type { JobShift } from '../domain/job.schema';
	import {
		ALL_WEEKDAYS,
		WEEKDAYS,
		WEEKDAYS_MON_FRI,
		WEEKENDS,
		checkBatchRange,
		generateBatchShifts,
		weekdayName,
		type Weekday
	} from '../domain/shift-batch';

	let {
		idFactory,
		disabled = false,
		ongenerate
	}: {
		idFactory: () => string;
		disabled?: boolean;
		ongenerate: (rows: JobShift[]) => void;
	} = $props();

	let startDate = $state('');
	let endDate = $state('');
	let startTime = $state('08:00');
	let endTime = $state('16:00');
	let seats = $state(5);
	let weekdays = $state<Weekday[]>([...ALL_WEEKDAYS]);

	/** Checked as the user picks, so a weekday the range lacks is flagged before Generate. */
	const check = $derived(checkBatchRange(startDate, endDate, weekdays));
	const missingNames = $derived(check.missing.map(weekdayName).join(', '));

	/** Why Generate cannot run yet, in Thai — `null` when it can. */
	const blocker = $derived.by<string | null>(() => {
		if (check.rangeError) return check.rangeError;
		if (!check.available) return null;
		if (weekdays.length === 0) return 'กรุณาเลือกวันในสัปดาห์อย่างน้อย 1 วัน';
		if (check.count === 0) {
			return `ช่วงวันที่ที่เลือกไม่มีวัน${missingNames} — เลือกวันในสัปดาห์ที่อยู่ในช่วงนี้ หรือขยายช่วงวันที่`;
		}
		return null;
	});

	const canGenerate = $derived(
		startDate !== '' &&
			endDate !== '' &&
			startTime !== '' &&
			endTime !== '' &&
			weekdays.length > 0 &&
			Number.isInteger(seats) &&
			seats > 0 &&
			blocker === null
	);

	function toggleWeekday(day: Weekday) {
		weekdays = weekdays.includes(day) ? weekdays.filter((d) => d !== day) : [...weekdays, day];
	}

	function generate() {
		if (disabled) return;
		if (blocker) {
			toast.error(`สร้างกะไม่ได้ — ${blocker}`);
			return;
		}
		if (!canGenerate) return;
		try {
			const rows = generateBatchShifts(
				{
					startDate,
					endDate,
					weekdays,
					start_time: startTime,
					end_time: endTime,
					quota: seats
				},
				idFactory
			);
			if (rows.length === 0) {
				toast.error('ไม่มีวันใดในช่วงที่เลือกตรงกับวันในสัปดาห์ที่เลือกไว้');
				return;
			}
			ongenerate(rows);
		} catch (err) {
			toast.error(`สร้างกะเป็นช่วงวันไม่สำเร็จ: ${errorMessage(err)}`);
		}
	}
</script>

<div class="space-y-3 rounded-xl border border-slate-200/80 bg-slate-50 p-4">
	<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
		<label class="space-y-1">
			<span class="text-sm font-semibold text-slate-700">📅 วันที่เริ่มสร้างกะ</span>
			<DatePicker bind:value={startDate} {disabled} />
		</label>
		<label class="space-y-1">
			<span class="text-sm font-semibold text-slate-700">🏁 วันที่สิ้นสุด</span>
			<DatePicker bind:value={endDate} {disabled} />
		</label>
	</div>
	<div class="grid grid-cols-1 gap-3 md:grid-cols-3">
		<label class="space-y-1">
			<span class="text-sm font-semibold text-slate-700">⏰ เวลาเข้ากะ</span>
			<TimePicker bind:value={startTime} {disabled} />
		</label>
		<label class="space-y-1">
			<span class="text-sm font-semibold text-slate-700">⏰ เวลาออกกะ</span>
			<TimePicker bind:value={endTime} {disabled} />
		</label>
		<label class="space-y-1">
			<span class="text-sm font-semibold text-slate-700">👥 จำนวนคนต่อกะ</span>
			<Input type="number" min="1" bind:value={seats} class="!h-11 tabular-nums" {disabled} />
		</label>
	</div>

	<div class="space-y-2">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<span class="text-sm font-semibold text-slate-700">📅 วันในสัปดาห์ที่ต้องการเปิดกะ</span>
			<div class="flex flex-wrap gap-1">
				<Button
					type="button"
					size="sm"
					variant="ghost"
					class="min-h-11 text-primary"
					{disabled}
					onclick={() => (weekdays = [...ALL_WEEKDAYS])}
				>
					ทุกวัน
				</Button>
				<Button
					type="button"
					size="sm"
					variant="ghost"
					class="min-h-11 text-primary"
					{disabled}
					onclick={() => (weekdays = [...WEEKDAYS_MON_FRI])}
				>
					จันทร์ - ศุกร์
				</Button>
				<Button
					type="button"
					size="sm"
					variant="ghost"
					class="min-h-11 text-amber-700"
					{disabled}
					onclick={() => (weekdays = [...WEEKENDS])}
				>
					เสาร์ - อาทิตย์
				</Button>
			</div>
		</div>
		<div class="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-7">
			{#each WEEKDAYS as day (day.value)}
				{@const active = weekdays.includes(day.value)}
				{@const outOfRange = check.available !== null && !check.available.has(day.value)}
				<Button
					type="button"
					size="sm"
					variant={active ? 'default' : 'outline'}
					aria-pressed={active}
					class={[
						'h-auto min-h-11 w-full flex-col justify-center gap-0 px-1 py-1.5 text-xs leading-tight whitespace-normal',
						outOfRange && 'border-dashed opacity-60'
					]}
					{disabled}
					onclick={() => toggleWeekday(day.value)}
				>
					<span class="flex items-center">
						{#if active}<Check class="mr-1 size-3" />{/if}
						{weekdayName(day.value)}
						<!-- The English half only restates the Thai — first to go on narrow screens. -->
						<span class="ml-1 hidden lg:inline"
							>{day.label.slice(weekdayName(day.value).length).trim()}</span
						>
					</span>
					{#if outOfRange}
						<span class="text-xs font-normal">ไม่มีในช่วงนี้</span>
					{/if}
				</Button>
			{/each}
		</div>
	</div>

	{#if blocker}
		<p
			role="alert"
			class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-900"
		>
			{blocker}
		</p>
	{:else if check.missing.length > 0}
		<p class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
			ช่วงวันที่ที่เลือกไม่มีวัน{missingNames} — จะสร้างเฉพาะวันที่อยู่ในช่วง
			<span class="font-semibold tabular-nums">{check.count}</span> กะ
		</p>
	{:else if check.count > 0}
		<p class="text-sm text-slate-600">
			จะสร้าง <span class="font-semibold text-slate-900 tabular-nums">{check.count}</span> กะ
		</p>
	{/if}

	<Button
		type="button"
		class="min-h-11 w-full"
		disabled={!canGenerate || disabled}
		onclick={generate}
	>
		<Zap class="mr-1 size-4 shrink-0" />
		สร้างกะตามช่วงวัน
	</Button>
</div>
