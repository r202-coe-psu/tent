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

	interface JobTag {
		label: string;
		variant: 'default' | 'success' | 'warning' | 'purple' | 'outline';
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
			tags: JobTag[];
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

	let isControlled = $derived(
		job.tags.some(
			(tg: JobTag) =>
				tg.variant === 'purple' || tg.label.includes('ควบคุม') || tg.label.includes('แพทย์')
		)
	);
</script>

<div
	class="overflow-hidden rounded-3xl border border-border bg-card shadow-sm transition-shadow hover:shadow-lg"
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
					{tag.variant === 'default' ? 'bg-primary/10 text-primary' : ''}
					{tag.variant === 'success' ? 'bg-success/15 text-success' : ''}
					{tag.variant === 'warning' ? 'bg-warning/15 text-warning-foreground' : ''}
					{tag.variant === 'purple' ? 'bg-purple-500/15 text-purple-600' : ''}
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

			<div class="flex items-center gap-1.5 text-xs text-muted-foreground">
				<MapPin class="h-3.5 w-3.5 text-primary" />
				<span class="font-medium text-foreground">{job.shelter}</span>
			</div>
		</div>

		<h3 class="mb-2 text-xl leading-tight font-bold text-foreground">{job.title}</h3>
		<p class="line-clamp-1 text-sm leading-relaxed text-muted-foreground">{job.description}</p>
	</div>

	<!-- Shifts & Quota Section -->
	<div class="p-5 sm:p-6">
		<div
			class="mb-4 flex flex-col justify-between gap-2 border-b border-border/50 pb-4 sm:flex-row sm:items-center"
		>
			<span class="flex items-center gap-2 text-sm font-bold text-primary">
				<CalendarDays class="h-4.5 w-4.5" />
				{t.shiftsAndQuota} ({job.shifts.length}
				{t.shiftsUnit})
			</span>
			<span class="text-xs font-bold text-muted-foreground"
				>{t.totalApplied}
				{totalApplicants}
				{t.peopleUnit} · {t.requiredQuota}
				{totalQuota}
				{t.peopleUnit} ({t.availableSeats}
				{totalRemaining}
				{t.seatsUnit})</span
			>
		</div>

		<div class="grid gap-3 md:grid-cols-2">
			{#each job.shifts as shift (shift.id)}
				{@const remaining = Math.max(0, shift.quota - shift.confirmed)}
				{@const isFull = remaining <= 0}
				{@const isBlocked = Boolean(shift.conflict)}
				{@const applicants = Math.max(shift.applicants_count ?? 0, shift.confirmed)}
				<div
					class="rounded-2xl border p-4 shadow-xs transition-colors {isFull || isBlocked
						? 'border-border/60 bg-muted/10 opacity-90'
						: 'border-border bg-card hover:border-primary/30'}"
				>
					<div class="mb-4">
						<div class="mb-1.5 flex items-center justify-between">
							<span
								class="text-base font-bold {isFull ? 'text-muted-foreground' : 'text-foreground'}"
								>{shift.date}</span
							>
							{#if isBlocked}
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
							class="flex items-center gap-1.5 text-sm font-medium {isFull
								? 'text-muted-foreground'
								: 'text-primary'}"
						>
							<Clock class="h-4 w-4" />
							{shift.time}
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
										{shift.conflict.title} · {shift.conflict.time}
									</p>
								</div>
							</div>
						</div>
					{/if}

					<!-- Quota Bar -->
					<div class="mb-5">
						<div class="mb-2 flex justify-between text-xs">
							<span class="font-medium {isFull ? 'text-muted-foreground/80' : ''}"
								>{t.quotaCap}
								{shift.quota}
								{t.peopleUnit} ({t.appliedCount}
								{applicants} · {t.confirmedCount}
								{shift.confirmed})</span
							>
							<span class="font-bold {isFull ? 'text-muted-foreground' : 'text-success'}"
								>{isFull ? t.fullSeats : `${t.availableSeats} ${remaining} ${t.seatsUnit}`}</span
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
						disabled={isFull || isBlocked}
						class="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold shadow-xs transition-all {isFull ||
						isBlocked
							? 'cursor-not-allowed border border-border/80 bg-muted text-muted-foreground opacity-70 select-none'
							: 'hover:bg-opacity-90 cursor-pointer bg-primary text-white active:scale-[0.98]'}"
					>
						{#if isBlocked}
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
	</div>
</div>
