<script lang="ts">
	/**
	 * The quota block of a job board card (#1521): every shift's fill, emptiest first, in a box
	 * that scrolls past four rows so a job of 180 shifts keeps the card's height. No whole-job
	 * total: a summed count hides which shift is short. Same buckets as the summary bar.
	 */
	import { jobShiftAttention, jobShiftCapacities, type FillBucket } from '../domain/capacity';
	import type { Job } from '../domain/job.schema';
	import type { ShiftAssignment } from '../domain/shift-assignment.schema';
	import { formatThaiShortDate } from '$lib/utils/date';

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
			job.shifts.length
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
	<p class="mb-2 text-[11px] font-semibold text-muted-foreground">ความคืบหน้าโควตา</p>
	<ul
		data-testid="shift-attention-list"
		class="max-h-36 space-y-1.5 overflow-y-auto pr-1"
		aria-label="ความคืบหน้ารายกะ"
	>
		{#each attention.rows as row (row.id)}
			<li
				data-testid="shift-attention-row"
				data-shift-id={row.id}
				class="grid grid-cols-[1fr_auto] items-center gap-x-2 text-[11px]"
			>
				<span class="truncate text-foreground tabular-nums">
					{formatThaiShortDate(row.date)} · {row.start_time}–{row.end_time}
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
</div>
