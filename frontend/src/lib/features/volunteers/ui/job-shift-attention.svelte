<script lang="ts">
	/**
	 * The quota block of a job board card (#1521): one total bar plus one line saying how the
	 * job's shifts split — the same two lines for a job of 1 shift or 180, so every card keeps
	 * one height. Which shift is short, and on which day, is on the job detail screen. Same
	 * buckets as the summary bar.
	 */
	import { jobShiftAttention, jobShiftCapacities, type FillBucket } from '../domain/capacity';
	import type { Job } from '../domain/job.schema';
	import type { ShiftAssignment } from '../domain/shift-assignment.schema';
	import JobQuotaBar from './job-quota-bar.svelte';

	let {
		job,
		assignments
	}: {
		job: Job;
		/** Exact roster when loaded; else the job's projected counts, like the summary bar. */
		assignments?: readonly ShiftAssignment[];
	} = $props();

	const attention = $derived.by(() => {
		const capacities = jobShiftCapacities(job, assignments);
		return jobShiftAttention(
			job.shifts.map((shift, i) => ({
				id: shift.id,
				date: shift.date,
				start_time: shift.start_time,
				end_time: shift.end_time,
				quota: shift.quota,
				confirmed: capacities[i]?.confirmed ?? 0
			})),
			0
		);
	});

	const PILLS: { bucket: FillBucket; label: string; class: string }[] = [
		{ bucket: 'critical', label: 'ขาดหนัก', class: 'bg-red-50 text-red-700' },
		{ bucket: 'near', label: 'ใกล้ครบ', class: 'bg-amber-50 text-amber-700' },
		{ bucket: 'met', label: 'ครบ', class: 'bg-emerald-50 text-emerald-700' }
	];
</script>

<div class="rounded-xl bg-muted/35 p-3">
	<div class="mb-2 flex items-center justify-between gap-2">
		<span class="text-[11px] font-semibold text-muted-foreground">ความคืบหน้าโควตา</span>
		<span class="text-xs font-bold text-foreground tabular-nums">
			{attention.totalConfirmed}/{attention.totalTarget}
		</span>
	</div>
	<JobQuotaBar {job} confirmedCount={attention.totalConfirmed} />
	<p class="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
		<span class="font-medium text-foreground">{attention.total} กะ</span>
		{#each PILLS as pill (pill.bucket)}
			{#if attention.counts[pill.bucket] > 0}
				<span
					data-testid="shift-bucket-pill"
					class="rounded-full px-2 py-0.5 font-semibold {pill.class}"
				>
					{pill.label}
					{attention.counts[pill.bucket]}
				</span>
			{/if}
		{/each}
	</p>
</div>
