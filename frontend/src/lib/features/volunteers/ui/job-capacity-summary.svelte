<script lang="ts">
	/**
	 * KPI summary bar (CR-094 FR-VOL-09.4): overall shift booking rate + counts by
	 * fill bucket. Computed at SHIFT level via `domain/capacity.ts`; when the
	 * assignment query is ready, each bucket uses the exact `job_id + shift_id`
	 * roster rather than allocating the job total across shifts.
	 *
	 * Paused, draft, closed and cancelled jobs are excluded from the capacity
	 * buckets — jobs that are not currently being filled have no meaningful
	 * "shortage", so counting them would misrepresent live capacity.
	 *
	 * Clicking a bucket card filters the job board below via `onselect`.
	 */
	import TrendingUp from '@lucide/svelte/icons/trending-up';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Gauge from '@lucide/svelte/icons/gauge';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import * as Card from '$lib/components/ui/card/index.js';
	import {
		bucketCounts,
		isCapacityTrackedJobStatus,
		jobShiftCapacities,
		overallBookingRate,
		type FillBucket
	} from '../domain/capacity';
	import type { Job } from '../domain/job.schema';
	import type { ShiftAssignment } from '../domain/shift-assignment.schema';

	let {
		jobs,
		assignments,
		selected = null,
		onselect
	}: {
		jobs: readonly Job[];
		assignments?: readonly ShiftAssignment[];
		selected?: FillBucket | null;
		onselect: (bucket: FillBucket | null) => void;
	} = $props();

	/** Only jobs currently accepting or reporting capacity (paused jobs are excluded). */
	const capacityJobs = $derived(jobs.filter((j) => isCapacityTrackedJobStatus(j.status)));
	// One bucket per sub-shift — FR-VOL-09.4 counts "กะ", not jobs.
	const capacities = $derived(capacityJobs.flatMap((j) => jobShiftCapacities(j, assignments)));
	const overallRate = $derived(overallBookingRate(capacities));
	const counts = $derived(bucketCounts(capacities));

	function toggle(bucket: FillBucket) {
		onselect(selected === bucket ? null : bucket);
	}
</script>

<p class="mb-2 text-xs text-muted-foreground" data-testid="capacity-scope">
	นับเป็นรายกะ จากงานที่เปิดรับอยู่ {capacityJobs.length} งาน ({capacities.length} กะ)
</p>
<div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
	<Card.Root class="gap-0 border-0 py-0 shadow-sm">
		<Card.Content class="flex items-center gap-2.5 px-3 py-2.5">
			<div class="rounded-lg bg-primary/10 p-1.5">
				<TrendingUp class="h-4 w-4 text-primary" />
			</div>
			<div class="min-w-0">
				<p class="text-xs text-muted-foreground">อัตราจองรวมทุกกะ</p>
				<p class="text-lg leading-tight font-bold">{Math.round(overallRate * 100)}%</p>
			</div>
		</Card.Content>
	</Card.Root>

	<button type="button" class="text-left" onclick={() => toggle('critical')}>
		<Card.Root
			class="gap-0 border-0 py-0 shadow-sm transition-shadow {selected === 'critical'
				? 'ring-2 ring-destructive'
				: 'hover:shadow-md'}"
		>
			<Card.Content class="flex items-center gap-2.5 px-3 py-2.5">
				<div class="rounded-lg bg-destructive/10 p-1.5">
					<AlertTriangle class="h-4 w-4 text-destructive" />
				</div>
				<div class="min-w-0">
					<p class="text-xs text-muted-foreground">กะขาดแคลนหนัก (&lt;50%)</p>
					<p class="text-lg leading-tight font-bold text-destructive">{counts.critical}</p>
				</div>
			</Card.Content>
		</Card.Root>
	</button>

	<button type="button" class="text-left" onclick={() => toggle('near')}>
		<Card.Root
			class="gap-0 border-0 py-0 shadow-sm transition-shadow {selected === 'near'
				? 'ring-2 ring-amber-500'
				: 'hover:shadow-md'}"
		>
			<Card.Content class="flex items-center gap-2.5 px-3 py-2.5">
				<div class="rounded-lg bg-amber-500/10 p-1.5">
					<Gauge class="h-4 w-4 text-amber-600" />
				</div>
				<div class="min-w-0">
					<p class="text-xs text-muted-foreground">กะใกล้ครบเป้า (50–99%)</p>
					<p class="text-lg leading-tight font-bold text-amber-600">{counts.near}</p>
				</div>
			</Card.Content>
		</Card.Root>
	</button>

	<button type="button" class="text-left" onclick={() => toggle('met')}>
		<Card.Root
			class="gap-0 border-0 py-0 shadow-sm transition-shadow {selected === 'met'
				? 'ring-2 ring-emerald-500'
				: 'hover:shadow-md'}"
		>
			<Card.Content class="flex items-center gap-2.5 px-3 py-2.5">
				<div class="rounded-lg bg-emerald-500/10 p-1.5">
					<CheckCircle2 class="h-4 w-4 text-emerald-600" />
				</div>
				<div class="min-w-0">
					<p class="text-xs text-muted-foreground">กะครบตามเป้า (100%)</p>
					<p class="text-lg leading-tight font-bold text-emerald-600">{counts.met}</p>
				</div>
			</Card.Content>
		</Card.Root>
	</button>
</div>
