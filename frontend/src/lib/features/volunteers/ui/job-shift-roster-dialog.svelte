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
	import Phone from '@lucide/svelte/icons/phone';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import LogIn from '@lucide/svelte/icons/log-in';
	import LogOut from '@lucide/svelte/icons/log-out';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import type { JobShift } from '../domain/job.schema';
	import {
		DISPATCH_STATUS_LABEL,
		SHIFT_ASSIGNMENT_STATUS_LABEL,
		type ShiftRosterEntry
	} from '../domain/shift-roster';

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

	function formatTs(ts: string): string {
		return new Date(ts).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
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

		<div class="flex-1 space-y-2.5 overflow-y-auto px-6 py-4">
			{#if roster.length === 0}
				<p class="py-10 text-center text-sm text-muted-foreground">ยังไม่มีอาสาในกะนี้</p>
			{:else}
				{#each roster as entry (entry.assignmentId)}
					<div class="rounded-xl border border-border bg-muted/30 p-3">
						<div class="flex items-start justify-between gap-2">
							<div class="min-w-0">
								<p class="truncate text-sm font-bold text-foreground">
									{entry.volunteerName}
									<span class="font-normal text-muted-foreground">· {entry.volunteerCode}</span>
								</p>
								<div class="mt-1 flex flex-wrap items-center gap-1.5">
									<span
										class="inline-flex items-center rounded-full border border-border bg-background px-2 py-0.5 text-2xs font-medium text-foreground"
									>
										{SHIFT_ASSIGNMENT_STATUS_LABEL[entry.status]}
									</span>
									{#if entry.dispatchStatus}
										<span
											class="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-2xs font-medium text-amber-700"
										>
											{DISPATCH_STATUS_LABEL[entry.dispatchStatus]}
										</span>
									{/if}
								</div>
							</div>
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
						</div>

						<div
							class="mt-2.5 grid grid-cols-1 gap-1.5 border-t border-border pt-2.5 text-xs sm:grid-cols-2"
						>
							<p class="flex items-center gap-1.5 text-muted-foreground">
								<MapPin class="h-3.5 w-3.5 shrink-0" />
								จุดปฏิบัติงาน:
								<span class="font-medium text-foreground">{entry.station}</span>
							</p>
							<p class="flex items-center gap-1.5 text-muted-foreground">
								<Phone class="h-3.5 w-3.5 shrink-0" />
								เบอร์โทร:
								<span class="font-medium text-foreground">{entry.phone ?? '—'}</span>
							</p>
							<p class="flex items-center gap-1.5 text-muted-foreground">
								<LogIn class="h-3.5 w-3.5 shrink-0" />
								เช็คอิน:
								<span class="font-medium text-foreground">
									{entry.checkInAt ? formatTs(entry.checkInAt) : 'ยังไม่เช็คอิน'}
								</span>
							</p>
							<p class="flex items-center gap-1.5 text-muted-foreground">
								<LogOut class="h-3.5 w-3.5 shrink-0" />
								เช็คเอาต์:
								<span class="font-medium text-foreground">
									{entry.checkOutAt ? formatTs(entry.checkOutAt) : 'ยังไม่เช็คเอาต์'}
								</span>
							</p>
						</div>
					</div>
				{/each}
			{/if}
		</div>

		<div class="flex justify-end border-t border-border px-6 py-3">
			<Button variant="outline" onclick={() => (open = false)}>ปิดหน้าต่าง</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
