<script lang="ts">
	/**
	 * What a job board card says about a multi-shift job (#1521): the emptiest shifts first,
	 * capped at three so the card keeps one height whether the job has 4 shifts or 180 (a batch
	 * makes up to 180). Every shift is on the job detail screen. Same buckets as the summary bar.
	 */
	import { jobShiftAttention, jobShiftCapacities, type FillBucket } from '../domain/capacity';
	import type { Job } from '../domain/job.schema';
	import type { ShiftAssignment } from '../domain/shift-assignment.schema';

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
			}))
		);
	});

	const BAR: Record<FillBucket, string> = {
		critical: 'bg-red-500',
		near: 'bg-amber-500',
		met: 'bg-emerald-500'
	};
	const TEXT: Record<FillBucket, string> = {
		critical: 'text-red-700',
		near: 'text-amber-700',
		met: 'text-emerald-700'
	};
</script>

<div class="rounded-xl bg-muted/35 p-3">
	<div class="mb-2 flex items-center justify-between gap-2">
		<span class="text-[11px] font-semibold text-muted-foreground">ความคืบหน้าโควตา</span>
		<span class="text-[11px] text-muted-foreground tabular-nums">
			รวม {attention.totalConfirmed}/{attention.totalTarget}
		</span>
	</div>
	<p class="mb-2 text-[11px] text-muted-foreground">
		{attention.total} กะ:
		<span class="font-semibold text-red-700">ขาดหนัก {attention.counts.critical}</span>
		· <span class="font-semibold text-amber-700">ใกล้ครบ {attention.counts.near}</span>
		· <span class="font-semibold text-emerald-700">ครบ {attention.counts.met}</span>
	</p>
	<ul class="space-y-1.5">
		{#each attention.rows as row (row.id)}
			<li
				data-testid="shift-attention-row"
				data-shift-id={row.id}
				class="grid grid-cols-[1fr_auto] items-center gap-x-2 text-[11px]"
			>
				<span class="truncate text-foreground tabular-nums">
					{row.date} · {row.start_time}–{row.end_time}
				</span>
				<span class="font-semibold tabular-nums {TEXT[row.bucket]}">
					{row.confirmed}/{row.target}
					{#if row.missing > 0}(ขาด {row.missing}){/if}
				</span>
				<div class="col-span-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
					<div
						class="h-full {BAR[row.bucket]}"
						style:width="{row.target > 0
							? (Math.min(Math.max(row.confirmed, 0), row.target) / row.target) * 100
							: 0}%"
					></div>
				</div>
			</li>
		{/each}
	</ul>
	{#if attention.hidden > 0}
		<p class="mt-1.5 text-[11px] font-medium text-muted-foreground">
			และอีก {attention.hidden} กะ
		</p>
	{/if}
</div>
