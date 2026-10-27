<script lang="ts">
	/**
	 * One sub-shift as an in-place editable card (#624) — modelled on the item
	 * cards of the donation form (`components/form/form-donor.svelte`): fields
	 * inside the card, delete in the top-right corner, its own error underneath.
	 *
	 * Stateless: every edit goes back through `onchange` as a patch, and the list
	 * applies it with `updateShiftCard` so `end_date` is always re-derived.
	 */
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import MoonStar from '@lucide/svelte/icons/moon-star';
	import DatePicker from '$lib/components/date-picker.svelte';
	import TimePicker from '$lib/components/time-picker.svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import type { JobShift } from '../domain/job.schema';

	let {
		shift,
		index,
		error = null,
		minQuota = 0,
		disabled = false,
		onchange,
		onremove
	}: {
		shift: JobShift;
		/** Zero-based position — shown as "กะที่ N". */
		index: number;
		/** Thai message to show on this card, or `null`. */
		error?: string | null;
		/** Seats this saved shift already holds — the headcount floor. */
		minQuota?: number;
		disabled?: boolean;
		onchange: (
			patch: Partial<Pick<JobShift, 'date' | 'start_time' | 'end_time' | 'quota'>>
		) => void;
		onremove: () => void;
	} = $props();

	const fieldId = $derived(`shift-${shift.id}`);
	const crossesMidnight = $derived(shift.end_date !== '' && shift.end_date !== shift.date);
	const errorId = $derived(`${fieldId}-error`);
</script>

<div
	class={[
		'relative space-y-3 rounded-xl border bg-white p-4 shadow-2xs sm:p-5',
		error ? 'border-red-300' : 'border-slate-200/80'
	]}
	aria-describedby={error ? errorId : undefined}
>
	<div class="flex items-center justify-between gap-2 pr-10">
		<p class="text-sm font-semibold text-slate-900">กะที่ {index + 1}</p>
		{#if minQuota > 0}
			<span
				class="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-xs font-semibold text-sky-900 tabular-nums"
			>
				มีอาสาถือที่นั่ง {minQuota} คน
			</span>
		{/if}
	</div>

	<button
		type="button"
		onclick={onremove}
		{disabled}
		class="absolute top-2 right-2 grid min-h-11 min-w-11 cursor-pointer place-items-center rounded-lg text-red-500 transition-colors hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
		aria-label="ลบกะที่ {index + 1}"
	>
		<Trash2 class="h-4.5 w-4.5" />
	</button>

	<div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
		<div class="col-span-2 space-y-1.5 lg:col-span-1">
			<Label for="{fieldId}-date" class="text-sm font-semibold text-slate-700">วันที่ทำงาน</Label>
			<DatePicker
				id="{fieldId}-date"
				{disabled}
				bind:value={() => shift.date, (date) => onchange({ date })}
			/>
		</div>
		<div class="space-y-1.5">
			<Label for="{fieldId}-start" class="text-sm font-semibold text-slate-700">เวลาเข้ากะ</Label>
			<TimePicker
				id="{fieldId}-start"
				{disabled}
				bind:value={() => shift.start_time, (start_time) => onchange({ start_time })}
			/>
		</div>
		<div class="space-y-1.5">
			<Label for="{fieldId}-end" class="text-sm font-semibold text-slate-700">เวลาออกกะ</Label>
			<TimePicker
				id="{fieldId}-end"
				{disabled}
				bind:value={() => shift.end_time, (end_time) => onchange({ end_time })}
			/>
		</div>
		<div class="col-span-2 space-y-1.5 lg:col-span-1">
			<Label for="{fieldId}-quota" class="text-sm font-semibold text-slate-700">
				จำนวนรับ (คน)
			</Label>
			<Input
				id="{fieldId}-quota"
				type="number"
				min={Math.max(1, minQuota)}
				step="1"
				inputmode="numeric"
				class="!h-11 tabular-nums"
				{disabled}
				aria-invalid={error ? true : undefined}
				bind:value={() => shift.quota, (quota) => onchange({ quota: Number(quota) })}
			/>
		</div>
	</div>

	{#if crossesMidnight}
		<p class="flex items-center gap-1.5 text-xs text-slate-500">
			<MoonStar class="h-3.5 w-3.5 shrink-0" />
			ข้ามคืน — สิ้นสุดวันที่ <span class="tabular-nums">{shift.end_date}</span>
		</p>
	{/if}

	{#if error}
		<p id={errorId} role="alert" class="flex items-start gap-1.5 text-sm font-medium text-red-700">
			<AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
			{error}
		</p>
	{/if}
</div>
