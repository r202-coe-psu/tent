<script lang="ts">
	/**
	 * One staff direct assignment on the job detail "ผู้สมัคร" tab: a `shift_assignment`
	 * staff wrote without any `job_application` (job assign page, walk-in registration), so
	 * it has no application card of its own. One row per assignment, never grouped by person.
	 */
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import Clock from '@lucide/svelte/icons/clock';
	import IdCard from '@lucide/svelte/icons/id-card';
	import Phone from '@lucide/svelte/icons/phone';
	import { formatThaiShortDate } from '$lib/utils/date';
	import { assignmentAttendance } from '../domain/applicant-attendance';
	import type { StaffHistoryEntry } from '../domain/applicant-board';
	import ShiftAttendanceAction from './shift-attendance-action.svelte';

	let {
		entry,
		shift = null,
		today
	}: {
		entry: StaffHistoryEntry;
		/** The job's sub-shift this assignment points at; `null` when it no longer exists. */
		shift?: { label: string; start_time: string; end_time: string } | null;
		/** `YYYY-MM-DD` in Asia/Bangkok. */
		today: string;
	} = $props();

	const assignment = $derived(entry.assignment);
	const person = $derived(entry.person);
	const attendance = $derived(
		assignmentAttendance(assignment, entry.volunteer?.identity_verified ?? false, today)
	);
</script>

<li class="space-y-2.5 rounded-xl border border-border bg-muted/40 p-3.5">
	<div class="flex flex-wrap items-start justify-between gap-2">
		<div class="flex min-w-0 flex-wrap items-center gap-2">
			{#if person.name}
				<span class="text-sm font-bold break-words text-foreground">{person.name}</span>
			{:else}
				<span class="text-sm font-bold text-muted-foreground"> ไม่พบข้อมูลอาสาสมัครในทะเบียน </span>
				<span class="font-mono text-xs break-all text-muted-foreground">
					{assignment.volunteer_id}
				</span>
			{/if}
		</div>
		<span
			class="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-bold text-sky-700 ring-1 ring-sky-200"
		>
			<ClipboardCheck class="h-3 w-3" />
			มอบหมายโดยเจ้าหน้าที่
		</span>
	</div>

	{#if person.code || person.phone}
		<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
			{#if person.code}
				<span class="inline-flex items-center gap-1.5">
					<IdCard class="h-3.5 w-3.5" />
					รหัสอาสาสมัคร: <span class="font-mono font-bold text-foreground">{person.code}</span>
				</span>
			{/if}
			{#if person.phone}
				<span class="inline-flex items-center gap-1.5">
					<Phone class="h-3.5 w-3.5" />
					{person.phone}
				</span>
			{/if}
		</div>
	{/if}

	<div
		class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs"
	>
		<span class="inline-flex flex-wrap items-center gap-x-3 gap-y-1 font-bold text-foreground">
			<span class="inline-flex items-center gap-1.5">
				<CalendarDays class="h-3.5 w-3.5 text-primary" />
				กะวันที่: {assignment.date}
			</span>
			{#if shift}
				<span class="inline-flex items-center gap-1.5">
					<Clock class="h-3.5 w-3.5 text-primary" />
					เวลา: {shift.start_time} - {shift.end_time} น.
				</span>
			{/if}
		</span>
		<span class="inline-flex flex-wrap items-center gap-2">
			{#if shift}
				<span class="text-2xs text-muted-foreground">{shift.label}</span>
			{/if}
			<ShiftAttendanceAction
				{attendance}
				volunteer={entry.volunteer}
				personName={person.name ?? assignment.volunteer_id}
				shiftLabel={shift
					? `${assignment.date} · ${shift.start_time} - ${shift.end_time} น.`
					: assignment.date}
			/>
		</span>
	</div>

	<p class="text-2xs text-muted-foreground">
		มอบหมายโดย {assignment.created_by} · {formatThaiShortDate(assignment.created_at)}
	</p>
</li>
