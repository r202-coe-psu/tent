<script lang="ts">
	/**
	 * Job detail — Tab 3 "ผู้สมัคร (Applicants & Queue)" (01-tab-job-board.md
	 * §01.5, approved mockup 2026-08-30): four summary tiles over one card
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
	 * means the badge and this list can never disagree. Shift assignments (for the
	 * per-shift check-in action) are read the same unfiltered way.
	 */
	import Users from '@lucide/svelte/icons/users';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import JobApplicantRow from './job-applicant-row.svelte';
	import JobApplicantReviewDialog from './job-applicant-review-dialog.svelte';
	import { groupApplicationsByApplicant, partitionApplicantQueue } from '../domain/applicant-queue';
	import type { Job } from '../domain/job.schema';
	import type { JobApplication } from '../domain/job-application.schema';
	import {
		todayDateString,
		useJobApplications,
		useShiftAssignments,
		useSkillOptions,
		useVolunteers
	} from '../application/queries';

	let { job }: { job: Job } = $props();

	const applicationsQuery = useJobApplications();
	const volunteersQuery = useVolunteers();
	const assignmentsQuery = useShiftAssignments();
	const skillCatalog = useSkillOptions();

	const loading = $derived(applicationsQuery.isPending);
	const queue = $derived(partitionApplicantQueue(applicationsQuery.data ?? [], job._id));
	/** Pending applications, one card per applicant with all their shifts (#716). */
	const pendingGroups = $derived(groupApplicationsByApplicant(queue.pending));

	/** `volunteer_id` → `volunteer_code`, so a linked application shows its roster code. */
	const codeByVolunteerId = $derived(
		new Map((volunteersQuery.data ?? []).map((v) => [v._id, v.volunteer_code]))
	);
	const assignments = $derived(assignmentsQuery.data ?? []);
	const today = $derived(todayDateString());
	const volunteerById = $derived(new Map((volunteersQuery.data ?? []).map((v) => [v._id, v])));

	// People are counted once however many shifts they applied for; the other tiles count
	// applications, which are one per shift (#716).
	const counts = $derived({
		total: groupApplicationsByApplicant([...queue.pending, ...queue.reviewed]).length,
		pending: queue.pending.length,
		confirmed: queue.reviewed.filter((a) => a.status === 'confirmed').length,
		declined: queue.reviewed.filter((a) => a.status === 'rejected' || a.status === 'cancelled')
			.length
	});

	const tiles = $derived([
		{
			key: 'total',
			label: 'ผู้สมัครทั้งหมด',
			value: counts.total,
			unit: 'คน',
			tone: 'border-border bg-card'
		},
		{
			key: 'pending',
			label: 'รอพิจารณา',
			value: counts.pending,
			unit: 'กะ',
			tone: 'border-border bg-muted/50'
		},
		{
			key: 'confirmed',
			label: 'อนุมัติใบสมัครแล้ว',
			value: counts.confirmed,
			unit: 'กะ',
			tone: 'border-emerald-200 bg-emerald-50/70'
		},
		{
			key: 'declined',
			label: '✕ ปฏิเสธ/ไม่สะดวก',
			value: counts.declined,
			unit: 'กะ',
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
	let reviewTargets = $state<JobApplication[]>([]);
	let reviewDecision = $state<'confirmed' | 'rejected'>('confirmed');

	function openReview(applications: JobApplication[], decision: 'confirmed' | 'rejected') {
		reviewTargets = applications;
		reviewDecision = decision;
		reviewOpen = true;
	}

	const reviewVolunteerId = $derived(reviewTargets[0]?.volunteer_id ?? null);
</script>

<div class="space-y-4">
	<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
		{#each tiles as tile (tile.key)}
			<div class={['rounded-2xl border p-3.5', tile.tone]}>
				<p class="text-xs font-medium text-muted-foreground">{tile.label}</p>
				<p class="mt-1 text-2xl font-bold text-foreground tabular-nums">{tile.value} {tile.unit}</p>
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
			{#if queue.pending.length > 0}
				<div class="mt-4 flex items-center justify-between gap-3">
					<h4 class="text-xs font-bold text-foreground">
						รอพิจารณา ({pendingGroups.length} คน · {queue.pending.length} กะ)
					</h4>
					<span class="text-2xs text-muted-foreground">เรียงตามวันที่สมัคร</span>
				</div>
				<ul class="mt-3 space-y-3">
					{#each pendingGroups as group (group.key)}
						{@const volunteerId = group.applications[0].volunteer_id}
						<JobApplicantRow
							applications={group.applications}
							volunteer={volunteerId ? (volunteerById.get(volunteerId) ?? null) : null}
							volunteerCode={volunteerId ? (codeByVolunteerId.get(volunteerId) ?? null) : null}
							shiftLabelOf={shiftLabelFor}
							requiredSkills={job.skills_required ?? []}
							skillOptions={skillCatalog.options}
							{assignments}
							{today}
							onreview={openReview}
						/>
					{/each}
				</ul>
			{/if}

			{#if queue.reviewed.length > 0}
				<div class="mt-6 border-t border-border pt-4">
					<div class="flex items-center justify-between gap-3">
						<h4 class="text-xs font-bold text-foreground">
							ประวัติการพิจารณา ({queue.reviewed.length} กะ)
						</h4>
						<span class="text-2xs text-muted-foreground">รวมอนุมัติ ปฏิเสธ และไม่สะดวก</span>
					</div>
					<ul class="mt-3 space-y-3">
						{#each queue.reviewed as application (application._id)}
							<JobApplicantRow
								applications={[application]}
								volunteer={application.volunteer_id
									? (volunteerById.get(application.volunteer_id) ?? null)
									: null}
								volunteerCode={application.volunteer_id
									? (codeByVolunteerId.get(application.volunteer_id) ?? null)
									: null}
								shiftLabelOf={shiftLabelFor}
								requiredSkills={job.skills_required ?? []}
								skillOptions={skillCatalog.options}
								{assignments}
								{today}
								onreview={openReview}
							/>
						{/each}
					</ul>
				</div>
			{/if}
		{/if}
	</div>

	<JobApplicantReviewDialog
		bind:open={reviewOpen}
		{job}
		applications={reviewTargets}
		volunteer={reviewVolunteerId ? (volunteerById.get(reviewVolunteerId) ?? null) : null}
		decision={reviewDecision}
	/>
</div>
