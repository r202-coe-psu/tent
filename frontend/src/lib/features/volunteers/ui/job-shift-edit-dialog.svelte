<script lang="ts">
	/**
	 * Edit one existing sub-shift of a job — date, times and headcount
	 * ("กะและตารางกะ" tab, `job-shift-card.svelte`'s pencil button).
	 *
	 * The dialog only validates and hands the edited row back; the parent tab
	 * owns the single `persistShifts` write path that re-derives `job.quota`
	 * from the rows, so this component can never save a job whose quota and
	 * `shifts[]` disagree.
	 *
	 * `minQuota` is the number of seats this shift already holds (confirmed +
	 * dispatched, from `domain/capacity.ts`). Cutting below it is rejected here
	 * with a Thai message: `JobRepository#update` would refuse the write anyway
	 * ("quota below what volunteers already hold"), and a rejected save after
	 * the dialog closed reads as a silent failure.
	 */
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import DatePicker from '$lib/components/date-picker.svelte';
	import TimePicker from '$lib/components/time-picker.svelte';
	import { applyShiftEdit, validateShiftEdit } from '../domain/shift-edit';
	import type { JobShift } from '../domain/job.schema';

	let {
		open = $bindable(false),
		shift,
		siblings,
		minQuota = 0,
		pending = false,
		onsave
	}: {
		open?: boolean;
		shift: JobShift | null;
		/** Every OTHER shift of this job — the duplicate check must not match itself. */
		siblings: readonly JobShift[];
		/** Seats already confirmed + dispatched in this shift. */
		minQuota?: number;
		pending?: boolean;
		onsave: (shift: JobShift) => void;
	} = $props();

	let date = $state('');
	let startTime = $state('08:00');
	let endTime = $state('16:00');
	let seats = $state(1);

	/**
	 * Reload the form from the shift each time the dialog opens. Keyed on
	 * `open` as well as the shift so reopening after a cancelled edit shows the
	 * persisted values again rather than the abandoned ones.
	 */
	$effect(() => {
		if (!open || !shift) return;
		date = shift.date;
		startTime = shift.start_time;
		endTime = shift.end_time;
		seats = shift.quota;
	});

	const validation = $derived(
		validateShiftEdit(
			{ date, start_time: startTime, end_time: endTime, quota: seats },
			siblings,
			minQuota
		)
	);
	const endDate = $derived(validation.endDate);
	const error = $derived(validation.error);
	const crossesMidnight = $derived(endDate !== '' && endDate !== date);

	function save() {
		if (!shift || error || pending) return;
		onsave(
			applyShiftEdit(
				shift,
				{ date, start_time: startTime, end_time: endTime, quota: seats },
				endDate
			)
		);
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Title class="flex items-center gap-2">
			<CalendarClock class="h-4.5 w-4.5 text-primary" />
			แก้ไขกะย่อย
		</Dialog.Title>
		<p class="text-sm text-muted-foreground">
			เปลี่ยนวัน เวลา หรือจำนวนคนของกะนี้ — โควตารวมของงานจะถูกคำนวณใหม่จากทุกกะโดยอัตโนมัติ
		</p>

		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
			<div class="space-y-1.5 sm:col-span-2">
				<Label for="edit-shift-date" class="text-xs">
					วันที่ปฏิบัติงาน <span class="text-destructive">*</span>
				</Label>
				<DatePicker id="edit-shift-date" bind:value={date} />
			</div>
			<div class="space-y-1.5">
				<Label for="edit-shift-start" class="text-xs">
					เวลาเข้ากะ <span class="text-destructive">*</span>
				</Label>
				<TimePicker id="edit-shift-start" bind:value={startTime} />
			</div>
			<div class="space-y-1.5">
				<Label for="edit-shift-end" class="text-xs">
					เวลาออกกะ <span class="text-destructive">*</span>
				</Label>
				<TimePicker id="edit-shift-end" bind:value={endTime} />
			</div>
			<div class="space-y-1.5 sm:col-span-2">
				<Label for="edit-shift-seats" class="text-xs">
					จำนวนคน (คน/กะ) <span class="text-destructive">*</span>
				</Label>
				<Input
					id="edit-shift-seats"
					type="number"
					min={Math.max(1, minQuota)}
					step="1"
					class="!h-11"
					bind:value={seats}
				/>
				{#if minQuota > 0}
					<p class="text-2xs text-muted-foreground">
						มีอาสาถือที่นั่งในกะนี้แล้ว {minQuota} คน — ลดได้ไม่ต่ำกว่านี้
					</p>
				{/if}
			</div>
		</div>

		{#if crossesMidnight}
			<p class="text-xs text-muted-foreground">
				กะนี้ข้ามเที่ยงคืน — จะบันทึกวันสิ้นสุดเป็น {endDate}
			</p>
		{/if}

		{#if error}
			<p class="rounded-lg bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</p>
		{/if}

		<div class="flex justify-end gap-2 pt-1">
			<Button variant="outline" onclick={() => (open = false)}>ยกเลิก</Button>
			<Button disabled={error !== null || pending} onclick={save}>บันทึกการแก้ไข</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
