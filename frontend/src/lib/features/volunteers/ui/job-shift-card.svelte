<script lang="ts">
	/**
	 * One sub-shift row of the job detail "กะและตารางกะ" tab (approved mockup
	 * 2026-08-27).
	 *
	 * The 3-colour split shown here comes from
	 * `domain/capacity.ts#jobShiftQuotaSplits` (computed once for the whole job
	 * by the parent and passed in) — this component performs no capacity maths
	 * of its own. Note the documented approximation in that function: per-shift
	 * TOTALS reconcile with the job doc, but which shift holds a given seat is a
	 * best guess until `shift_assignment` carries a `job_shift_id`.
	 */
	import X from '@lucide/svelte/icons/x';
	import Pencil from '@lucide/svelte/icons/pencil';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import Clock from '@lucide/svelte/icons/clock';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import UserRound from '@lucide/svelte/icons/user-round';
	import UserMinus from '@lucide/svelte/icons/user-minus';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import type { ShiftQuotaSplit } from '../domain/capacity';
	import type { JobShift } from '../domain/job.schema';
	import { SHIFT_ASSIGNMENT_STATUS_LABEL, type ShiftRosterEntry } from '../domain/shift-roster';

	let {
		shift,
		split,
		roster,
		canRemove,
		pending = false,
		onedit,
		onremove,
		onassign,
		onunassign
	}: {
		shift: JobShift;
		split: ShiftQuotaSplit;
		/** Volunteers currently on this exact sub-shift — `domain/shift-roster.ts#shiftRoster`. */
		roster: ShiftRosterEntry[];
		/** A job must keep at least one sub-shift (`jobSchema.shifts.min(1)`). */
		canRemove: boolean;
		pending?: boolean;
		/** Opens the edit dialog for THIS shift. */
		onedit: (shiftId: string) => void;
		onremove: (shiftId: string) => void;
		/** Opens the assign screen on THIS shift. */
		onassign: (shiftId: string) => void;
		/** Removes one volunteer (by `shift_assignment._id`) from this shift. */
		onunassign: (entry: ShiftRosterEntry) => void;
	} = $props();

	const total = $derived(split.target > 0 ? split.target : 1);
	const crossesMidnight = $derived(shift.end_date !== shift.date);
</script>

<div class="flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-card p-3.5 shadow-xs">
	<div class="flex items-start justify-between gap-2">
		<div class="min-w-0">
			<p class="inline-flex items-center gap-1.5 text-sm font-bold text-foreground">
				<CalendarDays class="h-3.5 w-3.5 text-primary" />
				{shift.date}
			</p>
			<p class="mt-0.5 inline-flex items-center gap-1.5 text-xs font-medium text-primary">
				<Clock class="h-3.5 w-3.5" />
				{shift.start_time} - {shift.end_time} น.
				{#if crossesMidnight}
					<span class="text-muted-foreground">(ถึง {shift.end_date})</span>
				{/if}
			</p>
		</div>

		<div class="flex shrink-0 items-center gap-0.5">
			<Tooltip.Provider>
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								size="icon"
								variant="ghost"
								class="h-7 w-7 shrink-0"
								disabled={pending}
								onclick={() => onedit(shift.id)}
							>
								<Pencil class="h-3.5 w-3.5" />
							</Button>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content>แก้ไขวัน เวลา และจำนวนคนของกะนี้</Tooltip.Content>
				</Tooltip.Root>
			</Tooltip.Provider>

			{#if canRemove}
				<Tooltip.Provider>
					<Tooltip.Root>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<Button
									{...props}
									size="icon"
									variant="ghost"
									class="h-7 w-7 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
									disabled={pending}
									onclick={() => onremove(shift.id)}
								>
									<X class="h-4 w-4" />
								</Button>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content>ลบกะนี้ออกจากงาน</Tooltip.Content>
					</Tooltip.Root>
				</Tooltip.Provider>
			{/if}
		</div>
	</div>

	<div>
		<div class="flex h-2 w-full overflow-hidden rounded-full bg-muted">
			<div class="h-full bg-emerald-500" style:width="{(split.confirmed / total) * 100}%"></div>
			<div class="h-full bg-amber-400" style:width="{(split.dispatched / total) * 100}%"></div>
		</div>
		<div class="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
			<span
				class="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-muted-foreground"
			>
				<span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
				ตอบรับแล้ว: <span class="font-bold text-foreground tabular-nums">{split.confirmed}</span>
			</span>
			<span
				class="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-muted-foreground"
			>
				<span class="h-1.5 w-1.5 rounded-full bg-amber-400"></span>
				เสนอแล้ว: <span class="font-bold text-foreground tabular-nums">{split.dispatched}</span>
			</span>
			<span
				class="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-muted-foreground"
			>
				<span class="h-1.5 w-1.5 rounded-full bg-muted-foreground/40"></span>
				ยังขาดอีก: <span class="font-bold text-foreground tabular-nums">{split.remaining}</span>
			</span>
			<span class="ml-auto text-muted-foreground">(เป้า {split.target} คน)</span>
		</div>
	</div>

	{#if roster.length > 0}
		<div class="space-y-1.5 border-t border-border pt-2.5">
			<p class="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
				<UserRound class="h-3.5 w-3.5" />
				อาสาในกะนี้ ({roster.length} คน)
			</p>
			<ul class="space-y-1">
				{#each roster as entry (entry.assignmentId)}
					<li
						class="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-2.5 py-1.5 text-xs"
					>
						<span class="min-w-0 truncate">
							<span class="font-medium text-foreground">{entry.volunteerName}</span>
							<span class="text-muted-foreground"> · {entry.volunteerCode}</span>
						</span>
						<span class="flex shrink-0 items-center gap-1.5">
							<span class="text-2xs text-muted-foreground">
								{SHIFT_ASSIGNMENT_STATUS_LABEL[entry.status]}
							</span>
							{#if entry.status === 'assigned' || entry.status === 'standby'}
								<Tooltip.Provider>
									<Tooltip.Root>
										<Tooltip.Trigger>
											{#snippet child({ props })}
												<Button
													{...props}
													size="icon"
													variant="ghost"
													class="h-6 w-6 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
													disabled={pending}
													aria-label={`ลบ ${entry.volunteerName} ออกจากกะนี้`}
													onclick={() => onunassign(entry)}
												>
													<UserMinus class="h-3.5 w-3.5" />
												</Button>
											{/snippet}
										</Tooltip.Trigger>
										<Tooltip.Content>ลบออกจากกะนี้</Tooltip.Content>
									</Tooltip.Root>
								</Tooltip.Provider>
							{/if}
						</span>
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	<Button
		variant="default"
		size="sm"
		class="w-full gap-1.5"
		disabled={pending}
		onclick={() => onassign(shift.id)}
	>
		<UserPlus class="h-3.5 w-3.5" />
		มอบหมายอาสาในกะนี้ (Assign)
	</Button>
</div>
