<script lang="ts">
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Clock from '@lucide/svelte/icons/clock';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import Tag from '@lucide/svelte/icons/tag';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { languageStore } from '$lib/stores/language.svelte';
	import { jobsI18n } from '$lib/features/volunteers/i18n/jobs.i18n';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { sortShifts, summariseHiddenShifts } from '../domain/shift-summary';
	import { formatShiftDate } from '../domain/shift-picker';

	interface JobTag {
		label: string;
		variant: 'success' | 'warning' | 'outline';
	}

	interface JobShift {
		id: string;
		date: string;
		time: string;
		quota: number;
		confirmed: number;
		applicants_count?: number;
		conflict?: {
			title: string;
			time: string;
		};
	}

	let { job, onApply } = $props<{
		job: {
			id: string;
			title: string;
			shelter: string;
			description: string;
			shifts: JobShift[];
			closed?: boolean;
			tags: JobTag[];
			skills: { value: string; label: string }[];
			isControlled: boolean;
			applicants_count?: number;
		};
		onApply: (jobId: string, shiftId: string) => void;
	}>();

	const t = $derived(jobsI18n[languageStore.current]);

	let totalQuota = $derived(job.shifts.reduce((sum: number, s: JobShift) => sum + s.quota, 0));
	let totalConfirmed = $derived(
		job.shifts.reduce((sum: number, s: JobShift) => sum + s.confirmed, 0)
	);
	let totalRemaining = $derived(Math.max(0, totalQuota - totalConfirmed));
	let totalApplicants = $derived(
		Math.max(
			job.applicants_count ?? 0,
			totalConfirmed,
			job.shifts.reduce(
				(sum: number, s: JobShift) => sum + Math.max(s.applicants_count ?? 0, s.confirmed),
				0
			)
		)
	);

	const isControlled = $derived(job.isControlled);

	/**
	 * A job batch-generated over weeks has dozens of shifts, each a full block, so the card
	 * ran several screens long. Collapsed, it shows the first shifts in full — 3 on a
	 * phone, 4 (two rows) from `md` — and summarises the rest: which dates and times.
	 */
	const SHOWN_PHONE = 3;
	const SHOWN_WIDE = 4;
	let showAllShifts = $state(false);
	const sortedShifts = $derived(sortShifts<JobShift>(job.shifts));
	const hiddenPhone = $derived(summariseHiddenShifts(sortedShifts, SHOWN_PHONE));
	const hiddenWide = $derived(summariseHiddenShifts(sortedShifts, SHOWN_WIDE));
	const shiftListId = $derived(`job-shifts-${job.id}`);

	const dateLocale = $derived(languageStore.current === 'en' ? 'en-GB' : 'th-TH');
	function shortDateLabel(date: string): string {
		return formatShiftDate(date, dateLocale, { weekday: 'short', day: 'numeric', month: 'short' });
	}
</script>

{#snippet hiddenSummary(summary: ReturnType<typeof summariseHiddenShifts>)}
	<div class="space-y-2.5 rounded-2xl border border-dashed border-border bg-muted/20 p-4">
		<p class="text-sm font-bold text-foreground">
			{t.moreShiftsPrefix}
			{summary.count}
			{t.shiftsUnit}
			{t.moreShiftsIn}
			{summary.dates.length}
			{t.daysUnit}
		</p>
		<div class="space-y-1">
			<p class="text-xs font-semibold text-muted-foreground">{t.moreShiftsDates}</p>
			<ul class="flex flex-wrap gap-1.5">
				{#each summary.dates as day (day.date)}
					<li
						class="rounded-md border px-2 py-0.5 text-xs font-semibold whitespace-nowrap {day.open
							? 'border-border bg-card text-foreground'
							: 'border-border/60 bg-muted text-muted-foreground line-through'}"
					>
						{shortDateLabel(day.date)}
						{#if !day.open}<span class="sr-only">({t.fullBadge})</span>{/if}
					</li>
				{/each}
			</ul>
		</div>
		<div class="space-y-1">
			<p class="text-xs font-semibold text-muted-foreground">{t.moreShiftsTimes}</p>
			<p class="flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold text-primary tabular-nums">
				{#each summary.times as time (time)}
					<span class="inline-flex items-center gap-1 whitespace-nowrap">
						<Clock class="h-3.5 w-3.5" />{time}
					</span>
				{/each}
			</p>
		</div>
	</div>
{/snippet}

<div
	class="flex h-full flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-sm transition-shadow hover:shadow-lg"
>
	<!-- Header w/ Tags -->
	<div class="border-b border-border/70 bg-muted/20 p-5 sm:p-6">
		<div class="mb-4 flex flex-wrap items-center justify-between gap-4">
			<div class="flex flex-wrap items-center gap-2">
				<!-- Tier Badge -->
				{#if isControlled}
					<span
						class="inline-flex items-center gap-1.5 rounded-full border border-accent-purple/30 bg-accent-purple/10 px-3 py-1 text-xs font-bold text-accent-purple"
					>
						<ShieldAlert class="h-3.5 w-3.5" />
						{t.controlledMission}
					</span>
				{:else}
					<span
						class="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-bold text-primary"
					>
						<Sparkles class="h-3.5 w-3.5" />
						{t.generalMission}
					</span>
				{/if}

				{#each job.tags as tag (tag.label)}
					<span
						class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium
					{tag.variant === 'success' ? 'bg-success/15 text-success' : ''}
					{tag.variant === 'warning' ? 'bg-warning/15 text-warning-foreground' : ''}
					{tag.variant === 'outline' ? 'border border-border bg-muted/30 text-muted-foreground' : ''}"
					>
						{#if tag.variant === 'success'}
							<span class="h-2 w-2 rounded-full bg-success"></span>
						{:else if tag.variant === 'outline'}
							<Pencil class="h-3.5 w-3.5" />
						{:else}
							<Tag class="h-3 w-3" />
						{/if}
						{tag.label}
					</span>
				{/each}
			</div>

			<div class="flex max-w-full min-w-0 items-start gap-1.5 text-xs text-muted-foreground">
				<MapPin class="h-3.5 w-3.5 text-primary" />
				<span class="min-w-0 font-medium break-words text-foreground">{job.shelter}</span>
			</div>
		</div>

		{#if job.skills.length > 0}
			<div class="border-t border-border/60 pt-3">
				<div class="mb-2 flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
					<Tag class="h-3.5 w-3.5 text-primary" />
					<span>{t.cardSkillsTitle}</span>
				</div>
				<div class="flex flex-wrap gap-1.5">
					{#each job.skills as skill (skill.value)}
						<span
							class="rounded-lg border border-border/80 bg-muted/30 px-2.5 py-1 text-xs font-medium text-foreground"
						>
							{skill.label}
						</span>
					{/each}
				</div>
			</div>
		{/if}

		<h3 class="my-2 text-xl leading-tight font-bold break-words text-foreground">{job.title}</h3>
		<p class="line-clamp-1 text-sm leading-relaxed text-muted-foreground">{job.description}</p>
	</div>

	<!-- Shifts & Quota Section -->
	<div class="flex flex-1 flex-col p-5 sm:p-6">
		<div class="mb-4 flex w-full flex-col gap-2 border-b border-border/50 pb-4">
			<span class="flex w-full items-center gap-2 text-sm font-bold text-primary">
				<CalendarDays class="h-4.5 w-4.5" />
				{t.shiftsAndQuota} ({job.shifts.length}
				{t.shiftsUnit})
			</span>
			<span class="block w-full text-xs leading-relaxed font-bold text-muted-foreground"
				>{t.totalApplied}
				{totalApplicants}
				{t.peopleUnit} · {t.requiredQuota}
				{totalQuota}
				{t.peopleUnit} ({t.availableSeats}
				{totalRemaining}
				{t.seatsUnit})</span
			>
		</div>

		<div id={shiftListId} class="grid gap-3 md:grid-cols-2">
			{#each sortedShifts as shift, index (shift.id)}
				{@const remaining = Math.max(0, shift.quota - shift.confirmed)}
				{@const isFull = remaining <= 0}
				{@const isClosed = job.closed === true}
				{@const isBlocked = Boolean(shift.conflict)}
				{@const applicants = Math.max(shift.applicants_count ?? 0, shift.confirmed)}
				<div
					class={[
						'rounded-2xl border p-4 shadow-xs transition-colors',
						isFull || isBlocked || isClosed
							? 'border-border/60 bg-muted/10 opacity-90'
							: 'border-border bg-card hover:border-primary/30',
						!showAllShifts && index >= SHOWN_WIDE && 'hidden',
						!showAllShifts && index >= SHOWN_PHONE && index < SHOWN_WIDE && 'hidden md:block'
					]}
				>
					<div class="mb-4">
						<div class="mb-1.5 flex items-center justify-between">
							<span
								class="text-base font-bold {isFull || isClosed
									? 'text-muted-foreground'
									: 'text-foreground'}">{shift.date}</span
							>
							{#if isClosed}
								<span
									class="rounded-md border border-border/60 bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground"
									>{t.tagClosed}</span
								>
							{:else if isBlocked}
								<span
									class="rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-800"
									>เวลาชน</span
								>
							{:else if isFull}
								<span
									class="rounded-md border border-border/60 bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground"
									>{t.fullBadge}</span
								>
							{:else}
								<span class="rounded-md bg-success/15 px-2 py-0.5 text-xs font-bold text-success"
									>{t.openBadge}</span
								>
							{/if}
						</div>
						<div
							class="flex items-center gap-1.5 text-sm font-medium {isFull || isClosed
								? 'text-muted-foreground'
								: 'text-primary'}"
						>
							<Clock class="h-4 w-4" />
							{shift.time}{t.timeSuffix}
						</div>
					</div>

					{#if shift.conflict}
						<div
							class="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950"
						>
							<div class="flex items-start gap-2">
								<TriangleAlert class="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
								<div class="min-w-0">
									<p class="font-bold">เวลาชนกับกะที่จองไว้</p>
									<p class="mt-1 line-clamp-2 leading-relaxed">
										{shift.conflict.title} · {shift.conflict.time}{t.timeSuffix}
									</p>
								</div>
							</div>
						</div>
					{/if}

					<!-- Quota Bar -->
					<div class="mb-5">
						<div class="mb-2 space-y-1 text-xs">
							<div class="flex items-center justify-between gap-2 whitespace-nowrap">
								<span class="font-medium {isFull || isClosed ? 'text-muted-foreground/80' : ''}"
									>{t.quotaCap} {shift.quota} {t.peopleUnit}</span
								>
								<span
									class="shrink-0 font-bold {isFull || isClosed
										? 'text-muted-foreground'
										: 'text-success'}"
									>{isFull ? t.fullSeats : `${t.availableSeats} ${remaining} ${t.seatsUnit}`}</span
								>
							</div>
							<span class="block whitespace-nowrap text-muted-foreground"
								>{t.appliedCount} {applicants} · {t.confirmedCount} {shift.confirmed}</span
							>
						</div>
						<div class="h-2 w-full overflow-hidden rounded-full bg-muted">
							<div
								class="h-full {isFull
									? 'bg-muted-foreground/35'
									: 'bg-success'} transition-all duration-500 ease-out"
								style="width: {isFull ? 100 : (shift.confirmed / shift.quota) * 100}%"
							></div>
						</div>
					</div>

					<button
						onclick={() => onApply(job.id, shift.id)}
						disabled={isFull || isBlocked || isClosed}
						class="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold shadow-xs transition-all {isFull ||
						isBlocked ||
						isClosed
							? 'cursor-not-allowed border border-border/80 bg-muted text-muted-foreground opacity-70 select-none'
							: 'cursor-pointer bg-primary text-white hover:bg-primary/90 active:scale-[0.98]'}"
					>
						{#if isClosed}
							{t.tagClosed}
						{:else if isBlocked}
							เวลาชนกับกะนี้
						{:else if isFull}
							{t.shiftFull}
						{:else}
							{t.applyShift}
						{/if}
					</button>
				</div>
			{/each}
		</div>

		{#if sortedShifts.length > SHOWN_PHONE}
			<div class="mt-3 space-y-3 {sortedShifts.length <= SHOWN_WIDE ? 'md:hidden' : ''}">
				{#if !showAllShifts}
					<div class="md:hidden">{@render hiddenSummary(hiddenPhone)}</div>
					{#if hiddenWide.count > 0}
						<div class="hidden md:block">{@render hiddenSummary(hiddenWide)}</div>
					{/if}
				{/if}
				<button
					type="button"
					aria-expanded={showAllShifts}
					aria-controls={shiftListId}
					onclick={() => (showAllShifts = !showAllShifts)}
					class="flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-bold text-primary transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
				>
					{showAllShifts
						? t.collapseShifts
						: `${t.showAllShifts} (${sortedShifts.length} ${t.shiftsUnit})`}
					<ChevronDown class="h-4 w-4 transition-transform {showAllShifts ? 'rotate-180' : ''}" />
				</button>
			</div>
		{/if}
	</div>
</div>
