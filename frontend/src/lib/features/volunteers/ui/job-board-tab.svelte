<script lang="ts">
	/**
	 * Tab 1 — "จัดการงานอาสา / Job Board & Capacity" (01-tab-job-board.md §01.3/01.4).
	 * Composes the KPI summary, filter chips, and the job card grid; owns the
	 * create/edit dialog. Later steps (dispatch, roster, walk-in) are out of
	 * scope here — the card's "ดูรายละเอียด" affordance stays disabled.
	 */
	import Plus from '@lucide/svelte/icons/plus';
	import Inbox from '@lucide/svelte/icons/inbox';
	import { SvelteMap } from 'svelte/reactivity';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import JobCapacitySummary from './job-capacity-summary.svelte';
	import JobFilterChips, { type JobBoardStatusFilter } from './job-filter-chips.svelte';
	import JobCard from './job-card.svelte';
	import JobFormDialog from './job-form-dialog.svelte';
	import { useJobs, useJobApplications } from '../application/queries';
	import type { FillBucket } from '../domain/capacity';
	import { shiftFillRate, bucketFillRate, jobShiftCapacities } from '../domain/capacity';
	import type { Job } from '../domain/job.schema';

	const jobsQuery = useJobs();
	const applicationsQuery = useJobApplications();

	const jobs = $derived(jobsQuery.data ?? []);

	const applicantCounts = $derived.by(() => {
		const counts = new SvelteMap<string, number>();
		for (const app of applicationsQuery.data ?? []) {
			counts.set(app.job_id, (counts.get(app.job_id) ?? 0) + 1);
		}
		return counts;
	});

	let statusFilter = $state<JobBoardStatusFilter>('all');
	let excludeClosed = $state(true);
	let urgentOnly = $state(false);
	let kpiFilter = $state<FillBucket | null>(null);

	const filteredJobs = $derived.by<Job[]>(() => {
		let list = jobs;
		if (statusFilter !== 'all') {
			list = list.filter((j) => j.status === statusFilter);
		} else if (excludeClosed) {
			list = list.filter((j) => j.status !== 'closed' && j.status !== 'cancelled');
		}
		if (urgentOnly) list = list.filter((j) => j.is_urgent);
		if (kpiFilter) {
			// A job qualifies when ANY of its sub-shifts falls in the clicked bucket
			// — the KPI counts shifts, so the board must not hide a job whose
			// shortage lives in only one of its shifts.
			list = list.filter((j) =>
				jobShiftCapacities(j).some((c) => bucketFillRate(shiftFillRate(c)) === kpiFilter)
			);
		}
		return list;
	});

	let dialogOpen = $state(false);
	let editingJob = $state<Job | null>(null);

	function openCreate() {
		editingJob = null;
		dialogOpen = true;
	}
	function openEdit(job: Job) {
		editingJob = job;
		dialogOpen = true;
	}

	const kpiSkeletonKeys = [0, 1, 2, 3];
	const cardSkeletonKeys = [0, 1, 2, 3, 4, 5];
</script>

<div class="space-y-4">
	{#if jobsQuery.isPending}
		<div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
			{#each kpiSkeletonKeys as key (key)}
				<Skeleton class="h-24 rounded-xl" />
			{/each}
		</div>
	{:else}
		<JobCapacitySummary {jobs} selected={kpiFilter} onselect={(b) => (kpiFilter = b)} />
	{/if}

	<div class="flex flex-wrap items-center justify-between gap-3">
		<JobFilterChips bind:status={statusFilter} bind:excludeClosed bind:urgentOnly />
		<Button onclick={openCreate} class="gap-1.5">
			<Plus class="h-4 w-4" />
			ประกาศภารกิจงานอาสาใหม่
		</Button>
	</div>

	{#if jobsQuery.isPending}
		<div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
			{#each cardSkeletonKeys as key (key)}
				<Skeleton class="h-56 rounded-2xl" />
			{/each}
		</div>
	{:else if jobsQuery.isError}
		<p
			class="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive"
		>
			โหลดรายการงานไม่สำเร็จ: {jobsQuery.error instanceof Error
				? jobsQuery.error.message
				: 'เกิดข้อผิดพลาด'}
		</p>
	{:else if filteredJobs.length === 0}
		<div
			class="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-16 text-center text-muted-foreground"
		>
			<Inbox class="h-8 w-8" />
			<p class="text-sm font-medium">
				{jobs.length === 0 ? 'ยังไม่มีงานอาสาสมัครในศูนย์นี้' : 'ไม่มีงานที่ตรงกับตัวกรองที่เลือก'}
			</p>
			{#if jobs.length === 0}
				<Button variant="outline" size="sm" onclick={openCreate} class="mt-1">
					ประกาศภารกิจงานอาสาแรก
				</Button>
			{/if}
		</div>
	{:else}
		<div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
			{#each filteredJobs as job (job._id)}
				<JobCard {job} applicantCount={applicantCounts.get(job._id) ?? 0} onedit={openEdit} />
			{/each}
		</div>
	{/if}
</div>

<JobFormDialog bind:open={dialogOpen} job={editingJob} />
