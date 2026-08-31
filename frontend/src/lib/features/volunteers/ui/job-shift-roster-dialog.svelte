<script lang="ts">
	/**
	 * "อาสาในกะนี้" — modal view of one sub-shift's roster, opened from
	 * `job-shift-card.svelte`. Replaces the always-expanded inline list that
	 * used to live on the card (owner request 2026-08-31): a shift with a large
	 * roster no longer stretches every card in the grid.
	 *
	 * Pure presentation — `roster` is `domain/shift-roster.ts#shiftRoster`
	 * output computed once by the parent tab, same as the card it replaces.
	 */
	import UserRound from '@lucide/svelte/icons/user-round';
	import UserMinus from '@lucide/svelte/icons/user-minus';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import Clock from '@lucide/svelte/icons/clock';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import type { JobShift } from '../domain/job.schema';
	import { SHIFT_ASSIGNMENT_STATUS_LABEL, type ShiftRosterEntry } from '../domain/shift-roster';

	let {
		open = $bindable(false),
		shift,
		roster,
		pending = false,
		onunassign
	}: {
		open?: boolean;
		shift: JobShift | null;
		roster: ShiftRosterEntry[];
		pending?: boolean;
		onunassign: (entry: ShiftRosterEntry) => void;
	} = $props();

	const crossesMidnight = $derived(!!shift && shift.end_date !== shift.date);
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
		<div class="border-b border-border px-6 py-4">
			<Dialog.Title class="flex items-center gap-2 text-base font-bold">
				<UserRound class="h-4.5 w-4.5 text-primary" />
				อาสาในกะนี้ ({roster.length} คน)
			</Dialog.Title>
			{#if shift}
				<p class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
					<span class="inline-flex items-center gap-1">
						<CalendarDays class="h-3.5 w-3.5" />
						{shift.date}
					</span>
					<span class="inline-flex items-center gap-1">
						<Clock class="h-3.5 w-3.5" />
						{shift.start_time} - {shift.end_time} น.
						{#if crossesMidnight}
							(ถึง {shift.end_date})
						{/if}
					</span>
				</p>
			{/if}
		</div>

		<div class="flex-1 space-y-1.5 overflow-y-auto px-6 py-4">
			{#if roster.length === 0}
				<p class="py-10 text-center text-sm text-muted-foreground">ยังไม่มีอาสาในกะนี้</p>
			{:else}
				{#each roster as entry (entry.assignmentId)}
					<div
						class="flex items-center justify-between gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm"
					>
						<span class="min-w-0 truncate">
							<span class="font-medium text-foreground">{entry.volunteerName}</span>
							<span class="text-muted-foreground"> · {entry.volunteerCode}</span>
						</span>
						<span class="flex shrink-0 items-center gap-2">
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
													class="h-7 w-7 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
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
					</div>
				{/each}
			{/if}
		</div>

		<div class="flex justify-end border-t border-border px-6 py-3">
			<Button variant="outline" onclick={() => (open = false)}>ปิดหน้าต่าง</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
