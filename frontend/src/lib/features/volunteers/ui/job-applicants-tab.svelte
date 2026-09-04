<script lang="ts">
	/**
	 * Job detail — Tab 3 "ผู้สมัคร (Applicants & Queue)" (01-tab-job-board.md
	 * §01.5, approved mockup 2026-08-30): five summary tiles over one card
	 * holding the applicant list.
	 *
	 * Approving is the moment a job slot is consumed — the whole write path
	 * (`JobApplicationRepository#review` → `JobRepository#confirmSlot`, with the
	 * application doc rolled back if the slot cannot be taken) already lives in
	 * the data layer; this screen is the queue that drives it.
	 *
	 * Every list is read from an UNFILTERED query and narrowed here with
	 * `partitionApplicantQueue`. `useJobApplications(filter)` takes its filter
	 * once at setup, so a `{ jobId }` filter would freeze to whichever job was
	 * rendered first (SvelteKit reuses this component across `[id]`
	 * navigations) — and sharing the unfiltered cache entry with the tab badge
	 * means the badge and this list can never disagree.
	 */
	import Users from '@lucide/svelte/icons/users';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import JobApplicantRow from './job-applicant-row.svelte';
	import JobApplicantReviewDialog from './job-applicant-review-dialog.svelte';
	import { partitionApplicantQueue } from '../domain/applicant-queue';
	import type { Job } from '../domain/job.schema';
	import type { JobApplication } from '../domain/job-application.schema';
	import { useJobApplications, useShiftAssignments, useVolunteers } from '../application/queries';

	let { job }: { job: Job } = $props();

	const applicationsQuery = useJobApplications();
	const assignmentsQuery = useShiftAssignments();
	const volunteersQuery = useVolunteers();

	const loading = $derived(applicationsQuery.isPending);
	const queue = $derived(partitionApplicantQueue(applicationsQuery.data ?? [], job._id));

	/** `volunteer_id` → `volunteer_code`, so a linked application shows its roster code. */
	const codeByVolunteerId = $derived(
		new Map((volunteersQuery.data ?? []).map((v) => [v._id, v.volunteer_code]))
	);

	/**
	 * "มอบหมายแล้ว" counts real `shift_assignment` rows rather than
	 * `job.slots_dispatched`: the quota bucket also moves for volunteers
	 * assigned straight from the roster page, which never produced an
	 * application and so are not in this list.
	 */
	const assignedCount = $derived(
		(assignmentsQuery.data ?? []).filter((a) => a.job_id === job._id && a.status !== 'cancelled')
			.length
	);

	const counts = $derived({
		total: queue.pending.length + queue.reviewed.length,
		pending: queue.pending.length,
		confirmed: queue.reviewed.filter((a) => a.status === 'confirmed').length,
		declined: queue.reviewed.filter((a) => a.status === 'rejected' || a.status === 'cancelled')
			.length
	});

	const tiles = $derived([
		{ key: 'total', label: 'ผู้สมัครทั้งหมด', value: counts.total, tone: 'border-border bg-card' },
		{
			key: 'pending',
			label: '⏳ รออนุมัติ',
			value: counts.pending,
			tone: 'border-border bg-muted/50'
		},
		{
			key: 'assigned',
			label: '🟡 มอบหมายแล้ว',
			value: assignedCount,
			tone: 'border-amber-200 bg-amber-50/70'
		},
		{
			key: 'confirmed',
			label: '✅ อนุมัติแล้ว',
			value: counts.confirmed,
			tone: 'border-emerald-200 bg-emerald-50/70'
		},
		{
			key: 'declined',
			label: '✕ ปฏิเสธ/ไม่สะดวก',
			value: counts.declined,
			tone: 'border-rose-200 bg-rose-50/70'
		}
	]);

	/**
	 * `job.shifts` position for an application's chosen slot — the application
	 * stores the concrete `shift_id` plus a date/time snapshot, so the label
	 * is a best-effort match and is simply omitted when nothing lines up.
	 */
	function shiftLabelFor(application: JobApplication): string | null {
		const index = job.shifts.findIndex(
			(s) =>
				s.date === application.selected_shift.date &&
				s.start_time === application.selected_shift.start_time &&
				s.end_time === application.selected_shift.end_time
		);
		return index === -1 ? null : `กะย่อย #${index + 1}`;
	}

	let reviewOpen = $state(false);
	let reviewTarget = $state<JobApplication | null>(null);
	let reviewDecision = $state<'confirmed' | 'rejected'>('confirmed');

	function openReview(application: JobApplication, decision: 'confirmed' | 'rejected') {
		reviewTarget = application;
		reviewDecision = decision;
		reviewOpen = true;
	}
</script>

<div class="space-y-4">
	<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
		{#each tiles as tile (tile.key)}
			<div class={['rounded-2xl border p-3.5', tile.tone]}>
				<p class="text-xs font-medium text-muted-foreground">{tile.label}</p>
				<p class="mt-1 text-2xl font-bold text-foreground tabular-nums">{tile.value} คน</p>
			</div>
		{/each}
	</div>

	<div class="rounded-2xl border border-border bg-card p-4 shadow-xs">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<h3 class="inline-flex items-center gap-2 text-sm font-bold text-foreground">
				<Users class="h-4 w-4 text-primary" />
				รายชื่อและสถานะผู้สมัครงานอาสานี้
			</h3>
		</div>

		{#if loading}
			<div class="mt-3 space-y-3">
				<Skeleton class="h-32 w-full rounded-xl" />
				<Skeleton class="h-32 w-full rounded-xl" />
			</div>
		{:else if counts.total === 0}
			<div
				class="mt-3 flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-14 text-center text-muted-foreground"
			>
				<Users class="h-8 w-8" />
				<p class="text-sm font-medium">ยังไม่มีผู้สมัครงานนี้</p>
				<p class="max-w-md text-xs">
					เมื่อมีผู้สมัครเข้ามา รายชื่อจะขึ้นที่นี่เพื่อรอการอนุมัติ หรือกด "มอบหมายงานให้อาสา"
					เพื่อดึงอาสาในทะเบียนเข้ากะโดยตรง
				</p>
			</div>
		{:else}
			<ul class="mt-3 space-y-3">
				{#each queue.pending as application (application._id)}
					<JobApplicantRow
						{application}
						volunteerCode={application.volunteer_id
							? (codeByVolunteerId.get(application.volunteer_id) ?? null)
							: null}
						shiftLabel={shiftLabelFor(application)}
						onreview={openReview}
					/>
				{/each}
			</ul>

			{#if queue.reviewed.length > 0}
				<details class="group mt-4" open={queue.pending.length === 0}>
					<summary
						class="cursor-pointer list-none text-xs font-bold text-muted-foreground hover:text-foreground"
					>
						พิจารณาแล้ว ({queue.reviewed.length} คน)
						<span class="font-normal group-open:hidden">— กดเพื่อดู</span>
					</summary>
					<ul class="mt-3 space-y-3">
						{#each queue.reviewed as application (application._id)}
							<JobApplicantRow
								{application}
								volunteerCode={application.volunteer_id
									? (codeByVolunteerId.get(application.volunteer_id) ?? null)
									: null}
								shiftLabel={shiftLabelFor(application)}
								onreview={openReview}
							/>
						{/each}
					</ul>
				</details>
			{/if}
		{/if}
	</div>

	<JobApplicantReviewDialog
		bind:open={reviewOpen}
		{job}
		application={reviewTarget}
		decision={reviewDecision}
	/>
</div>
